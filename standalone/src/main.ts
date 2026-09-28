import { access } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "./config.js";
import { createServer } from "./server.js";

const config = readConfig(process.env);
await access(join(config.webRoot, "index.html"));
const app = createServer(config);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1; });
  });
}
console.log(`Living Azeroth dashboard: ${await app.listen({ host: config.host, port: config.port })}`);
