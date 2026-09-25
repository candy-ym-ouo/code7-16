import { describe, expect, it } from "vitest";
import { AccessibilityRouter } from "./router";
import { evaluateSegment } from "./query";
import { resolveProfile } from "./model";
import type { AccessibilityGraph } from "./graph";

/**
 * 测试路网（小园区）：
 *
 *   gate ─w1(30m)→ plaza ─w2(20m, 净宽0.8)→ lobby ─st1(楼梯5m)→ hall
 *                    │                       │─el1(电梯8m)───────↗
 *                    │                       ↖──esc1(扶梯4m,单向)──┘
 *                    ├─r1(坡道30m,12%)→ garden
 *                    └─w3(60m)───────→ garden ─w4(碎石25m)→ lobby
 *
 *   island：无任何通行段的孤岛节点。
 */
function buildRouter() {
  const router = new AccessibilityRouter();
  const graph = router.graph;
  for (const [id, name, level] of [
    ["gate", "东门", 0],
    ["plaza", "广场", 0],
    ["lobby", "大厅", 0],
    ["hall", "二层展厅", 1],
    ["garden", "花园", 0],
    ["island", "孤岛", 0]
  ] as const) {
    graph.upsertNode({ id, name, level });
  }
  graph.upsertSegment({ id: "w1", from: "gate", to: "plaza", kind: "walkway", lengthM: 30 });
  graph.upsertSegment({
    id: "w2",
    from: "plaza",
    to: "lobby",
    kind: "walkway",
    lengthM: 20,
    widthM: 0.8
  });
  graph.upsertSegment({ id: "st1", from: "lobby", to: "hall", kind: "stairs", lengthM: 5 });
  graph.upsertSegment({ id: "el1", from: "lobby", to: "hall", kind: "elevator", lengthM: 8 });
  graph.upsertSegment({
    id: "r1",
    from: "plaza",
    to: "garden",
    kind: "ramp",
    lengthM: 30,
    slopePct: 12,
    surface: "paved"
  });
  graph.upsertSegment({ id: "w3", from: "plaza", to: "garden", kind: "walkway", lengthM: 60 });
  graph.upsertSegment({
    id: "w4",
    from: "garden",
    to: "lobby",
    kind: "walkway",
    lengthM: 25,
    surface: "gravel"
  });
  graph.upsertSegment({
    id: "esc1",
    from: "hall",
    to: "lobby",
    kind: "escalator",
    lengthM: 4,
    bidirectional: false
  });
  return { router, graph };
}

function stepIds(result: ReturnType<AccessibilityRouter["route"]>): string[] {
  return result.ok ? result.steps.map((step) => step.segment.id) : [];
}

