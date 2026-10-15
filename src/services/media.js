import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileTypeFromFile } from "file-type";
import { ensureDir, isId, safeName, Mutex } from "../utils/files.js";
import { AppError, invalid } from "../utils/errors.js";
const MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
]);
export const mediaSchema = (a) =>
  Array.isArray(a) &&
  a.every(
    (m) =>
      m &&
      isId(m.id) &&
      typeof m.name === "string" &&
      MIME.has(m.mime) &&
      m.storedName === `${m.id}.${MIME.get(m.mime)}` &&
      Number.isFinite(m.size) &&
      m.size > 0 &&
      typeof m.createdAt === "string",
  );
export const settingsDefaults = {
  displayName: "My workspace",
  autoCollect: false,
  retentionDays: 7,
  reduceMotion: false,
};
export const settingsSchema = (s) =>
  s &&
  typeof s.displayName === "string" &&
  s.displayName.length <= 50 &&
  typeof s.autoCollect === "boolean" &&
  [1, 3, 7, 14, 30, 0].includes(s.retentionDays) &&
  typeof s.reduceMotion === "boolean";
export class MediaLibrary {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.dir = path.join(config.dataDir, "media");
    this.mutex = new Mutex();
    this.leases = new Map();
  }
  async init() {
    await ensureDir(this.dir);
    await this.store.update("media.json", [], (a) => a, mediaSchema);
    await this.store.update(
      "settings.json",
      settingsDefaults,
      (s) => s,
      settingsSchema,
    );
    await this.reconcile();
  }
  list() {
    return this.store.read("media.json", [], mediaSchema);
  }
  settings() {
    return this.store.read("settings.json", settingsDefaults, settingsSchema);
  }
  async updateSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw invalid("Pengaturan tidak valid.");
    const allowed = Object.keys(settingsDefaults);
    if (Object.keys(input).some((k) => !allowed.includes(k)))
      throw invalid("Ada pengaturan yang tidak dikenal.");
    return this.store.update(
      "settings.json",
      settingsDefaults,
      (old) => {
        const s = { ...old, ...input };
        if (typeof s.displayName === "string")
          s.displayName = s.displayName.trim();
        if (!settingsSchema(s) || !s.displayName)
          throw invalid("Pengaturan tidak valid.");
        return s;
      },
      settingsSchema,
    );
  }
  async add(
    tempFile,
    {
      name,
      source = "import",
      sourceId = null,
      contact = null,
      statusAt = null,
    } = {},
  ) {
    return this.mutex.run(async () => {
      const stat = await fs.stat(tempFile);
      if (!stat.size || stat.size > this.config.maxFileBytes)
        throw invalid("File kosong atau melebihi batas ukuran.");
      let type;
      try {
        type = await fileTypeFromFile(tempFile);
      } catch {
        throw invalid("Format file tidak dapat dikenali.");
      }
      if (!type || !MIME.has(type.mime))
        throw invalid(
          "Hanya JPG, PNG, WebP, GIF, MP4, dan WebM yang diizinkan. Isi file harus sesuai formatnya.",
        );
      const items = await this.list();
      if (sourceId && items.some((m) => m.sourceId === sourceId)) {
        await fs.rm(tempFile, { force: true });
        return null;
      }
      if (
        items.reduce((n, m) => n + m.size, 0) + stat.size >
        this.config.maxStorageBytes
      )
        throw new AppError(
          413,
          "STORAGE_FULL",
          "Kuota workspace penuh. Hapus beberapa media terlebih dahulu.",
        );
      if (items.length >= 2000)
        throw new AppError(
          413,
          "LIBRARY_FULL",
          "Batas 2000 media tercapai. Bersihkan galeri terlebih dahulu.",
        );
      const id = crypto.randomUUID(),
        ext = MIME.get(type.mime),
        storedName = `${id}.${ext}`;
      let filename = safeName(name || `status-${Date.now()}.${ext}`);
      filename = filename.replace(/\.[^.]+$/, "") + "." + ext;
      const entry = {
        id,
        name: filename,
        storedName,
        mime: type.mime,
        type: type.mime.startsWith("image/") ? "image" : "video",
        size: stat.size,
        source,
        sourceId,
        contact: contact ? String(contact).slice(0, 60) : null,
        statusAt,
        createdAt: new Date().toISOString(),
      };
      const dest = path.join(this.dir, storedName);
      await fs.rename(tempFile, dest);
      await fs.chmod(dest, 0o600);
      try {
        await this.store.write("media.json", [entry, ...items], mediaSchema);
      } catch (e) {
        await fs.rm(dest, { force: true });
        throw e;
      }
      return entry;
    });
  }
  async get(id) {
    if (!isId(id)) throw invalid("ID media tidak valid.");
    const entry = (await this.list()).find((m) => m.id === id);
    if (!entry)
      throw new AppError(
        404,
        "MEDIA_NOT_FOUND",
        "Media tidak ditemukan atau sudah dihapus.",
      );
    return entry;
  }
  file(entry) {
    if (!mediaSchema([entry])) throw new Error("Invalid media entry");
    return path.join(this.dir, entry.storedName);
  }
  async lease(ids) {
    return this.mutex.run(async () => {
      const list = await this.list();
      const entries = ids.map((id) => list.find((m) => m.id === id));
      if (entries.some((x) => !x))
        throw new AppError(
          404,
          "MEDIA_NOT_FOUND",
          "Salah satu media sudah dihapus. Muat ulang galeri.",
        );
      entries.forEach((e) =>
        this.leases.set(e.id, (this.leases.get(e.id) || 0) + 1),
      );
      let done = false;
      return {
        entries,
        release: () => {
          if (done) return;
          done = true;
          entries.forEach((e) => {
            const n = (this.leases.get(e.id) || 1) - 1;
            n ? this.leases.set(e.id, n) : this.leases.delete(e.id);
          });
        },
      };
    });
  }
  async remove(ids) {
    return this.mutex.run(async () => {
      if (ids.some((id) => !isId(id))) throw invalid("ID media tidak valid.");
      if (ids.some((id) => this.leases.has(id)))
        throw new AppError(
          409,
          "MEDIA_BUSY",
          "Media sedang dipreview atau diunduh. Tutup preview/tunggu unduhan, lalu coba lagi.",
        );
      const items = await this.list();
      const removed = items.filter((m) => ids.includes(m.id));
      await this.store.write(
        "media.json",
        items.filter((m) => !ids.includes(m.id)),
        mediaSchema,
      );
      await Promise.all(
        removed.map((m) => fs.rm(this.file(m), { force: true })),
      );
      return removed.length;
    });
  }
  async reconcile() {
    return this.mutex.run(async () => {
      const items = await this.list();
      const existing = [];
      for (const item of items) {
        try {
          const s = await fs.stat(this.file(item));
          if (s.isFile()) existing.push(item);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      if (existing.length !== items.length)
        await this.store.write("media.json", existing, mediaSchema);
      const names = new Set(existing.map((m) => m.storedName));
      for (const name of await fs.readdir(this.dir)) {
        if (
          !/^[a-f0-9-]+\.(jpg|png|webp|gif|mp4|webm)$/.test(name) ||
          names.has(name)
        )
          continue;
        const file = path.join(this.dir, name);
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs > 3600000)
          await fs.rm(file, { force: true });
      }
    });
  }
  async cleanExpired() {
    const { retentionDays } = await this.settings();
    if (!retentionDays) return 0;
    const cutoff = Date.now() - retentionDays * 86400000;
    const ids = (await this.list())
      .filter((m) => Date.parse(m.createdAt) < cutoff && !this.leases.has(m.id))
      .map((m) => m.id);
    return ids.length ? this.remove(ids) : 0;
  }
}
