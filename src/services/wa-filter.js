import crypto from "node:crypto";
export function normalizePhone(value) {
  const phone = String(value || "").replace(/[\s()+-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(phone)) return null;
  return phone;
}
export function permittedStatus(message, now = Date.now()) {
  if (
    message?.key?.remoteJid !== "status@broadcast" ||
    !message.key.id ||
    !message.message
  )
    return null;
  let content = message.message;
  if (
    content.viewOnceMessage ||
    content.viewOnceMessageV2 ||
    content.viewOnceMessageV2Extension
  )
    return null;
  if (content.ephemeralMessage)
    content = content.ephemeralMessage.message || {};
  if (
    content.viewOnceMessage ||
    content.viewOnceMessageV2 ||
    content.viewOnceMessageV2Extension
  )
    return null;
  const media = content.imageMessage || content.videoMessage;
  if (!media || media.viewOnce) return null;
  const timestamp = Number(message.messageTimestamp) * 1000;
  if (
    !Number.isFinite(timestamp) ||
    timestamp < now - 86400000 ||
    timestamp > now + 300000
  )
    return null;
  const type = content.imageMessage ? "image" : "video";
  return {
    media,
    type,
    timestamp,
    sourceId: crypto
      .createHash("sha256")
      .update(`${message.key.participant || ""}:${message.key.id}`)
      .digest("hex"),
    contact: String(message.pushName || "Kontak WhatsApp")
      .replace(/[\x00-\x1f]/g, "")
      .slice(0, 60),
  };
}