describe("约束最短路", () => {
  it("默认轮椅档案避开楼梯，走电梯", () => {
    const { router } = buildRouter();
    const result = router.route("gate", "hall");
    expect(result.ok).toBe(true);
    expect(stepIds(result)).toEqual(["w1", "w2", "el1"]);
    if (result.ok) {
      expect(result.totalLengthM).toBe(58);
    }
  });

  it("允许楼梯时走更短的楼梯", () => {
    const { router } = buildRouter();
    const result = router.route("gate", "hall", { avoidStairs: false });
    expect(stepIds(result)).toEqual(["w1", "w2", "st1"]);
    if (result.ok) {
      expect(result.totalLengthM).toBe(55);
    }
  });

  it("坡度超限的坡道被绕开", () => {
    const { router } = buildRouter();
    // 碎石路 w4 也被路面约束排除，只能走 60m 的平整步道
    const gentle = router.route("plaza", "garden", { maxSlopePct: 8, maxSurface: "paved" });
    expect(stepIds(gentle)).toEqual(["w3"]);
    const steep = router.route("plaza", "garden", { maxSlopePct: 15, maxSurface: "paved" });
    expect(stepIds(steep)).toEqual(["r1"]);
  });

  it("路面粗糙度约束排除碎石路", () => {
    const { router } = buildRouter();
    const roughOk = router.route("garden", "lobby");
    expect(stepIds(roughOk)).toEqual(["w4"]);
    const pavedOnly = router.route("garden", "lobby", { maxSurface: "paved" });
    expect(stepIds(pavedOnly)).toEqual(["r1", "w2"]);
    if (pavedOnly.ok) {
      expect(pavedOnly.totalLengthM).toBe(50);
    }
  });

  it("净宽约束绕开狭窄路段", () => {
    const { router } = buildRouter();
    const result = router.route("gate", "hall", { minWidthM: 0.9 });
    expect(stepIds(result)).not.toContain("w2");
    if (result.ok) {
      // w1 → r1 → w4 → el1
      expect(result.totalLengthM).toBe(93);
    }
  });

  it("单向扶梯只能顺向通行", () => {
    const { router } = buildRouter();
    const profile = { avoidStairs: false, avoidEscalators: false };
    const down = router.route("hall", "lobby", profile);
    expect(stepIds(down)).toEqual(["esc1"]);
    const up = router.route("lobby", "hall", profile);
    expect(stepIds(up)).toEqual(["st1"]);
  });

  it("起点即终点返回空路径", () => {
    const { router } = buildRouter();
    const result = router.route("gate", "gate");
    expect(result).toMatchObject({ ok: true, totalLengthM: 0, cached: false });
    expect(stepIds(result)).toEqual([]);
  });

  it("非法约束档案被拒绝", () => {
    const { router } = buildRouter();
    expect(() => router.route("gate", "hall", { maxSlopePct: -1 })).toThrow();
    expect(() =>
      router.route("gate", "hall", { teleport: true } as never)
    ).toThrow();
  });
});

describe("不可达解释", () => {
  it("电梯维护时列出全部阻断点及原因", () => {
    const { router, graph } = buildRouter();
    graph.setSegmentStatus("el1", "maintenance");
    const result = router.route("gate", "hall");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.explanation.kind).toBe("blocked");
    if (result.explanation.kind !== "blocked") {
      return;
    }
    const byId = new Map(result.explanation.blockers.map((b) => [b.segmentId, b]));
    expect(byId.get("el1")?.reasons.map((r) => r.code)).toEqual(["maintenance"]);
    expect(byId.get("st1")?.reasons.map((r) => r.code)).toEqual(["stairs"]);
    // 单向扶梯从大厅一侧才能进入，不构成大厅方向的阻断点
    expect(byId.has("esc1")).toBe(false);
  });

  it("允许穿越维护路段后恢复可达", () => {
    const { router, graph } = buildRouter();
    graph.setSegmentStatus("el1", "maintenance");
    const result = router.route("gate", "hall", { allowMaintenance: true });
    expect(result.ok).toBe(true);
    expect(stepIds(result)).toEqual(["w1", "w2", "el1"]);
  });

  it("路网不连通时给出 disconnected 解释", () => {
    const { router } = buildRouter();
    const result = router.route("gate", "island");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.explanation.kind).toBe("disconnected");
    }
  });

  it("节点不存在时给出 unknown_node 解释", () => {
    const { router } = buildRouter();
    const fromGhost = router.route("ghost", "hall");
    const toGhost = router.route("hall", "ghost");
    for (const result of [fromGhost, toGhost]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.explanation.kind).toBe("unknown_node");
      }
    }
  });

  it("evaluateSegment 汇总多重阻断原因", () => {
    const { graph } = buildRouter();
    graph.upsertSegment({
      id: "r9",
      from: "gate",
      to: "plaza",
      kind: "ramp",
      lengthM: 10,
      slopePct: 20,
      status: "closed"
    });
    const segment = graph.getSegment("r9");
    expect(segment).toBeDefined();
    if (!segment) {
      return;
    }
    const reasons = evaluateSegment(segment, resolveProfile({ maxSlopePct: 8 }));
    expect(reasons.map((r) => r.code)).toEqual(["closed", "slope"]);
  });
});

