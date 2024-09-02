const handler = async (m, { conn, participants, isAdmin, isBotAdmin }) => {
  try {
    if (!isBotAdmin) return; // التحقق من أن البوت مسؤول في المجموعة

    const offensiveWords = ["كسم", "كس", "طيز", "طز"]; // قائمة بالكلمات المسيئة

    if (!global.db.data.users[m.sender]) {
      global.db.data.users[m.sender] = { warnings: 0 }; // تأكد من تهيئة بيانات المستخدم
    }

    const userWarnings = global.db.data.users[m.sender].warnings; // الحصول على عدد التحذيرات الحالية
    const isMentionAll = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.length === participants.length; // التحقق من المنشن الجماعي

    const isOffensive = offensiveWords.some(word => m.text && m.text.includes(word)) || m.isVoiceMessage(); // التحقق من النصوص المسيئة أو المقاطع الصوتية

    console.log('Message Text:', m.text);
    console.log('Is Offensive:', isOffensive);
    console.log('Is Mention All:', isMentionAll);

    if (isOffensive) {
      await conn.deleteMessage(m.chat, m.key); // حذف الرسالة المسيئة
      global.db.data.users[m.sender].warnings = userWarnings + 1; // إضافة تحذير للعضو
      await m.reply(`تم حذف رسالتك بسبب استخدامها لغة غير لائقة. لديك الآن ${userWarnings + 1} تحذيرات.`);

      if (global.db.data.users[m.sender].warnings >= 3) {
        await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove'); // طرد العضو إذا كانت لديه 3 تحذيرات
      }
    } else if (isMentionAll && !isAdmin) {
      global.db.data.users[m.sender].warnings = userWarnings + 1; // إضافة تحذير للعضو
      await m.reply(`لا يسمح بعمل منشن جماعي. لديك الآن ${userWarnings + 1} تحذيرات.`);

      if (global.db.data.users[m.sender].warnings >= 3) {
        await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove'); // طرد العضو إذا كانت لديه 3 تحذيرات
      }
    }
  } catch (error) {
    console.error('Error in handler:', error);
  }
};

handler.group = true;  // التأكد من أن الكود يعمل فقط في المجموعات
handler.botAdmin = true;  // التأكد من أن البوت مسؤول في المجموعة

export default handler;
