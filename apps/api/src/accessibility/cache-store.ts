import type { AccessibilityGraph } from "./graph";

export interface AccessibilityGraphCache {
  get(version: number): Promise<AccessibilityGraph | null>;
  set(graph: AccessibilityGraph): Promise<void>;
  close(): Promise<void>;
}

export const GRAPH_TTL_SECONDS = 24 * 60 * 60;

export class InMemoryAccessibilityGraphCache implements AccessibilityGraphCache {
  private readonly values = new Map<number, { graph: AccessibilityGraph; expiresAt: number }>();

  constructor(private readonly ttlMs = GRAPH_TTL_SECONDS * 1000) {}

  async get(version: number): Promise<AccessibilityGraph | null> {
    const value = this.values.get(version);
    if (!value) return null;
    if (value.expiresAt <= Date.now()) {
      this.values.delete(version);
      return null;
    }
    return value.graph;
  }

  async set(graph: AccessibilityGraph): Promise<void> {
    for (const [version, value] of this.values) {
      if (value.expiresAt <= Date.now()) this.values.delete(version);
    }
    this.values.set(graph.version, { graph, expiresAt: Date.now() + this.ttlMs });
  }

  async close(): Promise<void> {
    this.values.clear();
  }
}
