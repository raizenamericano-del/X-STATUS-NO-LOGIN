import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import archiver from "archiver";
import { AppError, invalid } from "../utils/errors.js";
import { isId, Mutex } from "../utils/files.js";
const schema = (a) =>
  Array.isArray(a) &&
  a.length <= 300 &&
  a.every(
    (x) =>
      x &&
      isId(x.id) &&
      Array.isArray(x.mediaIds) &&
      x.mediaIds.every(isId) &&
      typeof x.name === "string" &&
      typeof x.status === "string",
  );
export class Downloads {
  constructor(config, store, media) {
    this.config = config;
    this.store = store;
    this.media = media;
    this.jobs = new Map();
    this.active = 0;
    this.mutex = new Mutex();
  }
  async init() {
    await this.store.update(
      "history.json",
      [],
      (a) =>
        a.map((x) =>
          ["preparing", "ready", "transferring"].includes(x.status)
            ? {
                ...x,
                status: "expired",
                error: "Server dimulai ulang; siapkan unduhan lagi.",
              }
            : x,
        ),
      schema,
    );
  }
  history() {
    return this.store.read("history.json", [], schema);
  }
  async patch(id, change) {
    return this.store.update(
      "history.json",
      [],
      (a) => a.map((x) => (x.id === id ? { ...x, ...change } : x)),
      schema,
    );
  }
  async clear() {
    if (this.active || [...this.jobs.values()].some((x) => x.busy))
      throw new AppError(
        409,
        "DOWNLOAD_BUSY",
        "Tunggu proses unduhan selesai sebelum menghapus riwayat.",
      );
    for (const id of [...this.jobs.keys()]) await this.discard(id);
    await this.store.write("history.json", [], schema);
  }
  async create(rawIds) {
    if (
      !Array.isArray(rawIds) ||
      !rawIds.length ||
      rawIds.length > 100 ||
      rawIds.some((id) => !isId(id))
    )
      throw invalid("Pilih 1–100 file media yang valid.");
    const ids = [...new Set(rawIds)];
    if (this.active >= 2)
      throw new AppError(
        429,
        "DOWNLOAD_BUSY",
        "Dua unduhan sedang disiapkan. Tunggu sebentar.",
      );
    if (this.jobs.size + this.active >= 5)
      throw new AppError(
        429,
        "TOO_MANY_JOBS",
        "Maksimal lima paket siap unduh. Selesaikan atau batalkan paket yang ada.",
      );
    this.active++;
    let lease, job;
    try {
      lease = await this.media.lease(ids);
      const total = lease.entries.reduce((n, m) => n + m.size, 0);
      if (total > this.config.maxBatchBytes)
        throw new AppError(
          413,
          "ZIP_TOO_LARGE",
          "Ukuran pilihan melampaui batas paket ZIP. Pilih lebih sedikit file.",
        );
      const id = crypto.randomUUID();
      const isZip = ids.length > 1;
      job = {
        id,
        mediaIds: ids,
        name: isZip
          ? `statusx-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 6)}.zip`
          : lease.entries[0].name,
        kind: isZip ? "zip" : "file",
        status: "preparing",
        createdAt: new Date().toISOString(),
        size: 0,
        error: null,
      };
      await this.store.update(
        "history.json",
        [],
        (a) => [job, ...a].slice(0, 300),
        schema,
      );
      let file, mime;
      if (isZip) {
        file = path.join(this.config.dataDir, "tmp", `${id}.zip`);
        mime = "application/zip";
        await new Promise((resolve, reject) => {
          const output = createWriteStream(file, { flags: "wx", mode: 0o600 });
          const archive = archiver("zip", { zlib: { level: 1 } });
          const timer = setTimeout(() => {
            archive.abort();
            output.destroy(new Error("ZIP timeout"));
          }, 120000);
          const fail = (e) => {
            clearTimeout(timer);
            archive.abort();
            output.destroy();
            reject(e);
          };
          output.on("close", () => {
            clearTimeout(timer);
            resolve();
          });
          output.on("error", fail);
          archive.on("error", fail);
          archive.on("warning", fail);
          archive.pipe(output);
          lease.entries.forEach((m, i) =>
            archive.file(this.media.file(m), {
              name: `${String(i + 1).padStart(2, "0")}-${m.name}`,
            }),
          );
          archive.finalize().catch(fail);
        });
        lease.release();
        lease = null;
      } else {
        file = this.media.file(lease.entries[0]);
        mime = lease.entries[0].mime;
      }
      const stat = await fs.stat(file);
      const record = { ...job, size: stat.size, status: "ready" };
      this.jobs.set(id, {
        ...record,
        file,
        mime,
        expiresAt: Date.now() + 15 * 60000,
        release: lease?.release,
        busy: false,
      });
      lease = null;
      await this.patch(id, { size: stat.size, status: "ready" });
      return record;
    } catch (e) {
      lease?.release();
      if (job) {
        await fs.rm(path.join(this.config.dataDir, "tmp", `${job.id}.zip`), {
          force: true,
        });
        await this.patch(job.id, {
          status: "failed",
          error:
            "Paket tidak dapat disiapkan. Periksa ruang penyimpanan dan coba lagi.",
        });
      }
      throw e;
    } finally {
      this.active--;
    }
  }
  get(id) {
    if (!isId(id)) throw invalid("ID unduhan tidak valid.");
    const job = this.jobs.get(id);
    if (!job || job.expiresAt < Date.now())
      throw new AppError(
        410,
        "DOWNLOAD_EXPIRED",
        "Paket kedaluwarsa. Gunakan tombol coba lagi.",
      );
    return job;
  }
  async discard(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.busy)
      throw new AppError(
        409,
        "DOWNLOAD_BUSY",
        "Batalkan transfer terlebih dahulu.",
      );
    this.jobs.delete(id);
    job.release?.();
    if (job.kind === "zip") await fs.rm(job.file, { force: true });
  }
  async finish(id, status) {
    if (!["delivered", "cancelled", "failed"].includes(status))
      throw invalid("Status unduhan tidak valid.");
    const job = this.jobs.get(id);
    if (job?.busy)
      throw new AppError(
        409,
        "DOWNLOAD_BUSY",
        "Transfer masih aktif, coba lagi sesaat.",
      );
    await this.patch(id, { status, completedAt: new Date().toISOString() });
    await this.discard(id);
  }
  async sweep() {
    for (const [id, job] of this.jobs) {
      if (!job.busy && job.expiresAt < Date.now()) {
        await this.patch(id, { status: "expired" });
        await this.discard(id);
      }
    }
  }
  async stop() {
    for (const [id, job] of this.jobs) {
      job.busy = false;
      await this.discard(id);
    }
  }
}
