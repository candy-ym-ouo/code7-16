import type { AccessibilityGraph } from "./graph";
import {
  SEGMENT_KIND_LABELS,
  SEGMENT_STATUS_LABELS,
  SURFACE_KINDS,
  SURFACE_LABELS,
  type AccessibilityProfile,
  type AccessSegment
} from "./model";

export type BlockReasonCode =
  | "closed"
  | "maintenance"
  | "stairs"
  | "escalator"
  | "slope"
  | "surface"
  | "width";

export interface BlockReason {
  code: BlockReasonCode;
  message: string;
}

/** 评估通行段在给定约束下被拦截的全部原因；返回空数组表示可通行。 */
export function evaluateSegment(
  segment: AccessSegment,
  profile: AccessibilityProfile
): BlockReason[] {
  const reasons: BlockReason[] = [];
  if (segment.status === "closed") {
    reasons.push({ code: "closed", message: `${SEGMENT_KIND_LABELS[segment.kind]}已封闭` });
  }
  if (segment.status === "maintenance" && !profile.allowMaintenance) {
    reasons.push({
      code: "maintenance",
      message: `${SEGMENT_KIND_LABELS[segment.kind]}${SEGMENT_STATUS_LABELS.maintenance}`
    });
  }
  if (segment.kind === "stairs" && profile.avoidStairs) {
    reasons.push({ code: "stairs", message: "包含楼梯/台阶" });
  }
  if (segment.kind === "escalator" && profile.avoidEscalators) {
    reasons.push({ code: "escalator", message: "包含自动扶梯" });
  }
  if (
    profile.maxSlopePct !== undefined &&
    segment.slopePct !== undefined &&
    segment.slopePct !== null &&
    segment.slopePct > profile.maxSlopePct
  ) {
    reasons.push({
      code: "slope",
      message: `坡度 ${segment.slopePct}% 超过上限 ${profile.maxSlopePct}%`
    });
  }
  const surfaceRank = SURFACE_KINDS.indexOf(segment.surface);
  const maxSurfaceRank = SURFACE_KINDS.indexOf(profile.maxSurface);
  if (surfaceRank > maxSurfaceRank) {
    reasons.push({
      code: "surface",
      message: `路面为「${SURFACE_LABELS[segment.surface]}」，超出可接受范围「${SURFACE_LABELS[profile.maxSurface]}」`
    });
  }
  if (
    profile.minWidthM !== undefined &&
    segment.widthM !== undefined &&
    segment.widthM !== null &&
    segment.widthM < profile.minWidthM
  ) {
    reasons.push({
      code: "width",
      message: `净宽 ${segment.widthM}m 小于要求的 ${profile.minWidthM}m`
    });
  }
  return reasons;
}

export interface RouteStep {
  segment: AccessSegment;
  from: string;
  to: string;
}

export interface FoundPath {
  steps: RouteStep[];
  totalLengthM: number;
}

/** 约束最短路：只穿越满足约束的通行段，按长度求最短。 */
export function findShortestPath(
  graph: AccessibilityGraph,
  from: string,
  to: string,
  profile: AccessibilityProfile
): FoundPath | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, RouteStep>();
  const heap = new MinHeap();
  heap.push(from, 0);

  while (heap.size > 0) {
    const { id, priority } = heap.pop();
    if (priority > (dist.get(id) ?? Number.POSITIVE_INFINITY)) {
      continue; // 堆中过期条目
    }
    if (id === to) {
      break;
    }
    for (const { segment, next } of graph.traverse(id)) {
      if (evaluateSegment(segment, profile).length > 0) {
        continue;
      }
      const candidate = priority + segment.lengthM;
      if (candidate < (dist.get(next) ?? Number.POSITIVE_INFINITY)) {
        dist.set(next, candidate);
        prev.set(next, { segment, from: id, to: next });
        heap.push(next, candidate);
      }
    }
  }

  if (!dist.has(to)) {
    return null;
  }
  const steps: RouteStep[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = prev.get(cursor);
    if (!step) {
      return null; // 不可达，防御性返回
    }
    steps.push(step);
    cursor = step.from;
  }
  steps.reverse();
  const totalLengthM = dist.get(to) ?? 0;
  return { steps, totalLengthM };
}

