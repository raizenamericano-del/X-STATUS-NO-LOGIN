import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/server/config.js";
import { sessionSecret } from "../src/services/sessions.js";
import { startupDiagnostic } from "../src/server/startup-error.js";

test("empty environment boots open-access config; obsolete login variables are ignored", () => {
  const c = loadConfig({});
  assert.equal(c.accessMode, "open");
  assert.equal(c.port, 3000);
  const obsolete = loadConfig({
    APP_USERNAME: "invalid username",
    APP_PASSWORD_HASH: "plain",
    SESSION_SECRET: "x",
  });
  assert.equal(obsolete.username, undefined);
  assert.equal(obsolete.passwordHash, undefined);
  assert.equal(obsolete.sessionSecret, undefined);
});
test("Railway domain and numeric defaults do not need login configuration", () => {
  const c = loadConfig({
    NODE_ENV: "production",
    RAILWAY_PUBLIC_DOMAIN: "statusx-example.up.railway.app",
    PUBLIC_ORIGIN: "",
    TRUST_PROXY: "",
    MAX_FILE_MB: "",
    PORT: "",
  });
  assert.equal(c.publicOrigin, "https://statusx-example.up.railway.app");
  assert.equal(c.trustProxy, 1);
  assert.equal(c.port, 3000);
  assert.equal(
    loadConfig({ PUBLIC_ORIGIN: "my-domain.example/" }).publicOrigin,
    "https://my-domain.example",
  );
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: "https://" }), {
    code: "INVALID_PUBLIC_ORIGIN",
  });
  assert.throws(
    () => loadConfig({ MAX_FILE_MB: "abc" }),
    (e) => e.message.includes("MAX_FILE_MB") && e.code === "INVALID_NUMBER",
  );
});
test("CSRF signing key is automatic, persistent and private; broken key is renewed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "statusx-open-key-"));
  try {
    const config = { dataDir: dir, sessionSecret: "ignored" };
    const a = await sessionSecret(config);
    assert.match(a, /^[a-f0-9]{96}$/);
    assert.equal(await sessionSecret(config), a);
    const file = path.join(dir, "secrets/session.key");
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await fs.writeFile(file, "broken");
    assert.notEqual(await sessionSecret(config), a);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("startup diagnostics do not print arbitrary secrets", () => {
  for (const code of ["EACCES", "ENOSPC", "UNKNOWN"]) {
    const result = startupDiagnostic(
      Object.assign(new Error("DONT_PRINT_ME"), { code }),
      "storage",
    );
    assert.ok(!JSON.stringify(result).includes("DONT_PRINT_ME"));
  }
});
