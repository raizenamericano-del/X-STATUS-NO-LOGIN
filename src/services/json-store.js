import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, ensureDir, Mutex } from "../utils/files.js";
export class JsonStore {
  constructor(root) {
    this.root = root;
    this.locks = new Map();
  }
  file(key) {
    if (!/^[a-z0-9-]+\.json$/.test(key)) throw new Error("Invalid store key");
    return path.join(this.root, key);
  }
  lock(key) {
    if (!this.locks.has(key)) this.locks.set(key, new Mutex());
    return this.locks.get(key);
  }
  async init() {
    await ensureDir(this.root);
  }
  async read(key, fallback, validate = () => true) {
    let text;
    try {
      text = await fs.readFile(this.file(key), "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return structuredClone(fallback);
      throw e;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error(`Invalid JSON store: ${key}`), {
        code: "STORE_JSON_INVALID",
        storeKey: key,
      });
    }
    if (!validate(data))
      throw Object.assign(new Error(`Invalid store schema: ${key}`), {
        code: "STORE_SCHEMA_INVALID",
        storeKey: key,
      });
    return data;
  }
  async update(key, fallback, fn, validate = () => true) {
    return this.lock(key).run(async () => {
      const data = await this.read(key, fallback, validate);
      const result = await fn(data);
      if (!validate(result)) throw new Error("Invalid data schema");
      await atomicWrite(this.file(key), JSON.stringify(result, null, 2));
      return result;
    });
  }
  async write(key, data, validate = () => true) {
    return this.update(key, data, () => data, validate);
  }
}
