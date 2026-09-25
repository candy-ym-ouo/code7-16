import {
  accessNodeSchema,
  accessSegmentSchema,
  type AccessNode,
  type AccessNodeInput,
  type AccessSegment,
  type AccessSegmentInput,
  type SegmentStatus
} from "./model";

export interface Traversal {
  segment: AccessSegment;
  /** 沿允许方向走出该段后到达的节点 */
  next: string;
}

/**
 * 无障碍通行图。节点是地点，边是通行段（坡道、电梯、步道等）。
 *
 * 每次变更都会递增 `version`；查询缓存以版本戳判断一致性，
 * 因此任何更新都会立即使旧缓存失效，不会读到过期结果。
 */
export class AccessibilityGraph {
  private nodes = new Map<string, AccessNode>();
  private segments = new Map<string, AccessSegment>();
  /** nodeId → 可从该节点沿允许方向走出的通行段 id */
  private outgoing = new Map<string, Set<string>>();
  private revision = 0;

  get version(): number {
    return this.revision;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get segmentCount(): number {
    return this.segments.size;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): AccessNode | undefined {
    return this.nodes.get(id);
  }

  getSegment(id: string): AccessSegment | undefined {
    return this.segments.get(id);
  }

  upsertNode(input: AccessNodeInput): AccessNode {
    const node = accessNodeSchema.parse(input);
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) {
      this.outgoing.set(node.id, new Set());
    }
    this.touch();
    return node;
  }

  /** 删除节点，并一并删除与其相连的所有通行段。 */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) {
      return false;
    }
    for (const segmentId of this.outgoing.get(id) ?? []) {
      this.removeSegment(segmentId);
    }
    // 以该节点为终点、且只能正向通行的段，不会出现在其 outgoing 中
    for (const segment of [...this.segments.values()]) {
      if (segment.from === id || segment.to === id) {
        this.removeSegment(segment.id);
      }
    }
    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.touch();
    return true;
  }

  upsertSegment(input: AccessSegmentInput): AccessSegment {
    const segment = accessSegmentSchema.parse(input);
    if (!this.nodes.has(segment.from)) {
      throw new Error(`通行段 ${segment.id} 的起点 ${segment.from} 不在路网中`);
    }
    if (!this.nodes.has(segment.to)) {
      throw new Error(`通行段 ${segment.id} 的终点 ${segment.to} 不在路网中`);
    }
    const previous = this.segments.get(segment.id);
    if (previous) {
      this.detach(previous);
    }
    this.segments.set(segment.id, segment);
    this.outgoing.get(segment.from)?.add(segment.id);
    if (segment.bidirectional) {
      this.outgoing.get(segment.to)?.add(segment.id);
    }
    this.touch();
    return segment;
  }

  removeSegment(id: string): boolean {
    const segment = this.segments.get(id);
    if (!segment) {
      return false;
    }
    this.detach(segment);
    this.segments.delete(id);
    this.touch();
    return true;
  }

  /** 更新通行段状态（开放/维护中/已封闭），电梯停运、施工封闭都走这里。 */
  setSegmentStatus(id: string, status: SegmentStatus): AccessSegment {
    const segment = this.segments.get(id);
    if (!segment) {
      throw new Error(`通行段 ${id} 不存在`);
    }
    const next: AccessSegment = { ...segment, status };
    this.segments.set(id, next);
    this.touch();
    return next;
  }

  /** 枚举从某节点沿允许方向可走出的所有通行段（不做约束过滤）。 */
  *traverse(nodeId: string): Generator<Traversal> {
    for (const segmentId of this.outgoing.get(nodeId) ?? []) {
      const segment = this.segments.get(segmentId);
      if (!segment) {
        continue;
      }
      if (segment.from === nodeId) {
        yield { segment, next: segment.to };
      } else {
        yield { segment, next: segment.from };
      }
    }
  }

  private detach(segment: AccessSegment): void {
    this.outgoing.get(segment.from)?.delete(segment.id);
    this.outgoing.get(segment.to)?.delete(segment.id);
  }

  private touch(): void {
    this.revision += 1;
  }
}
