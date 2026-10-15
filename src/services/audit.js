import fs from "node:fs/promises";
import path from "node:path";
import { Mutex } from "../utils/files.js";
export function auditLog(dir) {
  const mutex = new Mutex();
  const file = path.join(dir, "events.log");
  return async (event) => {
    if (!/^[A-Z_]{3,50}$/.test(event)) return;
    await mutex
      .run(async () => {
        const stat = await fs.stat(file).catch(() => null);
        if (stat?.size > 1024 * 1024) {
          await fs.rm(file + ".1", { force: true });
          await fs.rename(file, file + ".1");
        }
        await fs.appendFile(
          file,
          JSON.stringify({ time: new Date().toISOString(), event }) + "\n",
          { mode: 0o600 },
        );
      })
      .catch(() => {});
  };
}
