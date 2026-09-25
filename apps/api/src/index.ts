import { buildApp } from "./app";
import { pool } from "./db";
import { closeQueues } from "./queue";
import { closeAccessibilityGraphCache } from "./accessibility/cache";

const app = await buildApp();

try {
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await closeQueues();
  await closeAccessibilityGraphCache();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
