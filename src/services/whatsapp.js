import { fork } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, invalid } from "../utils/errors.js";
import { isId, ensureDir, Mutex } from "../utils/files.js";
import { normalizePhone } from "./wa-filter.js";
export class WhatsApp {
  constructor(config, media) {
    this.config = config;
    this.media = media;
    this.child = null;
    this.authDir = path.join(config.dataDir, "sessions", "whatsapp");
    this.mutex = new Mutex();
    this.state = {
      state: "disconnected",
      message: "Belum ada akun terhubung.",
      pairingCode: null,
      qr: null,
      updatedAt: new Date().toISOString(),
    };
    this.notice = null;
  }
  async snapshot() {
    let saved = false;
    try {
      const creds = JSON.parse(
        await fs.readFile(path.join(this.authDir, "creds.json"), "utf8"),
      );
      saved = creds.registered === true;
    } catch {}
    return {
      ...this.state,
      enabled: this.config.baileysEnabled,
      savedSession: saved,
      notice: this.notice,
    };
  }
  set(state, message, extra = {}) {
    this.state = {
      state,
      message,
      pairingCode: null,
      qr: null,
      updatedAt: new Date().toISOString(),
      ...extra,
    };
  }
  async connect(input) {
    return this.mutex.run(async () => {
      if (!this.config.baileysEnabled)
        throw new AppError(
          503,
          "INTEGRATION_DISABLED",
          "Integrasi Baileys dinonaktifkan pada server. Impor lokal tetap tersedia.",
        );
      if (input?.authorized !== true)
        throw invalid(
          "Konfirmasikan izin akun dan penggunaan media terlebih dahulu.",
        );
      if (this.child)
        throw new AppError(
          409,
          "CONNECTION_BUSY",
          "Batalkan atau putuskan koneksi yang sedang aktif.",
        );
      if (!["pairing", "qr", "resume"].includes(input.method))
        throw invalid("Pilih metode pairing atau QR yang didukung.");
      const phone = normalizePhone(input.phone);
      if (input.method === "pairing" && !phone)
        throw invalid(
          "Nomor harus memakai kode negara, 8–15 digit, tanpa awalan nol.",
        );
      const saved = (await this.snapshot()).savedSession;
      if (saved && input.method !== "resume")
        throw new AppError(
          409,
          "SAVED_SESSION",
          "Sesi tersimpan ditemukan. Lanjutkan sesi atau putuskan/hapus sesi lama dahulu.",
        );
      if (!saved && input.method === "resume")
        throw invalid("Tidak ada sesi tersimpan untuk dilanjutkan.");
      if (!saved) await fs.rm(this.authDir, { recursive: true, force: true });
      await ensureDir(this.authDir);
      this.notice = null;
      this.set("connecting", "Menyiapkan koneksi WhatsApp…");
      const child = fork(
        fileURLToPath(new URL("./wa-worker.js", import.meta.url)),
        [],
        {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: process.env.NODE_ENV,
          },
          execArgv: [],
        },
      );
      this.child = child;
      child.on("message", (message) => {
        if (child !== this.child) return;
        if (
          message.event === "state" &&
          [
            "connecting",
            "waiting",
            "connected",
            "reconnecting",
            "failed",
          ].includes(message.state)
        ) {
          this.set(message.state, String(message.message).slice(0, 300), {
            pairingCode:
              typeof message.pairingCode === "string"
                ? message.pairingCode.slice(0, 16)
                : null,
            qr:
              typeof message.qr === "string" &&
              message.qr.startsWith("data:image/png;base64,")
                ? message.qr
                : null,
          });
        } else if (message.event === "notice")
          this.notice = String(message.message).slice(0, 300);
        else if (message.event === "media")
          this.ingest(message).catch(() => {
            this.notice =
              "Media status gagal disimpan. Periksa kapasitas penyimpanan.";
          });
      });
      child.on("error", () => {
        this.set(
          "failed",
          "Integrasi tidak dapat dimulai. Periksa dependency Baileys.",
        );
      });
      child.on("exit", () => {
        if (this.child === child) {
          this.child = null;
          if (this.state.state !== "failed")
            this.set(
              "disconnected",
              "Koneksi berhenti. Sesi tersimpan dapat dilanjutkan jika masih valid.",
            );
        }
      });
      child.send({
        type: "start",
        method: input.method,
        phone,
        authDir: this.authDir,
        tmpDir: path.join(this.config.dataDir, "tmp"),
        maxFileBytes: this.config.maxFileBytes,
        collect: (await this.media.settings()).autoCollect,
      });
      return this.snapshot();
    });
  }
  async ingest(msg) {
    if (!isId(msg.token) || !/^[a-f0-9]{64}$/.test(msg.sourceId || "")) return;
    const file = path.join(this.config.dataDir, "tmp", `${msg.token}.upload`);
    try {
      await this.media.add(file, {
        name: msg.name,
        source: "whatsapp",
        sourceId: msg.sourceId,
        contact: msg.contact,
        statusAt: msg.statusAt,
      });
    } finally {
      await fs.rm(file, { force: true });
    }
  }
  updateSettings(settings) {
    if (this.child?.connected)
      this.child.send({ type: "settings", collect: settings.autoCollect });
  }
  async stop({ logout = false, clear = false } = {}) {
    return this.mutex.run(async () => {
      const child = this.child;
      this.child = null;
      if (child && child.exitCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
          }, 8000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          if (child.connected) child.send({ type: "stop", logout });
          else child.kill("SIGTERM");
        });
      }
      if (clear) {
        await fs.rm(this.authDir, { recursive: true, force: true });
        await ensureDir(this.authDir);
      }
      this.set(
        "disconnected",
        clear
          ? "Koneksi diputus dan sesi lokal dihapus. Periksa juga Perangkat tertaut di WhatsApp."
          : "Koneksi dihentikan.",
      );
    });
  }
}
