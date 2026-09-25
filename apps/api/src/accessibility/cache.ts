import IORedis, { type Redis as RedisClient } from "ioredis";
import { config } from "../config";
import type { AccessibilityGraph } from "./graph";
import { GRAPH_TTL_SECONDS, InMemoryAccessibilityGraphCache, type AccessibilityGraphCache } from "./cache-store";

const GRAPH_KEY_PREFIX = "accessibility:graph:v";

export { GRAPH_TTL_SECONDS, InMemoryAccessibilityGraphCache };
export type { AccessibilityGraphCache };

export class RedisAccessibilityGraphCache implements AccessibilityGraphCache {
  constructor(private readonly redis: RedisClient) {}

  private key(version: number): string {
    return `${GRAPH_KEY_PREFIX}${version}`;
  }

  async get(version: number): Promise<AccessibilityGraph | null> {
    try {
      const value = await this.redis.get(this.key(version));
      return value ? JSON.parse(value) as AccessibilityGraph : null;
    } catch (error) {
      console.error({ error, version }, "failed to read accessibility graph cache");
      return null;
    }
  }

  async set(graph: AccessibilityGraph): Promise<void> {
    try {
      await this.redis.set(this.key(graph.version), JSON.stringify(graph), "EX", GRAPH_TTL_SECONDS);
    } catch (error) {
      // The database is the source of truth. Caching failure should not make routing unavailable.
      console.error({ error, version: graph.version }, "failed to write accessibility graph cache");
    }
  }

  async close(): Promise<void> {
    if (this.redis.status !== "end") await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

let cache: AccessibilityGraphCache | null = null;

export function getAccessibilityGraphCache(): AccessibilityGraphCache {
  if (cache) return cache;
  const redis = new IORedis(config.REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times: number) => Math.min(times * 200, 2000)
  });
  redis.on("error", (error: Error) => console.error({ error }, "accessibility graph Redis error"));
  cache = new RedisAccessibilityGraphCache(redis);
  return cache;
}

export async function closeAccessibilityGraphCache(): Promise<void> {
  if (!cache) return;
  await cache.close();
  cache = null;
}
