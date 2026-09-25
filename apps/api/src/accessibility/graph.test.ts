import { describe, expect, it } from "vitest";
import { findAccessibleRoute } from "./graph";
import type { AccessibilityGraph, AccessibilityGraphEdge, AccessibilityGraphNode } from "./graph";
import type { AccessibilityRouteQuery } from "@map/shared/accessibility";

const nodes: AccessibilityGraphNode[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "gate",
    name: "东门",
    description: null,
    nodeType: "entrance",
    longitude: 116.1,
    latitude: 39.1,
    floor: "1",
    indoor: false,
    operationalStatus: "operational",
    thresholdStepMm: 0,
    doorClearWidthMm: 900,
    featureId: null
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    code: "ramp-top",
    name: "坡道平台",
    description: null,
    nodeType: "platform",
    longitude: 116.101,
    latitude: 39.1,
    floor: "1",
    indoor: false,
    operationalStatus: "operational",
    thresholdStepMm: 0,
    doorClearWidthMm: null,
    featureId: null
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    code: "stairs-top",
    name: "楼梯平台",
    description: null,
    nodeType: "platform",
    longitude: 116.102,
    latitude: 39.1,
    floor: "1",
    indoor: false,
    operationalStatus: "operational",
    thresholdStepMm: 0,
    doorClearWidthMm: null,
    featureId: null
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    code: "lobby",
    name: "门厅",
    description: null,
    nodeType: "building",
    longitude: 116.103,
    latitude: 39.1,
    floor: "1",
    indoor: true,
    operationalStatus: "operational",
    thresholdStepMm: 0,
    doorClearWidthMm: null,
    featureId: null
  }
];

function edge(overrides: Partial<AccessibilityGraphEdge> & Pick<AccessibilityGraphEdge, "id" | "fromNodeId" | "toNodeId" | "edgeType">): AccessibilityGraphEdge {
  return {
    code: overrides.id,
    direction: "both",
    name: null,
    description: null,
    lengthM: 100,
    surface: "concrete",
    slopePercent: null,
    clearWidthMm: 1200,
    maxStepHeightMm: 0,
    hasHandrails: null,
    doorClearWidthMm: null,
    operationalStatus: "operational",
    source: "test",
    ...overrides
  };
}

const edges: AccessibilityGraphEdge[] = [
  edge({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fromNodeId: nodes[0]!.id, toNodeId: nodes[1]!.id, edgeType: "ramp", lengthM: 120, slopePercent: 6 }),
  edge({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fromNodeId: nodes[0]!.id, toNodeId: nodes[2]!.id, edgeType: "stairs", lengthM: 40 }),
  edge({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", fromNodeId: nodes[1]!.id, toNodeId: nodes[3]!.id, edgeType: "path", lengthM: 100 }),
  edge({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", fromNodeId: nodes[2]!.id, toNodeId: nodes[3]!.id, edgeType: "path", lengthM: 20 })
];

const graph: AccessibilityGraph = { version: 7, nodes, edges };
const baseQuery: AccessibilityRouteQuery = {
  from: nodes[0]!.id,
  to: nodes[3]!.id,
  profile: "wheelchair",
  objective: "distance",
  requireElevator: false,
  requireRamp: false,
  avoidStairs: true,
  requireOperational: true,
  allowUnknownSurface: false,
  includeUnavailable: false
};

describe("accessibility graph constrained shortest path", () => {
  it("uses a longer ramp route instead of the shorter stair route", () => {
    const result = findAccessibleRoute(graph, baseQuery);
    expect(result.reachable).toBe(true);
    if (!result.reachable) throw new Error("route should be reachable");
    expect(result.graphVersion).toBe(7);
    expect(result.nodeIds).toEqual([nodes[0]!.id, nodes[1]!.id, nodes[3]!.id]);
    expect(result.edges.map((item) => item.edgeType)).toEqual(["ramp", "path"]);
    expect(result.distanceM).toBe(220);
  });

  it("explains why the wheelchair profile cannot pass when the ramp is too steep", () => {
    const blockedGraph: AccessibilityGraph = {
      ...graph,
      edges: edges.map((item) => item.edgeType === "ramp" ? { ...item, slopePercent: 12 } : item)
    };
    const result = findAccessibleRoute(blockedGraph, baseQuery);
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error("route should be blocked");
    expect(result.reason).toBe("constraints_not_satisfied");
    expect(result.blockers.map((item) => item.reason)).toContain("Slope exceeds the requested limit");
    expect(result.blockers.some((item) => item.code === "slope_too_steep" && item.limit === 8.33)).toBe(true);
  });

  it("reports closed facilities as blockers", () => {
    const blockedGraph: AccessibilityGraph = {
      ...graph,
      edges: edges.map((item) => item.id === edges[0]!.id ? { ...item, operationalStatus: "maintenance" } : item)
    };
    const result = findAccessibleRoute(blockedGraph, baseQuery);
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error("route should be blocked");
    expect(result.blockers.some((item) => item.code === "edge_maintenance")).toBe(true);
  });

  it("reports graph disconnection without inventing attribute blockers", () => {
    const disconnectedGraph: AccessibilityGraph = {
      ...graph,
      edges: [{ ...edges[1]!, edgeType: "path" }, edges[3]!]
    };
    const result = findAccessibleRoute(disconnectedGraph, {
      ...baseQuery,
      to: nodes[1]!.id,
      avoidStairs: false
    });
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error("route should be disconnected");
    expect(result.reason).toBe("graph_disconnected");
    expect(result.blockers).toEqual([]);
  });

  it("marks the origin or destination unavailable when an endpoint itself fails constraints", () => {
    const blockedGraph: AccessibilityGraph = {
      ...graph,
      nodes: nodes.map((item) => item.id === nodes[3]!.id ? { ...item, thresholdStepMm: 80 } : item)
    };
    const result = findAccessibleRoute(blockedGraph, baseQuery);
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error("destination should be blocked");
    expect(result.reason).toBe("endpoint_unavailable");
    expect(result.blockers[0]?.code).toBe("node_step_too_high");
  });

  it("explains when a reachable route lacks a required facility", () => {
    const result = findAccessibleRoute(graph, { ...baseQuery, requireElevator: true });
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error("required elevator should make route unavailable");
    expect(result.reason).toBe("constraints_not_satisfied");
    expect(result.blockers.some((item) => item.code === "elevator_required")).toBe(true);
  });
});
