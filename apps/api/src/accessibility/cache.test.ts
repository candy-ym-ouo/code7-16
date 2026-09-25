import { describe, expect, it } from "vitest";
import { InMemoryAccessibilityGraphCache } from "./cache-store";
import type { AccessibilityGraph } from "./graph";

const graphAt = (version: number): AccessibilityGraph => ({
  version,
  nodes: [],
  edges: []
});

describe("versioned accessibility graph cache", () => {
  it("keeps graph snapshots isolated by transactional version", async () => {
    const cache = new InMemoryAccessibilityGraphCache();
    await cache.set(graphAt(1));
    await cache.set(graphAt(2));

    const first = await cache.get(1);
    const second = await cache.get(2);
    expect(first?.version).toBe(1);
    expect(second?.version).toBe(2);
  });

  it("returns null instead of reusing a newer snapshot when the requested version is absent", async () => {
    const cache = new InMemoryAccessibilityGraphCache();
    await cache.set(graphAt(3));
    expect(await cache.get(2)).toBeNull();
  });

  it("expires immutable version snapshots", async () => {
    const cache = new InMemoryAccessibilityGraphCache(-10);
    await cache.set(graphAt(4));
    expect(await cache.get(4)).toBeNull();
    await cache.close();
  });
});
