// Isolated child: stdout/stderr are ignored by the parent. libsignal can log
// cryptographic objects to console; those messages must NEVER reach app logs.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import pino from "pino";
import QRCode from "qrcode";
import * as baileys from "@whiskeysockets/baileys";
import { createAuthState } from "./wa-auth.js";
import { permittedStatus } from "./wa-filter.js";
const logger = pino({ level: "silent" });
let socket,
  auth,
  options,
  stopped = false,
  pairRequested = false,
  retries = 0,
  timer,
  retryTimer,
  collect = false,
  chain = Promise.resolve(),
  queued = 0;
const pending = new Set(),
  seen = new Set();
const send = (data) => {
  if (process.connected) process.send(data);
};
const status = (state, message, extra = {}) =>
  send({ event: "state", state, message, ...extra });
async function open() {
  if (stopped) return;
  auth = await createAuthState(options.authDir, baileys);
  const makeSocket =
    typeof baileys.default === "function"
      ? baileys.default
      : baileys.makeWASocket;
  socket = makeSocket({
    auth: auth.state,
    logger,
    browser: baileys.Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    shouldIgnoreJid: (jid) => jid !== "status@broadcast",
    connectTimeoutMs: 30000,
    defaultQueryTimeoutMs: 30000,
    retryRequestDelayMs: 1500,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });
  const current = socket;
  socket.ev.on("creds.update", () => {
    auth
      .saveCreds()
      .catch(() =>
        fail("Penyimpanan sesi gagal. Periksa volume dan izin direktori."),
      );
  });
  socket.ev.on("connection.update", (update) => {
    handleUpdate(current, update).catch(() =>
      fail("Autentikasi WhatsApp gagal. Coba QR atau ulangi nanti."),
    );
  });
  socket.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" || !collect || stopped) return;
    for (const message of messages) {
      const item = permittedStatus(message);
      if (!item || seen.has(item.sourceId) || queued >= 10) continue;
      seen.add(item.sourceId);
      if (seen.size > 2000) seen.delete(seen.values().next().value);
      queued++;
      chain = chain
        .then(() => capture(item))
        .catch(() =>
          send({
            event: "notice",
            message:
              "Satu media status gagal disimpan: ukuran, format, atau akses sumber tidak tersedia.",
          }),
        )
        .finally(() => queued--);
    }
  });
}
async function handleUpdate(current, update) {
  if (stopped || current !== socket) return;
  if (update.qr && !auth.state.creds.registered) {
    if (options.method === "pairing" && !pairRequested) {
      pairRequested = true;
      status("waiting", "Meminta kode pairing nyata dari Baileys…");
      const code = await current.requestPairingCode(options.phone);
      if (!stopped && current === socket && !auth.state.creds.registered)
        status(
          "waiting",
          "Masukkan kode ini di menu Perangkat tertaut WhatsApp.",
          { pairingCode: String(code) },
        );
    } else if (options.method === "qr") {
      const qr = await QRCode.toDataURL(update.qr, {
        margin: 2,
        width: 280,
        errorCorrectionLevel: "M",
      });
      if (!stopped && current === socket && !auth.state.creds.registered)
        status("waiting", "Pindai QR melalui WhatsApp → Perangkat tertaut.", {
          qr,
        });
    }
  }
  if (update.connection === "open") {
    clearTimeout(timer);
    retries = 0;
    status(
      "connected",
      "Akun terhubung. Hanya status baru yang diterima akun ini yang dapat dikoleksi.",
    );
  }
  if (update.connection === "close") {
    const code = update.lastDisconnect?.error?.output?.statusCode;
    if (
      code === baileys.DisconnectReason.loggedOut ||
      code === baileys.DisconnectReason.badSession
    ) {
      await fail(
        "Sesi tidak berlaku. Putuskan sesi lokal, lalu hubungkan ulang.",
      );
      return;
    }
    const registered = auth.state.creds.registered;
    if (
      (registered || code === baileys.DisconnectReason.restartRequired) &&
      retries < 3
    ) {
      retries++;
      current.ev.removeAllListeners("creds.update");
      current.ev.removeAllListeners("messages.upsert");
      current.ev.removeAllListeners("connection.update");
      await auth.close();
      status("reconnecting", `Menyambungkan kembali (${retries}/3)…`);
      retryTimer = setTimeout(
        () =>
          open().catch(() =>
            fail("Koneksi ulang gagal. Coba sambungkan lagi."),
          ),
        Math.min(1000 * 2 ** retries, 15000),
      );
    } else
      await fail(
        "WhatsApp memutus koneksi atau autentikasi tidak selesai. Coba lagi, atau gunakan impor lokal.",
      );
  }
}
async function capture(item) {
  if (stopped || !collect) return;
  if (Number(item.media.fileLength) > options.maxFileBytes)
    throw new Error("Too large");
  const token = crypto.randomUUID();
  const file = path.join(options.tmpDir, `${token}.upload`);
  pending.add(file);
  let stream;
  try {
    stream = await baileys.downloadContentFromMessage(item.media, item.type, {
      options: { timeout: 30000 },
    });
    let count = 0;
    const cap = new Transform({
      transform(chunk, encoding, cb) {
        count += chunk.length;
        cb(count > options.maxFileBytes ? new Error("Too large") : null, chunk);
      },
    });
    const timeout = setTimeout(
      () => stream.destroy(new Error("Timeout")),
      60000,
    );
    try {
      await pipeline(
        stream,
        cap,
        createWriteStream(file, { flags: "wx", mode: 0o600 }),
      );
    } finally {
      clearTimeout(timeout);
    }
    if (stopped) {
      await fs.rm(file, { force: true });
      return;
    }
    send({
      event: "media",
      token,
      sourceId: item.sourceId,
      contact: item.contact,
      statusAt: new Date(item.timestamp).toISOString(),
      name: `status-${new Date(item.timestamp).toISOString().replace(/[:.]/g, "-")}.${item.type === "image" ? "jpg" : "mp4"}`,
    });
  } catch (e) {
    await fs.rm(file, { force: true });
    throw e;
  } finally {
    pending.delete(file);
  }
}
async function fail(message) {
  if (stopped) return;
  status("failed", message);
  await close(false);
}
async function close(logout) {
  if (stopped) return;
  stopped = true;
  clearTimeout(timer);
  clearTimeout(retryTimer);
  if (socket) {
    socket.ev.removeAllListeners("messages.upsert");
    socket.ev.removeAllListeners("connection.update");
    if (logout) {
      try {
        await Promise.race([
          socket.logout(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 5000),
          ),
        ]);
      } catch {
        send({
          event: "notice",
          message:
            "Cabut juga perangkat ini dari aplikasi WhatsApp jika pemutusan jarak jauh tidak selesai.",
        });
      }
    }
    socket.ev.removeAllListeners("creds.update");
    socket.end(undefined);
  }
  await auth?.close();
  for (const file of pending) await fs.rm(file, { force: true });
  send({ event: "stopped" });
  setTimeout(() => process.exit(0), 50);
}
process.on("message", (message) => {
  if (message.type === "start" && !options) {
    options = message;
    collect = message.collect;
    status("connecting", "Membuka koneksi terenkripsi WhatsApp Web…");
    timer = setTimeout(
      () =>
        fail("Waktu autentikasi habis. Minta kode/QR baru untuk mencoba lagi."),
      120000,
    );
    open().catch(() =>
      fail(
        "Integrasi tidak dapat dijalankan. Coba lagi atau gunakan impor lokal.",
      ),
    );
  } else if (message.type === "settings") collect = message.collect === true;
  else if (message.type === "stop")
    close(message.logout === true).catch(() => process.exit(1));
});
process.on("disconnect", () => close(false));
process.on("SIGTERM", () => close(false));
process.on("uncaughtException", () =>
  fail("Integrasi berhenti karena kendala internal. Sambungkan ulang."),
);
process.on("unhandledRejection", () =>
  fail("Integrasi mengalami kendala. Coba sambungkan ulang."),
);
