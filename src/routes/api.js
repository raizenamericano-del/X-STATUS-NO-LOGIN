import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { asyncRoute, AppError, invalid } from "../utils/errors.js";
import { isId } from "../utils/files.js";
import { rateLimit } from "../middleware/security.js";
const publicMedia = (m) => {
  const { storedName, sourceId, ...publicData } = m;
  return publicData;
};
export function apiRoutes({ config, media, downloads, wa, audit }) {
  const router = Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(config.dataDir, "tmp"),
      filename: (req, file, cb) => {
        if (req.aborted) return cb(new Error("Upload aborted"));
        const name = `${crypto.randomUUID()}.upload`;
        (req.uploadPaths ||= []).push(path.join(config.dataDir, "tmp", name));
        cb(null, name);
      },
    }),
    limits: {
      fileSize: config.maxFileBytes,
      files: 10,
      fields: 2,
      parts: 12,
      fieldSize: 1024,
    },
  }).array("files", 10);
  let uploadActive = 0;
  router.get(
    "/overview",
    asyncRoute(async (req, res) => {
      const [items, history, settings, whatsapp] = await Promise.all([
        media.list(),
        downloads.history(),
        media.settings(),
        wa.snapshot(),
      ]);
      res.json({
        accessMode: "open",
        workspaceName: settings.displayName,
        settings,
        whatsapp,
        stats: {
          count: items.length,
          images: items.filter((m) => m.type === "image").length,
          videos: items.filter((m) => m.type === "video").length,
          bytes: items.reduce((s, m) => s + m.size, 0),
          downloads: history.filter((h) => h.status === "delivered").length,
        },
        limits: {
          maxFileBytes: config.maxFileBytes,
          maxStorageBytes: config.maxStorageBytes,
          maxBatchBytes: config.maxBatchBytes,
          maxFiles: 10,
        },
        recent: items.slice(0, 6).map(publicMedia),
      });
    }),
  );
  router.get(
    "/media",
    asyncRoute(async (req, res) =>
      res.json({ items: (await media.list()).map(publicMedia) }),
    ),
  );
  router.post(
    "/media/import",
    rateLimit({ max: 30, windowMs: 600000 }),
    (req, res, next) => {
      if (uploadActive >= 2)
        return next(
          new AppError(
            429,
            "UPLOAD_BUSY",
            "Dua upload sedang berlangsung. Tunggu sebentar.",
          ),
        );
      uploadActive++;
      let released = false;
      const release = () => {
        if (!released) {
          uploadActive--;
          released = true;
        }
      };
      res.once("close", release);
      req.once("aborted", () => {
        release();
        Promise.all(
          (req.uploadPaths || []).map((file) =>
            fs.rm(file, { force: true }).catch(() => {}),
          ),
        ).catch(() => {});
      });
      upload(req, res, async (err) => {
        const files = req.files || [];
        try {
          if (err) throw err;
          if (!files.length) throw invalid("Pilih file yang ingin diimpor.");
          if (req.body.authorized !== "true")
            throw invalid(
              "Konfirmasikan bahwa kamu berhak menyimpan media ini.",
            );
          const accepted = [],
            rejected = [];
          for (const file of files) {
            try {
              const item = await media.add(file.path, {
                name: file.originalname,
                source: "import",
              });
              if (item) accepted.push(publicMedia(item));
            } catch (e) {
              rejected.push({
                name: String(file.originalname).slice(0, 140),
                message:
                  e instanceof AppError
                    ? e.message
                    : "File tidak dapat disimpan.",
              });
            }
          }
          await audit("MEDIA_IMPORT");
          res.status(accepted.length ? 201 : 400).json({
            items: accepted,
            rejected,
            ...(!accepted.length
              ? {
                  error: {
                    code: "UPLOAD_REJECTED",
                    message: rejected[0]?.message || "Semua file ditolak.",
                  },
                }
              : {}),
          });
        } catch (e) {
          next(e);
        } finally {
          await Promise.all(
            files.map((f) => fs.rm(f.path, { force: true }).catch(() => {})),
          );
          release();
        }
      });
    },
  );
  router.get(
    "/media/:id/content",
    asyncRoute(async (req, res, next) => {
      if (!isId(req.params.id)) throw invalid("ID media tidak valid.");
      const lease = await media.lease([req.params.id]);
      const m = lease.entries[0];
      res.once("close", lease.release);
      res.set({
        "Content-Type": m.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      });
      res.sendFile(media.file(m), { acceptRanges: true }, (err) => {
        lease.release();
        if (err && !res.headersSent)
          next(new AppError(404, "FILE_MISSING", "File media tidak tersedia."));
      });
    }),
  );
  router.delete(
    "/media",
    asyncRoute(async (req, res) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 100)
        throw invalid("Pilih 1–100 file untuk dihapus.");
      const count = await media.remove(ids);
      await audit("MEDIA_DELETE");
      res.json({ count });
    }),
  );
  router.post(
    "/downloads",
    rateLimit({ max: 30, windowMs: 600000 }),
    asyncRoute(async (req, res) => {
      const job = await downloads.create(req.body?.ids);
      if (res.destroyed && !res.writableEnded) {
        await downloads.finish(job.id, "cancelled");
        return;
      }
      await audit("DOWNLOAD_PREPARED");
      res.status(201).json({ job });
    }),
  );
  router.get(
    "/downloads/:id/file",
    asyncRoute(async (req, res, next) => {
      const job = downloads.get(req.params.id);
      if (job.busy)
        throw new AppError(
          409,
          "DOWNLOAD_BUSY",
          "Paket ini sedang ditransfer.",
        );
      job.busy = true;
      await downloads.patch(job.id, { status: "transferring" });
      let finished = false;
      res.once("finish", () => {
        finished = true;
        job.busy = false;
        downloads.patch(job.id, { status: "transferred" }).catch(() => {});
      });
      res.once("close", () => {
        job.busy = false;
        if (!finished)
          downloads.patch(job.id, { status: "cancelled" }).catch(() => {});
      });
      res.set({
        "Content-Type": job.mime,
        "Cache-Control": "private, no-store",
      });
      res.download(job.file, job.name, (err) => {
        job.busy = false;
        if (err && !res.headersSent)
          next(
            new AppError(
              500,
              "TRANSFER_FAILED",
              "Transfer file gagal. Coba siapkan ulang.",
            ),
          );
      });
    }),
  );
  router.post(
    "/downloads/:id/complete",
    asyncRoute(async (req, res) => {
      if (!isId(req.params.id)) throw invalid("ID tidak valid.");
      await downloads.finish(req.params.id, req.body?.status);
      res.json({ ok: true });
    }),
  );
  router.get(
    "/history",
    asyncRoute(async (req, res) =>
      res.json({ items: await downloads.history() }),
    ),
  );
  router.delete(
    "/history",
    asyncRoute(async (req, res) => {
      await downloads.clear();
      await audit("HISTORY_CLEARED");
      res.json({ ok: true });
    }),
  );
  router.get(
    "/settings",
    asyncRoute(async (req, res) =>
      res.json({ settings: await media.settings() }),
    ),
  );
  router.patch(
    "/settings",
    asyncRoute(async (req, res) => {
      const settings = await media.updateSettings(req.body);
      wa.updateSettings(settings);
      await audit("SETTINGS_UPDATED");
      res.json({ settings });
    }),
  );
  router.post(
    "/maintenance/cleanup",
    asyncRoute(async (req, res) => {
      const count = await media.cleanExpired();
      await media.reconcile();
      await downloads.sweep();
      await audit("CLEANUP");
      res.json({ count });
    }),
  );
  router.get(
    "/whatsapp",
    asyncRoute(async (req, res) => res.json(await wa.snapshot())),
  );
  router.post(
    "/whatsapp/connect",
    rateLimit({ max: 5, windowMs: 10 * 60000 }),
    asyncRoute(async (req, res) => {
      const status = await wa.connect(req.body);
      await audit("WA_CONNECT_REQUESTED");
      res.status(202).json(status);
    }),
  );
  router.post(
    "/whatsapp/cancel",
    asyncRoute(async (req, res) => {
      if (wa.state.state === "connected")
        throw new AppError(
          409,
          "ALREADY_CONNECTED",
          "Akun sudah terhubung. Gunakan tombol putuskan koneksi.",
        );
      await wa.stop({ clear: true });
      await audit("WA_CANCELLED");
      res.json(await wa.snapshot());
    }),
  );
  router.post(
    "/whatsapp/disconnect",
    asyncRoute(async (req, res) => {
      await wa.stop({ logout: true, clear: true });
      await audit("WA_DISCONNECTED");
      res.json(await wa.snapshot());
    }),
  );
  return router;
}
