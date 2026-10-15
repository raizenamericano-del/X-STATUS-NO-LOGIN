import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import request from "supertest";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { JsonStore } from "../src/services/json-store.js";
import { normalizePhone, permittedStatus } from "../src/services/wa-filter.js";
import { createAuthState } from "../src/services/wa-auth.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
  "base64",
);
let runtime, dir, config;
const legacySentinel = crypto.randomBytes(20).toString("hex");
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "statusx-test-"));
  config = loadConfig({
    DATA_DIR: dir,
    BAILEYS_ENABLED: "false",
    MAX_FILE_MB: "1",
    TRUST_PROXY: "0",
  });
  runtime = await createApp(config);
});
beforeEach(async () => {
  await runtime.close();
  runtime = await createApp(config);
});
after(async () => {
  await runtime?.close();
  await fs.rm(dir, { recursive: true, force: true });
});
async function browserSession() {
  const agent = request.agent(runtime.app);
  const initial = await agent.get("/api/session").expect(200);
  return { agent, token: initial.body.csrfToken };
}
async function upload(ctx, name = "test.png") {
  return ctx.agent
    .post("/api/media/import")
    .set("X-CSRF-Token", ctx.token)
    .field("authorized", "true")
    .attach("files", png, name)
    .expect(201);
}

