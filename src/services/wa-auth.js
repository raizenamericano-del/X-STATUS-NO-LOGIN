// Single-process file auth adapter. Atomic writes + serialized mutations, no DB.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWrite, ensureDir, Mutex } from "../utils/files.js";
export async function createAuthState(
  dir,
  { BufferJSON, initAuthCreds, proto },
) {
  await ensureDir(dir);
  const mutex = new Mutex();
  let enabled = true;
  const keyFile = (key) =>
    path.join(
      dir,
      key === "creds"
        ? "creds.json"
        : `${crypto.createHash("sha256").update(key).digest("hex")}.json`,
    );
  const read = async (key) => {
    try {
      return JSON.parse(
        await fs.readFile(keyFile(key), "utf8"),
        BufferJSON.reviver,
      );
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  const creds = (await read("creds")) || initAuthCreds();
  const state = {
    creds,
    keys: {
      get: (type, ids) =>
        mutex.run(async () => {
          const result = {};
          for (const id of ids) {
            let value = await read(`${type}:${id}`);
            if (type === "app-state-sync-key" && value)
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[id] = value;
          }
          return result;
        }),
      set: (data) =>
        mutex.run(async () => {
          if (!enabled) return;
          for (const [type, entries] of Object.entries(data))
            for (const [id, value] of Object.entries(entries)) {
              const file = keyFile(`${type}:${id}`);
              if (value)
                await atomicWrite(
                  file,
                  JSON.stringify(value, BufferJSON.replacer),
                );
              else await fs.rm(file, { force: true });
            }
        }),
    },
  };
  return {
    state,
    saveCreds: () =>
      mutex.run(async () => {
        if (enabled)
          await atomicWrite(
            keyFile("creds"),
            JSON.stringify(creds, BufferJSON.replacer),
          );
      }),
    close: () =>
      mutex.run(async () => {
        enabled = false;
      }),
  };
}
