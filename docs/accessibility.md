# 无障碍通行链模块

位置：`packages/shared/src/accessibility`，通过 `@map/shared/accessibility` 导出，前后端均可使用（纯 TypeScript，无 Node 依赖）。

模块把地点之间的**坡道、电梯、步道、楼梯、自动扶梯**等通行段连成图，提供：

1. **约束最短路**：按出行者约束（轮椅、婴儿车、行李等）求最短可通行路径；
2. **不可达解释**：走不通时说明是路网不连通，还是被哪些通行段、哪些原因阻断；
3. **缓存一致性**：查询结果带图版本戳，任何更新立即使旧缓存失效。

## 数据模型

- `AccessNode`：地点，含 `id`、`name`、楼层 `level`。
- `AccessSegment`：通行段（边），含：
  - `kind`：`walkway` / `ramp` / `elevator` / `stairs` / `escalator`；
  - `lengthM`：长度（米），最短路的代价；
  - `slopePct`：坡度百分比，`null` 表示未知；
  - `surface`：路面，`smooth < paved < uneven < gravel` 按粗糙度排序；
  - `widthM`：净宽（米），`null` 表示未知（未知不拦截）；
  - `status`：`open` / `maintenance` / `closed`；
  - `bidirectional`：`false` 表示单向（如下行扶梯）。
- `AccessibilityProfile`：出行约束，默认面向轮椅使用者：
  - `avoidStairs`（默认 `true`）、`avoidEscalators`、`maxSlopePct`、`minWidthM`、
    `maxSurface`（可接受的最粗糙路面）、`allowMaintenance`。

所有输入经 Zod 校验（`accessNodeSchema` / `accessSegmentSchema` / `accessibilityProfileSchema`）。

## 使用

```ts
import { AccessibilityRouter } from "@map/shared/accessibility";

const router = new AccessibilityRouter();
const graph = router.graph;

graph.upsertNode({ id: "lobby", name: "大厅", level: 0 });
graph.upsertNode({ id: "hall", name: "二层展厅", level: 1 });
graph.upsertSegment({ id: "el1", from: "lobby", to: "hall", kind: "elevator", lengthM: 8 });
graph.upsertSegment({ id: "st1", from: "lobby", to: "hall", kind: "stairs", lengthM: 5 });

// 约束最短路：默认避开楼梯，走电梯
const result = router.route("lobby", "hall");

// 电梯停运：图更新 → 版本递增 → 旧缓存自动失效
graph.setSegmentStatus("el1", "maintenance");
const again = router.route("lobby", "hall");
// again.ok === false，explanation 列出阻断点：
// { kind: "blocked", blockers: [
//   { segmentId: "el1", reasons: [{ code: "maintenance", ... }] },
//   { segmentId: "st1", reasons: [{ code: "stairs", ... }] }
// ] }
```

## 不可达解释

`route()` 返回 `ok: false` 时携带 `explanation`：

| `kind` | 含义 |
|---|---|
| `unknown_node` | 起点或终点不在路网中 |
| `disconnected` | 忽略全部约束也不连通，路网缺路段 |
| `blocked` | 存在物理路径，但被约束切断；`blockers` 列出可达边界上被拦截的通行段及全部原因（封闭、维护、楼梯、坡度、路面、净宽） |

## 缓存一致性

- 图每次变更（增删改节点/通行段、状态切换）都会递增 `graph.version`；
- 缓存键为 `起点→终点#规范化约束档案`，条目带写入时的版本戳；
- 命中前比对版本，不一致即丢弃重算——**更新后第一次查询必然得到新结果**，包括不可达结论（负缓存）；
- 缓存有 LRU 容量上限（默认 256，`new AccessibilityRouter(graph, { maxCacheEntries })` 可调），`pruneCache()` 可主动回收过期条目。

## 验证

```bash
pnpm --filter @map/shared typecheck
pnpm --filter @map/shared test
```