test("/health is public, minimal and honors app startup without leaking paths", async () => {
  const res = await request(runtime.app).get("/health").expect(200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.app, "STATUSX");
  assert.ok(!JSON.stringify(res.body).includes(dir));
});
test("dashboard opens directly and old credential variables have no effect", async () => {
  const res = await request(runtime.app).get("/").expect(200);
  assert.match(res.text, /Mode tanpa login/);
  assert.ok(!res.text.includes('id="loginForm"'));
  await request(runtime.app).get("/login").expect(302).expect("Location", "/");
  const parsed = loadConfig({
    APP_USERNAME: "bad user",
    APP_PASSWORD_HASH: "not-a-hash",
    SESSION_SECRET: "x",
    PORT: "4567",
  });
  assert.equal(parsed.accessMode, "open");
  assert.equal(parsed.port, 4567);
  assert.equal(parsed.username, undefined);
  assert.equal(parsed.passwordHash, undefined);
});
test("all feature APIs are accessible without authentication, raw server files are not", async () => {
  for (const endpoint of [
    "/api/overview",
    "/api/media",
    "/api/settings",
    "/api/history",
    "/api/whatsapp",
  ])
    await request(runtime.app).get(endpoint).expect(200);
  for (const endpoint of [
    "/data/settings.json",
    "/data/sessions/whatsapp/creds.json",
    "/.env",
    "/src/server/config.js",
    "/api/auth/session",
  ])
    await request(runtime.app).get(endpoint).expect(404);
});
test("anonymous CSRF cookie works without login; missing token and foreign origin are rejected", async () => {
  const ctx = await browserSession();
  const cookie = (await ctx.agent.get("/api/session")).headers["set-cookie"][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  await ctx.agent
    .patch("/api/settings")
    .send({ displayName: "Not allowed" })
    .expect(403);
  await ctx.agent
    .patch("/api/settings")
    .set("X-CSRF-Token", ctx.token)
    .set("Origin", "https://evil.example")
    .send({ displayName: "Not allowed" })
    .expect(403);
  await ctx.agent
    .patch("/api/settings")
    .set("X-CSRF-Token", ctx.token)
    .send({ displayName: "Open workspace" })
    .expect(200);
});
test("JSON metadata updates are serialized; invalid JSON is not silently overwritten", async () => {
  const store = new JsonStore(path.join(dir, "test-json"));
  await store.init();
  await Promise.all(
    Array.from({ length: 50 }, () =>
      store.update("counter.json", { value: 0 }, (x) => ({
        value: x.value + 1,
      })),
    ),
  );
  assert.equal((await store.read("counter.json", {})).value, 50);
  await fs.writeFile(path.join(dir, "test-json", "broken.json"), "not json");
  await assert.rejects(store.read("broken.json", []), /Invalid JSON/);
  assert.throws(() => store.file("../secrets.json"));
});
test("upload actual image, safe filename, open-access preview and Range download", async () => {
  const ctx = await browserSession();
  const result = await upload(ctx, 'strange"name.png');
  const m = result.body.items[0];
  assert.equal(m.type, "image");
  assert.equal(m.mime, "image/png");
  assert.ok(!m.storedName);
  assert.ok(!m.name.includes('"'));
  const preview = await ctx.agent.get(`/api/media/${m.id}/content`).expect(200);
  assert.match(preview.headers["content-type"], /image\/png/);
  assert.match(preview.headers["cache-control"], /private/);
  await request(runtime.app).get(`/api/media/${m.id}/content`).expect(200);
  const partial = await ctx.agent
    .get(`/api/media/${m.id}/content`)
    .set("Range", "bytes=0-7")
    .expect(206);
  assert.equal(partial.headers["content-length"], "8");
  const meta = JSON.parse(
    await fs.readFile(path.join(dir, "media.json"), "utf8"),
  );
  assert.ok(meta.some((item) => item.id === m.id));
});
test("upload rejects spoofed HTML/SVG, over-limit, missing consent, cleans temporary files", async () => {
  const ctx = await browserSession();
  await ctx.agent
    .post("/api/media/import")
    .set("X-CSRF-Token", ctx.token)
    .field("authorized", "true")
    .attach("files", Buffer.from("<script>alert(1)</script>"), "fake.jpg")
    .expect(400);
  await ctx.agent
    .post("/api/media/import")
    .set("X-CSRF-Token", ctx.token)
    .field("authorized", "true")
    .attach(
      "files",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "fake.svg",
    )
    .expect(400);
  await ctx.agent
    .post("/api/media/import")
    .set("X-CSRF-Token", ctx.token)
    .attach("files", png, "missing-consent.png")
    .expect(400);
  await ctx.agent
    .post("/api/media/import")
    .set("X-CSRF-Token", ctx.token)
    .field("authorized", "true")
    .attach("files", Buffer.alloc(1048577), "big.mp4")
    .expect(413);
  assert.equal(
    (await fs.readdir(path.join(dir, "tmp"))).filter((x) =>
      x.endsWith(".upload"),
    ).length,
    0,
  );
});
test("individual download is real bytes with attachment, acknowledged history persists", async () => {
  const ctx = await browserSession();
  const uploaded = await upload(ctx);
  const id = uploaded.body.items[0].id;
  const created = await ctx.agent
    .post("/api/downloads")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: [id] })
    .expect(201);
  const job = created.body.job;
  assert.equal(job.size, png.length);
  const dl = await ctx.agent.get(`/api/downloads/${job.id}/file`).expect(200);
  assert.match(dl.headers["content-disposition"], /attachment/);
  assert.deepEqual(dl.body, png);
  await ctx.agent
    .post(`/api/downloads/${job.id}/complete`)
    .set("X-CSRF-Token", ctx.token)
    .send({ status: "delivered" })
    .expect(200);
  const history = await ctx.agent.get("/api/history");
  assert.equal(
    history.body.items.find((h) => h.id === job.id).status,
    "delivered",
  );
  await ctx.agent.get(`/api/downloads/${job.id}/file`).expect(410);
});
test("selected multiple media create valid ZIP; temporary archive removed on completion", async () => {
  const ctx = await browserSession();
  const a = await upload(ctx, "a.png");
  const b = await upload(ctx, "b.png");
  const ids = [a.body.items[0].id, b.body.items[0].id];
  const created = await ctx.agent
    .post("/api/downloads")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids })
    .expect(201);
  const job = created.body.job;
  const file = path.join(dir, "tmp", `${job.id}.zip`);
  const contents = await fs.readFile(file);
  assert.equal(contents.subarray(0, 2).toString(), "PK");
  assert.ok(contents.includes(Buffer.from("01-a.png")));
  assert.ok(contents.includes(Buffer.from("02-b.png")));
  assert.equal(contents.length, job.size);
  await ctx.agent
    .get(`/api/downloads/${job.id}/file`)
    .expect(200)
    .expect("Content-Type", "application/zip");
  await ctx.agent
    .post(`/api/downloads/${job.id}/complete`)
    .set("X-CSRF-Token", ctx.token)
    .send({ status: "delivered" })
    .expect(200);
  await assert.rejects(fs.access(file));
});
test("delete removes actual file and catalog entry; in-use media is protected", async () => {
  const ctx = await browserSession();
  const result = await upload(ctx, "delete.png");
  const id = result.body.items[0].id;
  const entry = await runtime.media.get(id);
  const lease = await runtime.media.lease([id]);
  await ctx.agent
    .delete("/api/media")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: [id] })
    .expect(409);
  lease.release();
  await ctx.agent
    .delete("/api/media")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: [id] })
    .expect(200);
  await assert.rejects(fs.access(runtime.media.file(entry)));
  await ctx.agent.get(`/api/media/${id}/content`).expect(404);
  assert.ok(!(await runtime.media.list()).some((m) => m.id === id));
});
test("host paths, forged IDs and invalid settings cannot access arbitrary files", async () => {
  const ctx = await browserSession();
  await ctx.agent.get("/api/media/not-a-uuid/content").expect(400);
  await ctx.agent
    .delete("/api/media")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: ["../../.env"] })
    .expect(400);
  await ctx.agent
    .post("/api/downloads")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: ["/etc/passwd"] })
    .expect(400);
  await ctx.agent
    .patch("/api/settings")
    .set("X-CSRF-Token", ctx.token)
    .send({ dataDir: "/etc" })
    .expect(400);
  await ctx.agent
    .patch("/api/settings")
    .set("X-CSRF-Token", ctx.token)
    .send({ retentionDays: -1 })
    .expect(400);
});
test("settings persist, retention deletes expired media and history can be cleared", async () => {
  const ctx = await browserSession();
  await ctx.agent
    .patch("/api/settings")
    .set("X-CSRF-Token", ctx.token)
    .send({
      displayName: "Private archive",
      retentionDays: 1,
      reduceMotion: true,
      autoCollect: false,
    })
    .expect(200);
  const r = await upload(ctx, "old.png");
  const id = r.body.items[0].id;
  await runtime.store.update("media.json", [], (a) =>
    a.map((m) =>
      m.id === id
        ? { ...m, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() }
        : m,
    ),
  );
  const result = await ctx.agent
    .post("/api/maintenance/cleanup")
    .set("X-CSRF-Token", ctx.token)
    .expect(200);
  assert.equal(result.body.count, 1);
  assert.equal((await runtime.media.settings()).displayName, "Private archive");
  await ctx.agent
    .delete("/api/history")
    .set("X-CSRF-Token", ctx.token)
    .expect(200);
  assert.equal((await runtime.downloads.history()).length, 0);
});
test("disabled WhatsApp integration returns transparent error, no fake pairing code", async () => {
  const ctx = await browserSession();
  const s = await ctx.agent.get("/api/whatsapp").expect(200);
  assert.equal(s.body.enabled, false);
  assert.equal(s.body.pairingCode, null);
  assert.equal(s.body.qr, null);
  await ctx.agent
    .post("/api/whatsapp/connect")
    .set("X-CSRF-Token", ctx.token)
    .send({ method: "pairing", phone: "6281234567890", authorized: true })
    .expect(503);
  await ctx.agent
    .post("/api/whatsapp/disconnect")
    .set("X-CSRF-Token", ctx.token)
    .expect(200);
});
test("production behind HTTPS proxy sets Secure cookie", async () => {
  const prodDir = await fs.mkdtemp(path.join(os.tmpdir(), "statusx-secure-"));
  const instance = await createApp({
    ...config,
    dataDir: prodDir,
    production: true,
    trustProxy: 1,
  });
  try {
    const res = await request(instance.app)
      .get("/api/session")
      .set("X-Forwarded-Proto", "https");
    assert.match(res.headers["set-cookie"][0], /; Secure/);
    assert.match(res.headers["set-cookie"][0], /HttpOnly/);
  } finally {
    await instance.close();
    await fs.rm(prodDir, { recursive: true, force: true });
  }
});
test("phone normalization and status filter reject unauthorized/private/view-once/expired content", () => {
  assert.equal(normalizePhone("+62 812-3456-7890"), "6281234567890");
  assert.equal(normalizePhone("081234"), null);
  assert.equal(normalizePhone("not phone"), null);
  const m = {
    key: {
      remoteJid: "status@broadcast",
      id: "unique",
      participant: "owned-view",
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { imageMessage: { mimetype: "image/jpeg" } },
    pushName: "Contact",
  };
  assert.equal(permittedStatus(m).type, "image");
  assert.equal(
    permittedStatus({
      ...m,
      key: { ...m.key, remoteJid: "someone@s.whatsapp.net" },
    }),
    null,
  );
  assert.equal(
    permittedStatus({
      ...m,
      messageTimestamp: Math.floor(Date.now() / 1000) - 90000,
    }),
    null,
  );
  assert.equal(
    permittedStatus({
      ...m,
      message: { viewOnceMessage: { message: m.message } },
    }),
    null,
  );
  assert.equal(
    permittedStatus({ ...m, message: { imageMessage: { viewOnce: true } } }),
    null,
  );
  assert.equal(
    permittedStatus({ ...m, message: { conversation: "private" } }),
    null,
  );
});
test("file auth adapter uses atomic isolated keys and can reload credentials", async () => {
  const authDir = path.join(dir, "auth-adapter-test");
  const fake = {
    BufferJSON: {},
    initAuthCreds: () => ({ registered: false, testKey: "test-only" }),
    proto: { Message: { AppStateSyncKeyData: { fromObject: (x) => x } } },
  };
  const auth = await createAuthState(authDir, fake);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      auth.state.keys.set({ "test-key": { ["../../" + i]: { value: i } } }),
    ),
  );
  await auth.saveCreds();
  assert.equal(
    (await auth.state.keys.get("test-key", ["../../2"]))["../../2"].value,
    2,
  );
  const files = await fs.readdir(authDir);
  assert.equal(files.length, 11);
  assert.ok(
    files.every((x) => x === "creds.json" || /^[a-f0-9]{64}\.json$/.test(x)),
  );
  await auth.close();
  const reopened = await createAuthState(authDir, fake);
  assert.equal(reopened.state.creds.testKey, "test-only");
  await reopened.close();
});