export interface BlockedSegment {
  segmentId: string;
  from: string;
  to: string;
  reasons: BlockReason[];
}

export type UnreachableExplanation =
  | { kind: "unknown_node"; nodeId: string; message: string }
  | { kind: "disconnected"; message: string }
  | { kind: "blocked"; message: string; blockers: BlockedSegment[] };

/**
 * 不可达解释。
 *
 * 先求约束下的可达集合，再求忽略全部约束的可达集合：
 * - 终点在后者之外 → 路网本身不连通；
 * - 终点在后者之内 → 存在物理路径，是被约束切断的；
 *   此时枚举「可达集合边界」上被拦截的通行段及其原因，即阻断点清单。
 */
export function explainUnreachable(
  graph: AccessibilityGraph,
  from: string,
  to: string,
  profile: AccessibilityProfile
): UnreachableExplanation {
  if (!graph.hasNode(from)) {
    return { kind: "unknown_node", nodeId: from, message: `起点「${from}」不在路网中` };
  }
  if (!graph.hasNode(to)) {
    return { kind: "unknown_node", nodeId: to, message: `终点「${to}」不在路网中` };
  }

  const reachable = reachableSet(graph, from, (s) => evaluateSegment(s, profile).length === 0);
  const physical = reachableSet(graph, from, () => true);
  if (!physical.has(to)) {
    return {
      kind: "disconnected",
      message: "终点与起点在路网中不连通，中间缺少可通行的路段"
    };
  }

  const blockers: BlockedSegment[] = [];
  for (const nodeId of reachable) {
    for (const { segment, next } of graph.traverse(nodeId)) {
      if (reachable.has(next)) {
        continue;
      }
      const reasons = evaluateSegment(segment, profile);
      if (reasons.length === 0) {
        continue; // 可通行的边不会把节点挡在可达集合外，防御性跳过
      }
      blockers.push({ segmentId: segment.id, from: nodeId, to: next, reasons });
    }
  }
  blockers.sort((a, b) => a.segmentId.localeCompare(b.segmentId));
  return {
    kind: "blocked",
    message: `存在物理路径，但 ${blockers.length} 处通行段不满足当前出行约束`,
    blockers
  };
}

function reachableSet(
  graph: AccessibilityGraph,
  start: string,
  pass: (segment: AccessSegment) => boolean
): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) {
      break;
    }
    for (const { segment, next } of graph.traverse(current)) {
      if (seen.has(next) || !pass(segment)) {
        continue;
      }
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

interface HeapEntry {
  id: string;
  priority: number;
}

/** 简易二叉最小堆，供 Dijkstra 使用。 */
class MinHeap {
  private items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(id: string, priority: number): void {
    this.items.push({ id, priority });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const self = this.items[index];
      const above = this.items[parent];
      if (!self || !above || above.priority <= self.priority) {
        break;
      }
      this.items[index] = above;
      this.items[parent] = self;
      index = parent;
    }
  }

  pop(): HeapEntry {
    const first = this.items[0];
    const last = this.items.pop();
    if (first === undefined || last === undefined) {
      throw new Error("堆为空");
    }
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        const leftEntry = this.items[left];
        const rightEntry = this.items[right];
        const smallestEntry = this.items[smallest];
        if (leftEntry && smallestEntry && leftEntry.priority < smallestEntry.priority) {
          smallest = left;
        }
        const current = this.items[smallest];
        if (rightEntry && current && rightEntry.priority < current.priority) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        const a = this.items[index];
        const b = this.items[smallest];
        if (!a || !b) {
          break;
        }
        this.items[index] = b;
        this.items[smallest] = a;
        index = smallest;
      }
    }
    return first;
  }
}
