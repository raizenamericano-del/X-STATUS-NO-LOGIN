import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { startupDiagnostic } from "./startup-error.js";
let instance,
  server,
  stage = "environment";
try {
  // Railway Variables work without a .env file; absence is normal and silent.
  if (existsSync(".env")) loadEnvFile(".env");
  stage = "configuration";
  const config = loadConfig();
  stage = "storage";
  instance = await createApp(config);
  stage = "listen";
  await new Promise((resolve, reject) => {
    server = instance.app.listen(config.port, config.host, resolve);
    server.once("error", reject);
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 65000;
  server.keepAliveTimeout = 60000;
  console.log(
    JSON.stringify({
      event: "SERVER_READY",
      host: config.host,
      port: server.address().port,
      app: "STATUSX",
      version: "1.1.0",
      accessMode: "open",
      sessionKey: "automatic",
    }),
  );
} catch (error) {
  console.error(JSON.stringify(startupDiagnostic(error, stage)));
  await instance?.close().catch(() => {});
  process.exitCode = 1;
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  const stopped = new Promise((resolve) =>
    server ? server.close(resolve) : resolve(),
  );
  await instance?.wa.stop();
  await stopped;
  await instance?.close();
  clearTimeout(timeout);
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
