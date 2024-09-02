process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "1";

import "./config.js";
import "./api.js";
import { createRequire } from "module";
import path, { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { platform } from "process";
import {
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
  readFileSync,
  watch,
} from "fs";
import yargs from "yargs";
import { spawn } from "child_process";
import lodash from "lodash";
import chalk from "chalk";
import syntaxerror from "syntax-error";
import { format } from "util";
import pino from "pino";
import Pino from "pino";
import { Boom } from "@hapi/boom";
import { makeWASocket, protoType, serialize } from "./src/libraries/simple.js";
import { Low, JSONFile } from "lowdb";
import store from "./src/libraries/store.js";

const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
} = await import("baileys");
import readline from "readline";
import NodeCache from "node-cache";

global.__filename = function filename(
  pathURL = import.meta.url,
  rmPrefix = platform !== "win32",
) {
  return rmPrefix
    ? /file:\/\/\//.test(pathURL)
      ? fileURLToPath(pathURL)
      : pathURL
    : pathToFileURL(pathURL).toString();
};

global.__dirname = function dirname(pathURL) {
  return path.dirname(global.__filename(pathURL, true));
};

global.__require = function require(dir = import.meta.url) {
  return createRequire(dir);
};

global.API = (name, path = "/", query = {}, apikeyqueryname) =>
  (name in global.APIs ? global.APIs[name] : name) +
  path +
  (query || apikeyqueryname
    ? "?" +
      new URLSearchParams(
        Object.entries({
          ...query,
          ...(apikeyqueryname
            ? {
                [apikeyqueryname]:
                  global.APIKeys[
                    name in global.APIs ? global.APIs[name] : name
                  ],
              }
            : {}),
        }),
      )
    : "");

global.timestamp = { start: new Date() };
global.videoList = [];
global.videoListXXX = [];
const __dirname = global.__dirname(import.meta.url);
global.opts = yargs(process.argv.slice(2)).exitProcess(false).parse();
global.prefix = new RegExp(
  "^[" +
    (global.opts["prefix"] || "*/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-.@").replace(
      /[|\\{}()[\]^$+*?.\-\^]/g,
      "\\$&",
    ) +
    "]",
);
global.db = new Low(
  /https?:\/\//.test(global.opts["db"] || "")
    ? new cloudDBAdapter(global.opts["db"])
    : new JSONFile(
        `${global.opts._[0] ? global.opts._[0] + "_" : ""}database.json`,
      ),
);

global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) {
    return new Promise((resolve) =>
      setInterval(async function () {
        if (!global.db.READ) {
          clearInterval(this);
          resolve(
            global.db.data == null ? global.loadDatabase() : global.db.data,
          );
        }
      }, 1000),
    );
  }
  if (global.db.data !== null) return;
  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = null;
  global.db.data = {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {},
    ...(global.db.data || {}),
  };
  global.db.chain = chain(global.db.data);
};
await global.loadDatabase();

const { state, saveCreds } = await useMultiFileAuthState(global.authFile);
const msgRetryCounterMap = new Map();
const msgRetryCounterCache = new NodeCache();
const { version } = await fetchLatestBaileysVersion();
let phoneNumber = global.botnumber;

const methodCodeQR = process.argv.includes("qr");
const methodCode = !!phoneNumber || process.argv.includes("code");
const MethodMobile = process.argv.includes("mobile");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const question = (texto) =>
  new Promise((resolver) => rl.question(texto, resolver));

if (methodCodeQR) {
  opcion = "1";
}
if (
  !methodCodeQR &&
  !methodCode &&
  !existsSync(`./${global.authFile}/creds.json`)
) {
  do {
    opcion = await question(
      "[ ℹ️ ] Seleccione una opción:\n1. Con código QR\n2. Con código de texto de 8 dígitos\n---> ",
    );
    if (!/^[1-2]$/.test(opcion)) {
      console.log("[ ❗ ] Por favor, seleccione solo 1 o 2.\n");
    }
  } while (
    (opcion !== "1" && opcion !== "2") ||
    existsSync(`./${global.authFile}/creds.json`)
  );
}

const connectionOptions = {
  logger: Pino({ level: "silent" }),
  printQRInTerminal: opcion === "1" || methodCodeQR,
  mobile: MethodMobile,
  browser:
    opcion === "1"
      ? ["TheMystic-Bot-MD", "Safari", "2.0.0"]
      : methodCodeQR
        ? ["TheMystic-Bot-MD", "Safari", "2.0.0"]
        : ["Ubuntu", "Chrome", "20.0.04"],
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(
      state.keys,
      Pino({ level: "fatal" }).child({ level: "fatal" }),
    ),
  },
  waWebSocketUrl: "wss://web.whatsapp.com/ws/chat?ED=CAIICA",
  markOnlineOnConnect: true,
  generateHighQualityLinkPreview: true,
  getMessage: async (key) => {
    let jid = jidNormalizedUser(key.remoteJid);
    let msg = await store.loadMessage(jid, key.id);
    return msg?.message || "";
  },
  patchMessageBeforeSending: async (message) => {
    let messages = 0;
    global.conn.uploadPreKeysToServerIfRequired();
    messages++;
    return message;
  },
  msgRetryCounterCache,
  msgRetryCounterMap,
  defaultQueryTimeoutMs: undefined,
  version,
};

global.conn = makeWASocket(connectionOptions);

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin } = update;
  if (isNewLogin) conn.isInit = true;
  const code =
    lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.output?.payload?.statusCode;
  if (code && code !== DisconnectReason.loggedOut && conn?.ws.socket == null) {
    await global.loadHandler(true).catch(console.error);
    global.timestamp.connect = new Date();
  }
  if (global.db.data == null) await global.loadDatabase();
  if ((update.qr != 0 && update.qr != undefined) || methodCodeQR) {
    if (opcion == "1" || methodCodeQR) {
      console.log(chalk.yellow("[ ℹ️ ] Escanea el código QR."));
    }
  }
  if (connection == "open") {
    console.log(chalk.yellow("[ ℹ️ ] Conectado correctamente."));
  }
  let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
  if (reason == 405) {
    await fs.unlinkSync(`./${global.authFile}/creds.json`);
    console.log(
      chalk.bold.redBright(
        `[ ⚠ ] Conexión reemplazada, Por favor espere un momento me voy a reiniciar...\nSi aparecen errores, reinicie el bot`,
      ),
    );
    setTimeout(() => {
      process.exit();
    }, 3000);
  }
  if (connection == "close") {
    if (
      lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut
    ) {
      console.log(
        chalk.bold.redBright(
          "[ ⚠ ] El número de teléfono ha sido desconectado. Inicie sesión nuevamente para continuar.\nEl bot se está reiniciando...",
        ),
      );
      await global.loadDatabase();
      await fs.unlinkSync(`./${global.authFile}/creds.json`);
      setTimeout(() => {
        process.exit();
      }, 3000);
    }
  }
}

global.loadHandler = async function loadHandler(reload = false) {
  if (reload && global.handler) delete global.handler;
  global.handler = (await import("./src/handler.js")).default;
};
await global.loadHandler();

global.conn.on("connection.update", connectionUpdate);
global.conn.on("messages.upsert", async ({ messages }) => {
  if (messages.length === 0) return;
  const msg = messages[0];
  if (msg.key && msg.key.remoteJid === "status@broadcast") return;
  global.handler(msg);
});
global.conn.on("message-receipt", async (msg) => {
  if (msg.key && msg.key.remoteJid === "status@broadcast") return;
  if (global.handler) await global.handler(msg);
});
