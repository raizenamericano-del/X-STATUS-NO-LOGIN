import session from "express-session";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWrite, ensureDir, Mutex } from "../utils/files.js";
export class FileSessions extends session.Store {
  constructor(dir, ttl) {
    super();
    this.dir = dir;
    this.ttl = ttl;
    this.mutex = new Mutex();
  }
  file(sid) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(sid))
      throw new Error("Invalid session identifier");
    return path.join(this.dir, `${sid}.json`);
  }
  get(sid, callback) {
    this.mutex
      .run(async () => {
        try {
          const data = JSON.parse(await fs.readFile(this.file(sid), "utf8"));
          if (
            !data.cookie ||
            !Number.isFinite(new Date(data.cookie.expires).getTime()) ||
            new Date(data.cookie.expires).getTime() <= Date.now()
          ) {
            await fs.rm(this.file(sid), { force: true });
            return null;
          }
          return data;
        } catch (e) {
          if (e.code === "ENOENT" || e instanceof SyntaxError) return null;
          throw e;
        }
      })
      .then((v) => callback(null, v), callback);
  }
  set(sid, value, callback = () => {}) {
    this.mutex
      .run(() => atomicWrite(this.file(sid), JSON.stringify(value)))
      .then(() => callback(), callback);
  }
  destroy(sid, callback = () => {}) {
    this.mutex
      .run(() => fs.rm(this.file(sid), { force: true }))
      .then(() => callback(), callback);
  }
  touch(sid, value, callback = () => {}) {
    this.mutex
      .run(async () => {
        try {
          const old = JSON.parse(await fs.readFile(this.file(sid), "utf8"));
          old.cookie = value.cookie;
          await atomicWrite(this.file(sid), JSON.stringify(old));
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      })
      .then(() => callback(), callback);
  }
  async sweep() {
    await ensureDir(this.dir);
    await this.mutex.run(async () => {
      for (const name of await fs.readdir(this.dir)) {
        if (!name.endsWith(".json")) continue;
        const file = path.join(this.dir, name);
        try {
          const data = JSON.parse(await fs.readFile(file, "utf8"));
          if (
            !data.cookie ||
            !Number.isFinite(new Date(data.cookie.expires).getTime()) ||
            new Date(data.cookie.expires).getTime() <= Date.now()
          )
            await fs.rm(file, { force: true });
        } catch {
          await fs.rm(file, { force: true });
        }
      }
    });
  }
}
export async function sessionSecret(config) {
  const file = path.join(config.dataDir, "secrets", "session.key");
  let existing;
  try {
    existing = (await fs.readFile(file, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing && /^[a-f0-9]{96}$/.test(existing)) return existing;
  const value = crypto.randomBytes(48).toString("hex");
  await atomicWrite(file, value);
  // Never use an empty/truncated signing key. Renewal invalidates old cookies.
  return value;
}