test("bootstrap listens on assigned PORT and exits gracefully on SIGTERM without logging secrets", async () => {
  const { spawn } = await import("node:child_process");
  const childDir = await fs.mkdtemp(path.join(os.tmpdir(), "statusx-process-"));
  const child = spawn(process.execPath, ["src/server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_USERNAME: "legacy unused username",
      APP_PASSWORD_HASH: legacySentinel,
      DATA_DIR: childDir,
      PORT: "0",
      SESSION_SECRET: "old-short-value",
      NODE_ENV: "development",
      TRUST_PROXY: "0",
      BAILEYS_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Boot timeout")), 12000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const line = output.split("\n").find((x) => x.includes("SERVER_READY"));
        if (line) {
          clearTimeout(timer);
          resolve(JSON.parse(line));
        }
      });
      child.once("error", reject);
    });
    assert.ok(ready.port > 0);
    assert.equal(ready.host, "0.0.0.0");
    const health = await fetch(`http://127.0.0.1:${ready.port}/health`);
    assert.equal(health.status, 200);
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Shutdown timeout")),
        12000,
      );
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    child.kill("SIGTERM");
    assert.equal((await exited).code, 0);
    assert.ok(!output.includes(legacySentinel));
    assert.equal(errors, "");
    assert.ok(!output.includes(".env not found"));
    assert.ok(output.includes("automatic"));
  } finally {
    child.kill("SIGKILL");
    await fs.rm(childDir, { recursive: true, force: true });
  }
});

test("cancelled download releases media lease and can be retried with a new package", async () => {
  const ctx = await browserSession();
  const imported = await upload(ctx, "retry.png");
  const id = imported.body.items[0].id;
  const first = await ctx.agent
    .post("/api/downloads")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: [id] })
    .expect(201);
  await ctx.agent
    .post(`/api/downloads/${first.body.job.id}/complete`)
    .set("X-CSRF-Token", ctx.token)
    .send({ status: "cancelled" })
    .expect(200);
  assert.equal(runtime.media.leases.has(id), false);
  assert.equal(
    (await runtime.downloads.history()).find((h) => h.id === first.body.job.id)
      .status,
    "cancelled",
  );
  const retry = await ctx.agent
    .post("/api/downloads")
    .set("X-CSRF-Token", ctx.token)
    .send({ ids: [id] })
    .expect(201);
  assert.notEqual(retry.body.job.id, first.body.job.id);
  await ctx.agent.get(`/api/downloads/${retry.body.job.id}/file`).expect(200);
  await ctx.agent
    .post(`/api/downloads/${retry.body.job.id}/complete`)
    .set("X-CSRF-Token", ctx.token)
    .send({ status: "delivered" })
    .expect(200);
});
