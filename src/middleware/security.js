import crypto from "node:crypto";
import { AppError } from "../utils/errors.js";
export function csrf(config) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    const allowed =
      config.publicOrigin || `${req.protocol}://${req.get("host")}`;
    if (origin && origin !== allowed)
      return next(
        new AppError(
          403,
          "ORIGIN_REJECTED",
          "Origin permintaan tidak diizinkan.",
        ),
      );
    const token = req.get("x-csrf-token") || "";
    const expected = req.session?.csrf || "";
    if (
      !expected ||
      !/^[a-f0-9]{64}$/.test(token) ||
      token.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
      return next(
        new AppError(
          403,
          "CSRF_REJECTED",
          "Sesi formulir kedaluwarsa. Muat ulang halaman.",
        ),
      );
    next();
  };
}
export function rateLimit({
  max = 10,
  windowMs = 600000,
  key = (req) => req.ip,
} = {}) {
  const entries = new Map();
  let nextSweep = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now > nextSweep) {
      for (const [k, v] of entries) if (v.until < now) entries.delete(k);
      nextSweep = now + 60000;
    }
    const k = key(req);
    let state = entries.get(k);
    if (!state || now > state.until) {
      state = { count: 0, until: now + windowMs };
      entries.set(k, state);
    }
    state.count++;
    if (state.count > max) {
      res.set("Retry-After", String(Math.ceil((state.until - now) / 1000)));
      return next(
        new AppError(
          429,
          "RATE_LIMITED",
          "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.",
        ),
      );
    }
    next();
  };
}
export const newCsrf = () => crypto.randomBytes(32).toString("hex");
