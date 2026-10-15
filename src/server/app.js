import express from "express";
import session from "express-session";
import helmet from "helmet";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../utils/files.js";
import { JsonStore } from "../services/json-store.js";
import { FileSessions, sessionSecret } from "../services/sessions.js";
import { MediaLibrary } from "../services/media.js";
import { Downloads } from "../services/downloads.js";
import { WhatsApp } from "../services/whatsapp.js";
import { auditLog } from "../services/audit.js";
import { csrf, newCsrf, rateLimit } from "../middleware/security.js";
import { apiRoutes } from "../routes/api.js";
import { AppError } from "../utils/errors.js";
export async function createApp(config) {
  process.umask(0o077);
  for (const dir of [
    "",
    "media",
    "tmp",
    "sessions/web",
    "sessions/whatsapp",
    "logs",
    "secrets",
  ])
    await ensureDir(path.join(config.dataDir, dir));
  const store = new JsonStore(config.dataDir);
  await store.init();
  const media = new MediaLibrary(config, store);
  await media.init();
  const downloads = new Downloads(config, store, media);
  await downloads.init();
  const wa = new WhatsApp(config, media);
  const audit = auditLog(path.join(config.dataDir, "logs"));
  const sessionStore = new FileSessions(
    path.join(config.dataDir, "sessions/web"),
    config.sessionMs,
  );
  await sessionStore.sweep();
  async function cleanupTmp() {
    for (const name of await fs.readdir(path.join(config.dataDir, "tmp"))) {
      if (!/^[a-f0-9-]+\.(upload|zip)$/.test(name)) continue;
      const f = path.join(config.dataDir, "tmp", name);
      const stat = await fs.stat(f).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 3600000)
        await fs.rm(f, { force: true });
    }
  }
  async function cleanupAtomicTemps() {
    for (const sub of ["", "sessions/web", "sessions/whatsapp", "secrets"]) {
      const folder = path.join(config.dataDir, sub);
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".tmp")) continue;
        const file = path.join(folder, entry.name),
          stat = await fs.stat(file).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 3600000)
          await fs.rm(file, { force: true });
      }
    }
  }
  await cleanupTmp();
  await cleanupAtomicTemps();
  await media.cleanExpired();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"],
    mediaSrc: ["'self'", "blob:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: config.frameAncestors,
    upgradeInsecureRequests: config.production ? [] : null,
  };
  app.use(
    helmet({
      contentSecurityPolicy: { directives },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.production ? undefined : false,
      xFrameOptions: config.frameAncestors ? { action: "sameorigin" } : false,
    }),
  );
  app.get("/health", (req, res) =>
    res.json({
      status: "ok",
      app: "STATUSX",
      version: "1.1.0",
      accessMode: "open",
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(
    session({
      name: "statusx.sid",
      secret: await sessionSecret(config),
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.production ? "auto" : false,
        sameSite: "lax",
        maxAge: config.sessionMs,
        path: "/",
      },
    }),
  );
  app.use(
    "/api",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    rateLimit({ max: 300, windowMs: 60000 }),
    csrf(config),
  );
  app.get("/api/session", (req, res) => {
    // This cookie/token is only for CSRF, NOT authentication or authorization.
    delete req.session.username;
    delete req.session.authVersion;
    if (!req.session.csrf) req.session.csrf = newCsrf();
    res.json({
      accessMode: "open",
      version: "1.1.0",
      csrfToken: req.session.csrf,
    });
  });
  app.use("/api", apiRoutes({ config, media, downloads, wa, audit }));
  app.use("/api", (req, res) =>
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan." },
    }),
  );
  const publicDir = fileURLToPath(new URL("../../public", import.meta.url));
  for (const folder of ["css", "js", "assets"])
    app.use(
      `/${folder}`,
      express.static(path.join(publicDir, folder), {
        dotfiles: "deny",
        maxAge: "1h",
      }),
    );
  app.get("/favicon.svg", (req, res) =>
    res.sendFile(path.join(publicDir, "favicon.svg")),
  );
  app.get(["/login", "/login.html"], (req, res) => {
    res.set("Cache-Control", "no-store");
    res.redirect("/");
  });
  app.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "index.html"));
  });
  app.use((req, res) =>
    res.status(404).sendFile(path.join(publicDir, "404.html")),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return res.destroy();
    const known = err instanceof AppError;
    const upload = err?.name === "MulterError";
    const code = upload
      ? "UPLOAD_LIMIT"
      : known
        ? err.code
        : err?.type === "entity.parse.failed"
          ? "INVALID_JSON"
          : "INTERNAL_ERROR";
    const status = upload
      ? 413
      : known
        ? err.status
        : code === "INVALID_JSON"
          ? 400
          : 500;
    const message = upload
      ? "Batas upload terlampaui. Maksimal 10 file dan ukuran sesuai batas per file."
      : known
        ? err.message
        : code === "INVALID_JSON"
          ? "Format JSON tidak valid."
          : "Proses belum berhasil. Coba lagi atau periksa ruang penyimpanan server.";
    if (status === 500) audit("SERVER_ERROR");
    res.status(status).json({ error: { code, message } });
  });
  let running = false;
  const maintenance = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await downloads.sweep();
      await sessionStore.sweep();
      await cleanupTmp();
      await cleanupAtomicTemps();
      await media.cleanExpired();
    } catch {
      audit("MAINTENANCE_ERROR");
    } finally {
      running = false;
    }
  }, 60000);
  maintenance.unref();
  return {
    app,
    media,
    store,
    downloads,
    wa,
    audit,
    async close() {
      clearInterval(maintenance);
      await wa.stop();
      await downloads.stop();
    },
  };
}
