import path from "node:path";

export class ConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}
const text = (value) => String(value ?? "").trim();
function number(env, key, fallback, min, max) {
  const value = text(env[key]);
  const n = value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ConfigurationError(
      "INVALID_NUMBER",
      `${key} harus bilangan bulat antara ${min} dan ${max}. Kosongkan untuk nilai bawaan.`,
    );
  return n;
}
function origin(env) {
  const raw = text(env.PUBLIC_ORIGIN) || text(env.RAILWAY_PUBLIC_DOMAIN);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\s/.test(url.hostname) ||
      !url.hostname
    )
      throw new Error("Invalid origin");
  } catch {
    throw new ConfigurationError(
      "INVALID_PUBLIC_ORIGIN",
      "PUBLIC_ORIGIN tidak valid. Isi domain aplikasi (https://domain-aplikasi), atau hapus variable agar memakai domain Railway otomatis.",
    );
  }
  return url.origin;
}
export function loadConfig(env = process.env) {
  // Open-access edition: obsolete username/password variables are intentionally ignored.
  const production = env.NODE_ENV === "production";
  return {
    accessMode: "open",
    production,
    port: number(env, "PORT", 3000, 0, 65535),
    host: "0.0.0.0",
    dataDir: path.resolve(text(env.DATA_DIR) || "data"),
    // No SESSION_SECRET variable. A private signing key is generated on disk.
    publicOrigin: origin(env),
    trustProxy: number(env, "TRUST_PROXY", production ? 1 : 0, 0, 3),
    maxFileBytes: number(env, "MAX_FILE_MB", 40, 1, 100) * 1024 * 1024,
    maxStorageBytes:
      number(env, "MAX_STORAGE_MB", 512, 50, 10240) * 1024 * 1024,
    maxBatchBytes: number(env, "MAX_ZIP_MB", 200, 1, 500) * 1024 * 1024,
    sessionMs: number(env, "SESSION_HOURS", 12, 1, 72) * 3600000,
    baileysEnabled: env.BAILEYS_ENABLED !== "false",
    frameAncestors: env.ALLOW_EMBED_PREVIEW === "true" ? null : ["'self'"],
  };
}
