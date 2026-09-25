import type { AccessibilityProfile } from "./model";
import type { RouteResultData } from "./router";

interface CacheEntry {
  /** 写入时的图版本；与当前版本不一致即视为过期 */
  version: number;
  result: RouteResultData;
}

/**
 * 查询结果缓存，以图版本戳保证一致性：
 * 图每发生一次变更 version 递增，命中前比对版本，
 * 过期条目立即丢弃，因此更新后绝不会返回旧结果。
 * 同时缓存不可达结论（负缓存），同样受版本戳约束。
 */
export class RouteCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 256) {}

  get size(): number {
    return this.entries.size;
  }

  static key(from: string, to: string, profile: AccessibilityProfile): string {
    return `${from}→${to}#${stableProfileKey(profile)}`;
  }

  get(
    version: number,
    from: string,
    to: string,
    profile: AccessibilityProfile
  ): RouteResultData | undefined {
    const key = RouteCache.key(from, to, profile);
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.version !== version) {
      this.entries.delete(key);
      return undefined;
    }
    // 触达后移到末尾，维持 LRU 顺序
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(
    version: number,
    from: string,
    to: string,
    profile: AccessibilityProfile,
    result: RouteResultData
  ): void {
    const key = RouteCache.key(from, to, profile);
    this.entries.delete(key);
    this.entries.set(key, { version, result });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  /** 丢弃所有过期条目；常规路径靠版本比对惰性清理，这里用于主动回收。 */
  prune(version: number): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.version !== version) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** 约束档案的规范化序列化：键排序后拼接，保证相同约束得到相同键。 */
function stableProfileKey(profile: AccessibilityProfile): string {
  const keys = Object.keys(profile).sort() as (keyof AccessibilityProfile)[];
  return keys.map((key) => `${key}=${String(profile[key])}`).join(";");
}
