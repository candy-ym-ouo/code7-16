import { RouteCache } from "./cache";
import { AccessibilityGraph } from "./graph";
import { resolveProfile, type AccessibilityProfileInput } from "./model";
import {
  explainUnreachable,
  findShortestPath,
  type RouteStep,
  type UnreachableExplanation
} from "./query";

export type RouteResultData =
  | {
      ok: true;
      from: string;
      to: string;
      steps: RouteStep[];
      totalLengthM: number;
    }
  | {
      ok: false;
      from: string;
      to: string;
      explanation: UnreachableExplanation;
    };

export type RouteResult = RouteResultData & { cached: boolean };

/**
 * 无障碍通行链查询门面：持有图与缓存，对外提供约束最短路查询。
 *
 * 缓存一致性：图每次变更都会提升版本号，缓存条目带有写入时的版本戳，
 * 版本不一致即视为未命中并重新计算——更新后第一次查询必然得到新结果。
 */
export class AccessibilityRouter {
  readonly graph: AccessibilityGraph;
  private readonly cache: RouteCache;

  constructor(graph?: AccessibilityGraph, options?: { maxCacheEntries?: number }) {
    this.graph = graph ?? new AccessibilityGraph();
    this.cache = new RouteCache(options?.maxCacheEntries ?? 256);
  }

  route(from: string, to: string, profileInput?: AccessibilityProfileInput): RouteResult {
    const profile = resolveProfile(profileInput);

    if (from === to) {
      if (!this.graph.hasNode(from)) {
        return {
          ok: false,
          from,
          to,
          explanation: {
            kind: "unknown_node",
            nodeId: from,
            message: `地点「${from}」不在路网中`
          },
          cached: false
        };
      }
      return { ok: true, from, to, steps: [], totalLengthM: 0, cached: false };
    }

    const version = this.graph.version;
    const hit = this.cache.get(version, from, to, profile);
    if (hit) {
      return { ...hit, cached: true };
    }

    const path = findShortestPath(this.graph, from, to, profile);
    const data: RouteResultData = path
      ? {
          ok: true,
          from,
          to,
          steps: path.steps,
          totalLengthM: Math.round(path.totalLengthM * 1000) / 1000
        }
      : { ok: false, from, to, explanation: explainUnreachable(this.graph, from, to, profile) };

    this.cache.set(version, from, to, profile, data);
    return { ...data, cached: false };
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /** 主动清理过期缓存条目，返回清理数量。 */
  pruneCache(): number {
    return this.cache.prune(this.graph.version);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
