import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}
export async function atomicWrite(file, data) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}
export class Mutex {
  tail = Promise.resolve();
  async run(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((r) => (release = r));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
export const isId = (id) =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
export const safeName = (name) =>
  path
    .basename(String(name || "media").replace(/\\/g, "/"))
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 140) || "media";