describe("缓存一致性", () => {
  it("相同查询命中缓存，语义相同的档案共享缓存键", () => {
    const { router } = buildRouter();
    const first = router.route("gate", "hall");
    const second = router.route("gate", "hall");
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    // 显式写出默认值，与默认档案等价，应命中同一缓存键
    const equivalent = router.route("gate", "hall", {
      avoidStairs: true,
      avoidEscalators: false,
      maxSurface: "gravel",
      allowMaintenance: false
    });
    expect(equivalent.cached).toBe(true);
    expect(router.cacheSize).toBe(1);
  });

  it("图更新后旧缓存立即失效，返回新结果", () => {
    const { router, graph } = buildRouter();
    const before = router.route("gate", "hall");
    if (before.ok) {
      expect(before.totalLengthM).toBe(58);
    }
    const version = graph.version;

    graph.upsertSegment({ id: "w1", from: "gate", to: "plaza", kind: "walkway", lengthM: 100 });
    expect(graph.version).toBeGreaterThan(version);

    const after = router.route("gate", "hall");
    expect(after.cached).toBe(false);
    if (after.ok) {
      expect(after.totalLengthM).toBe(128);
    }
    // 同一缓存键被新结果覆盖，不残留过期条目
    expect(router.cacheSize).toBe(1);
  });

  it("不可达结论同样被缓存，并在恢复后失效", () => {
    const { router, graph } = buildRouter();
    graph.setSegmentStatus("el1", "maintenance");

    const first = router.route("gate", "hall");
    expect(first.ok).toBe(false);
    expect(first.cached).toBe(false);
    const second = router.route("gate", "hall");
    expect(second.ok).toBe(false);
    expect(second.cached).toBe(true);

    graph.setSegmentStatus("el1", "open");
    const recovered = router.route("gate", "hall");
    expect(recovered.ok).toBe(true);
    expect(recovered.cached).toBe(false);
  });

  it("pruneCache 主动回收其他键的过期条目", () => {
    const { router, graph } = buildRouter();
    router.route("gate", "hall");
    router.route("plaza", "garden");
    expect(router.cacheSize).toBe(2);

    graph.setSegmentStatus("w1", "maintenance");
    router.route("gate", "hall"); // 该键惰性重建
    expect(router.cacheSize).toBe(2);

    expect(router.pruneCache()).toBe(1);
    expect(router.cacheSize).toBe(1);
  });

  it("缓存容量有限时淘汰最久未使用的条目", () => {
    const { router } = buildRouter();
    router.clearCache();
    const small = new AccessibilityRouter(router.graph, { maxCacheEntries: 2 });
    small.route("gate", "hall");
    small.route("gate", "plaza");
    small.route("gate", "garden");
    expect(small.cacheSize).toBe(2);
  });
});

describe("图结构维护", () => {
  it("删除节点级联删除相连通行段", () => {
    const { router, graph } = buildRouter();
    expect(graph.segmentCount).toBe(8);

    expect(graph.removeNode("lobby")).toBe(true);
    expect(graph.nodeCount).toBe(5);
    // w2、st1、el1、w4 与单向的 esc1 都被移除
    expect(graph.segmentCount).toBe(3);

    const result = router.route("gate", "hall");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.explanation.kind).toBe("disconnected");
    }
  });

  it("引用未知节点的通行段被拒绝", () => {
    const { graph } = buildRouter();
    expect(() =>
      graph.upsertSegment({ id: "bad", from: "gate", to: "nowhere", kind: "walkway", lengthM: 1 })
    ).toThrow(/nowhere/);
  });

  it("重复写入同 id 通行段不产生重复邻接", () => {
    const { graph } = buildRouter();
    graph.upsertSegment({ id: "w1", from: "gate", to: "plaza", kind: "walkway", lengthM: 30 });
    graph.upsertSegment({ id: "w1", from: "gate", to: "plaza", kind: "walkway", lengthM: 35 });
    expect(graph.segmentCount).toBe(8);
    const traversals = [...graph.traverse("gate")].filter((t) => t.segment.id === "w1");
    expect(traversals).toHaveLength(1);
    expect(graph.getSegment("w1")?.lengthM).toBe(35);
  });
});

describe("类型导出", () => {
  it("图类型可用于独立编排", () => {
    const graph: AccessibilityGraph = new AccessibilityRouter().graph;
    expect(graph.version).toBe(0);
  });
});
