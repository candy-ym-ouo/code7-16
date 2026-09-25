import type { AccessibilityRouteQuery } from "@map/shared/accessibility";

export type AccessibilityTravelProfile = "wheelchair" | "walk";

export const accessibilityNodeTypes = [
  "entrance", "building", "room", "platform", "crossing", "intersection", "landmark", "transit_stop"
] as const;
export const accessibilityEdgeTypes = [
  "sidewalk", "ramp", "elevator", "lift", "stairs", "threshold", "path", "crossing", "door"
] as const;
export const accessibilitySurfaces = [
  "paved", "asphalt", "concrete", "rubber", "brick", "gravel", "grass", "dirt", "tactile", "metal", "wood", "unknown"
] as const;

export type AccessibilityNodeType = (typeof accessibilityNodeTypes)[number];
export type AccessibilityEdgeType = (typeof accessibilityEdgeTypes)[number];
export type AccessibilitySurface = (typeof accessibilitySurfaces)[number];
export type OperationalStatus = "operational" | "closed" | "maintenance" | "unknown";
export type EdgeDirection = "forward" | "backward" | "both";

export type AccessibilityGraphNode = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  nodeType: AccessibilityNodeType;
  longitude: number;
  latitude: number;
  floor: string;
  indoor: boolean;
  operationalStatus: OperationalStatus;
  thresholdStepMm: number;
  doorClearWidthMm: number | null;
  featureId: string | null;
};

export type AccessibilityGraphEdge = {
  id: string;
  code: string | null;
  fromNodeId: string;
  toNodeId: string;
  edgeType: AccessibilityEdgeType;
  direction: EdgeDirection;
  name: string | null;
  description: string | null;
  lengthM: number;
  surface: AccessibilitySurface;
  slopePercent: number | null;
  clearWidthMm: number | null;
  maxStepHeightMm: number;
  hasHandrails: boolean | null;
  doorClearWidthMm: number | null;
  operationalStatus: OperationalStatus;
  source: string;
};

export type AccessibilityGraph = {
  version: number;
  nodes: AccessibilityGraphNode[];
  edges: AccessibilityGraphEdge[];
};

export type RouteConstraints = Omit<{
  profile: AccessibilityTravelProfile;
  objective: "distance" | "accessibility";
  maxSlopePercent: number;
  minClearWidthMm: number;
  maxStepHeightMm: number;
  requireElevator: boolean;
  requireRamp: boolean;
  avoidStairs: boolean;
  requireOperational: boolean;
  allowedSurfaces: ReadonlySet<AccessibilitySurface>;
  includeUnavailable: boolean;
}, "allowedSurfaces"> & {
  allowedSurfaces: AccessibilitySurface[];
};

export type AccessibilityBlocker = {
  entityType: "node" | "edge" | "route";
  id: string;
  code: string;
  reason: string;
  actual?: number | string;
  limit?: number | string;
};

export type AccessibilityRouteEdge = {
  id: string;
  code: string | null;
  fromNodeId: string;
  toNodeId: string;
  edgeType: AccessibilityEdgeType;
  surface: AccessibilitySurface;
  lengthM: number;
  cost: number;
  reasons?: string[];
};

export type AccessibilityRouteSuccess = {
  reachable: true;
  graphVersion: number;
  fromNodeId: string;
  toNodeId: string;
  constraints: RouteConstraints;
  distanceM: number;
  cost: number;
  nodeIds: string[];
  edges: AccessibilityRouteEdge[];
};

export type AccessibilityRouteFailure = {
  reachable: false;
  graphVersion: number;
  fromNodeId: string;
  toNodeId: string;
  constraints: RouteConstraints;
  reason: "endpoint_missing" | "endpoint_unavailable" | "constraints_not_satisfied" | "graph_disconnected";
  blockers: AccessibilityBlocker[];
};

export type AccessibilityRouteResult = AccessibilityRouteSuccess | AccessibilityRouteFailure;

type InternalRouteConstraints = Omit<RouteConstraints, "allowedSurfaces"> & {
  allowedSurfaces: ReadonlySet<AccessibilitySurface>;
};

type DirectedEdge = {
  edge: AccessibilityGraphEdge;
  reverse: boolean;
};

const wheelchairStableSurfaces: AccessibilitySurface[] = [
  "paved", "asphalt", "concrete", "rubber", "brick", "tactile", "metal", "wood"
];
const walkSurfaces: AccessibilitySurface[] = [...wheelchairStableSurfaces, "gravel", "grass", "dirt"];

const surfaceMultipliers: Record<AccessibilitySurface, number> = {
  paved: 1,
  asphalt: 1,
  concrete: 1,
  tactile: 1.05,
  rubber: 1.08,
  brick: 1.15,
  metal: 1.2,
  wood: 1.3,
  gravel: 1.8,
  grass: 2.3,
  dirt: 2.5,
  unknown: 2
};

function normalizeRouteConstraintsInternal(input: AccessibilityRouteQuery): InternalRouteConstraints {
  const profile = input.profile;
  const allowed = input.allowedSurfaces
    ?.split(",")
    .map((value) => value.trim())
    .filter((value): value is AccessibilitySurface =>
      (accessibilitySurfaces as readonly string[]).includes(value)
    ) ?? [];

  return {
    profile,
    objective: input.objective,
    maxSlopePercent: input.maxSlopePercent ?? (profile === "wheelchair" ? 8.33 : 25),
    minClearWidthMm: input.minClearWidthMm ?? (profile === "wheelchair" ? 800 : 500),
    maxStepHeightMm: input.maxStepHeightMm ?? (profile === "wheelchair" ? 0 : 150),
    requireElevator: input.requireElevator ?? false,
    requireRamp: input.requireRamp ?? false,
    avoidStairs: input.avoidStairs ?? profile === "wheelchair",
    requireOperational: input.requireOperational,
    allowedSurfaces: new Set(
      allowed.length
        ? allowed
        : profile === "wheelchair"
          ? input.allowUnknownSurface ? [...wheelchairStableSurfaces, "unknown"] : wheelchairStableSurfaces
          : input.allowUnknownSurface ? [...walkSurfaces, "unknown"] : walkSurfaces
    ),
    includeUnavailable: input.includeUnavailable
  };
}

function publicConstraints(constraints: InternalRouteConstraints): RouteConstraints {
  return { ...constraints, allowedSurfaces: [...constraints.allowedSurfaces] };
}

export function normalizeRouteConstraints(input: AccessibilityRouteQuery): RouteConstraints {
  return publicConstraints(normalizeRouteConstraintsInternal(input));
}

function blocker(
  entityType: "node" | "edge" | "route",
  id: string,
  code: string,
  reason: string,
  values?: { actual?: number | string; limit?: number | string }
): AccessibilityBlocker {
  return { entityType, id, code, reason, ...(values ? values : {}) };
}

function operationalBlocker(status: OperationalStatus, entityType: "node" | "edge", id: string): AccessibilityBlocker | null {
  if (status === "closed") return blocker(entityType, id, `${entityType}_closed`, "This point is marked closed", { actual: status });
  if (status === "maintenance") return blocker(entityType, id, `${entityType}_maintenance`, "This point is under maintenance", { actual: status });
  if (status === "unknown") return blocker(entityType, id, `${entityType}_status_unknown`, "Current operational status is unknown");
  return null;
}

export function describeNodeBlocker(
  node: AccessibilityGraphNode,
  constraints: InternalRouteConstraints
): AccessibilityBlocker | null {
  if (constraints.requireOperational) {
    const status = operationalBlocker(node.operationalStatus, "node", node.id);
    if (status) return status;
  }
  if (node.thresholdStepMm > constraints.maxStepHeightMm) {
    return blocker("node", node.id, "node_step_too_high", "Threshold or step exceeds the requested limit", {
      actual: node.thresholdStepMm,
      limit: constraints.maxStepHeightMm
    });
  }
  if (node.doorClearWidthMm !== null && node.doorClearWidthMm < constraints.minClearWidthMm) {
    return blocker("node", node.id, "node_door_too_narrow", "Door clear width is below the requested limit", {
      actual: node.doorClearWidthMm,
      limit: constraints.minClearWidthMm
    });
  }
  return null;
}

export function describeEdgeBlocker(
  edge: AccessibilityGraphEdge,
  constraints: InternalRouteConstraints
): AccessibilityBlocker | null {
  if (constraints.requireOperational) {
    const status = operationalBlocker(edge.operationalStatus, "edge", edge.id);
    if (status) return status;
  }
  if (!constraints.allowedSurfaces.has(edge.surface)) {
    return blocker("edge", edge.id, "surface_not_allowed", "Surface is not allowed by the requested profile", {
      actual: edge.surface
    });
  }
  if (constraints.avoidStairs && (edge.edgeType === "stairs")) {
    return blocker("edge", edge.id, "stairs_not_allowed", "Stairs cannot be used by this profile", {
      actual: edge.edgeType
    });
  }
  if (edge.maxStepHeightMm > constraints.maxStepHeightMm) {
    return blocker("edge", edge.id, "edge_step_too_high", "Step height exceeds the requested limit", {
      actual: edge.maxStepHeightMm,
      limit: constraints.maxStepHeightMm
    });
  }
  if (edge.slopePercent !== null && edge.slopePercent > constraints.maxSlopePercent) {
    return blocker("edge", edge.id, "slope_too_steep", "Slope exceeds the requested limit", {
      actual: edge.slopePercent,
      limit: constraints.maxSlopePercent
    });
  }
  if (edge.edgeType === "ramp" && edge.slopePercent === null && constraints.profile === "wheelchair") {
    return blocker("edge", edge.id, "ramp_slope_unknown", "Ramp slope has not been verified");
  }
  if (edge.clearWidthMm !== null && edge.clearWidthMm < constraints.minClearWidthMm) {
    return blocker("edge", edge.id, "edge_too_narrow", "Clear width is below the requested limit", {
      actual: edge.clearWidthMm,
      limit: constraints.minClearWidthMm
    });
  }
  if ((edge.edgeType === "door" || edge.edgeType === "threshold" || edge.edgeType === "elevator" || edge.edgeType === "lift") && edge.doorClearWidthMm === null) {
    return blocker("edge", edge.id, "door_width_unknown", "Door or cabin clear width has not been verified");
  }
  if (edge.doorClearWidthMm !== null && edge.doorClearWidthMm < constraints.minClearWidthMm) {
    return blocker("edge", edge.id, "door_too_narrow", "Door or cabin clear width is below the requested limit", {
      actual: edge.doorClearWidthMm,
      limit: constraints.minClearWidthMm
    });
  }
  return null;
}

function edgeCost(edge: AccessibilityGraphEdge, objective: RouteConstraints["objective"]): { cost: number; reasons: string[] } {
  if (objective === "distance") return { cost: edge.lengthM, reasons: [] };

  const reasons: string[] = [];
  let cost = edge.lengthM * surfaceMultipliers[edge.surface];
  if (surfaceMultipliers[edge.surface] > 1.01) reasons.push(`surface:${edge.surface}`);

  if (edge.slopePercent !== null && edge.edgeType === "ramp") {
    const slopePenalty = edge.lengthM * (edge.slopePercent / 100) * 2;
    cost += slopePenalty;
    reasons.push("slope_penalty");
  }
  if (edge.edgeType === "elevator" || edge.edgeType === "lift") {
    cost += 20;
    reasons.push("vertical_transfer");
  }
  if (edge.edgeType === "door") {
    cost += 5;
    reasons.push("door");
  }
  if (edge.edgeType === "threshold") {
    cost += edge.maxStepHeightMm / 10;
    if (edge.maxStepHeightMm > 0) reasons.push("threshold");
  }
  if (edge.edgeType === "stairs") {
    cost += 250;
    reasons.push("stairs");
  }
  return { cost, reasons };
}

function buildAdjacency(graph: AccessibilityGraph): Map<string, DirectedEdge[]> {
  const adjacency = new Map<string, DirectedEdge[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    const add = (from: string, to: string, reverse: boolean) => {
      if (!adjacency.has(from) || !adjacency.has(to)) return;
      adjacency.get(from)!.push({ edge, reverse });
    };
    if (edge.direction === "forward") add(edge.fromNodeId, edge.toNodeId, false);
    else if (edge.direction === "backward") add(edge.toNodeId, edge.fromNodeId, true);
    else {
      add(edge.fromNodeId, edge.toNodeId, false);
      add(edge.toNodeId, edge.fromNodeId, true);
    }
  }
  return adjacency;
}

function directedEndpoints(directed: DirectedEdge, from: string) {
  return {
    from,
    to: directed.edge.fromNodeId === from ? directed.edge.toNodeId : directed.edge.fromNodeId
  };
}

function edgePasses(edge: AccessibilityGraphEdge, constraints: InternalRouteConstraints) {
  return describeEdgeBlocker(edge, constraints) === null;
}

function reconstruct(
  predecessors: Map<string, { node: string; directed: DirectedEdge }>,
  start: string,
  finish: string,
  constraints: InternalRouteConstraints
): AccessibilityRouteSuccess {
  const nodeIds = [finish];
  const directedPath: DirectedEdge[] = [];
  let current = finish;
  while (current !== start) {
    const previous = predecessors.get(current);
    if (!previous) throw new Error("Route predecessor chain is incomplete");
    nodeIds.unshift(previous.node);
    directedPath.unshift(previous.directed);
    current = previous.node;
  }

  let distanceM = 0;
  let totalCost = 0;
  const edges = directedPath.map(({ edge, reverse }) => {
    const from = reverse ? edge.toNodeId : edge.fromNodeId;
    const to = reverse ? edge.fromNodeId : edge.toNodeId;
    const weighted = edgeCost(edge, constraints.objective);
    distanceM += edge.lengthM;
    totalCost += weighted.cost;
    return {
      id: edge.id,
      code: edge.code,
      fromNodeId: from,
      toNodeId: to,
      edgeType: edge.edgeType,
      surface: edge.surface,
      lengthM: edge.lengthM,
      cost: Number(weighted.cost.toFixed(2)),
      ...(weighted.reasons.length ? { reasons: weighted.reasons } : {})
    };
  });

  return {
    reachable: true,
    graphVersion: 0,
    fromNodeId: start,
    toNodeId: finish,
    constraints: publicConstraints(constraints),
    distanceM: Number(distanceM.toFixed(2)),
    cost: Number(totalCost.toFixed(2)),
    nodeIds,
    edges
  };
}

function missingRequirementBlockers(
  route: AccessibilityRouteSuccess,
  constraints: InternalRouteConstraints
): AccessibilityBlocker[] {
  const blockers: AccessibilityBlocker[] = [];
  const has = (type: AccessibilityEdgeType) => route.edges.some((edge) => edge.edgeType === type);
  if (constraints.requireElevator && !has("elevator") && !has("lift")) {
    blockers.push(blocker("route", "route", "elevator_required", "No elevator or lift is present on this route"));
  }
  if (constraints.requireRamp && !has("ramp")) {
    blockers.push(blocker("route", "route", "ramp_required", "No ramp is present on this route"));
  }
  return blockers;
}

function structuralPath(
  adjacency: Map<string, DirectedEdge[]>,
  start: string,
  finish: string
): { directedPath: DirectedEdge[] } | null {
  const predecessors = new Map<string, { node: string; directed: DirectedEdge }>();
  const queue: string[] = [start];
  const seen = new Set<string>([start]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === finish) break;
    for (const directed of adjacency.get(current) ?? []) {
      const { to } = directedEndpoints(directed, current);
      if (seen.has(to)) continue;
      seen.add(to);
      predecessors.set(to, { node: current, directed });
      queue.push(to);
    }
  }
  if (!seen.has(finish)) return null;

  const directedPath: DirectedEdge[] = [];
  let current = finish;
  while (current !== start) {
    const previous = predecessors.get(current)!;
    directedPath.unshift(previous.directed);
    current = previous.node;
  }
  return { directedPath };
}

function compareBlockers(a: AccessibilityBlocker, b: AccessibilityBlocker) {
  return a.code.localeCompare(b.code) || a.entityType.localeCompare(b.entityType) || a.id.localeCompare(b.id);
}

function boundaryBlockers(
  graph: AccessibilityGraph,
  adjacency: Map<string, DirectedEdge[]>,
  nodeById: Map<string, AccessibilityGraphNode>,
  start: string,
  constraints: InternalRouteConstraints
): AccessibilityBlocker[] {
  const reachable = new Set<string>();
  const queue = [start];
  reachable.add(start);
  while (queue.length) {
    const current = queue.shift()!;
    for (const directed of adjacency.get(current) ?? []) {
      const { to } = directedEndpoints(directed, current);
      if (reachable.has(to)) continue;
      const target = nodeById.get(to);
      if (target && describeNodeBlocker(target, constraints)) continue;
      if (!edgePasses(directed.edge, constraints)) continue;
      reachable.add(to);
      queue.push(to);
    }
  }

  const blockers: AccessibilityBlocker[] = [];
  const seen = new Set<string>();
  const add = (block: AccessibilityBlocker | null) => {
    if (!block || seen.has(`${block.entityType}:${block.id}:${block.code}`)) return;
    seen.add(`${block.entityType}:${block.id}:${block.code}`);
    blockers.push(block);
  };

  for (const currentId of reachable) {
    const current = nodeById.get(currentId);
    if (!current) continue;
    for (const directed of adjacency.get(currentId) ?? []) {
      const { to } = directedEndpoints(directed, currentId);
      if (reachable.has(to)) continue;
      add(describeEdgeBlocker(directed.edge, constraints));
      const target = nodeById.get(to);
      if (target) add(describeNodeBlocker(target, constraints));
    }
  }
  return blockers.sort(compareBlockers).slice(0, 8);
}

export function findAccessibleRoute(
  graph: AccessibilityGraph,
  query: { from: string; to: string } & AccessibilityRouteQuery
): AccessibilityRouteResult {
  const constraints = normalizeRouteConstraintsInternal(query);
  const publicRouteConstraints = publicConstraints(constraints);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const startNode = nodeById.get(query.from);
  const finishNode = nodeById.get(query.to);
  if (!startNode || !finishNode) {
    return {
      reachable: false,
      graphVersion: graph.version,
      fromNodeId: query.from,
      toNodeId: query.to,
      constraints: publicRouteConstraints,
      reason: "endpoint_missing",
      blockers: [
        ...(!startNode ? [blocker("node", query.from, "origin_not_found", "Origin node is not in the active graph")] : []),
        ...(!finishNode ? [blocker("node", query.to, "destination_not_found", "Destination node is not in the active graph")] : [])
      ]
    };
  }

  const startBlocker = describeNodeBlocker(startNode, constraints);
  const finishBlocker = describeNodeBlocker(finishNode, constraints);
  if (startBlocker || finishBlocker) {
    return {
      reachable: false,
      graphVersion: graph.version,
      fromNodeId: query.from,
      toNodeId: query.to,
      constraints: publicRouteConstraints,
      reason: "endpoint_unavailable",
      blockers: [startBlocker, finishBlocker].filter((item): item is AccessibilityBlocker => item !== null)
    };
  }

  const adjacency = buildAdjacency(graph);
  const distances = new Map<string, number>([[query.from, 0]]);
  const predecessors = new Map<string, { node: string; directed: DirectedEdge }>();
  const visited = new Set<string>();

  while (visited.size < graph.nodes.length) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const [nodeId, distance] of distances) {
      if (!visited.has(nodeId) && distance < currentDistance) {
        current = nodeId;
        currentDistance = distance;
      }
    }
    if (!current) break;
    if (current === query.to) break;
    visited.add(current);

    for (const directed of adjacency.get(current) ?? []) {
      const { to } = directedEndpoints(directed, current);
      const target = nodeById.get(to);
      if (!target || describeNodeBlocker(target, constraints) || !edgePasses(directed.edge, constraints)) continue;
      const { cost } = edgeCost(directed.edge, constraints.objective);
      const candidate = currentDistance + cost;
      if (candidate < (distances.get(to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(to, candidate);
        predecessors.set(to, { node: current, directed });
      }
    }
  }

  let requirementBlockers: AccessibilityBlocker[] = [];
  if (distances.has(query.to)) {
    const route = reconstruct(predecessors, query.from, query.to, constraints);
    requirementBlockers = missingRequirementBlockers(route, constraints);
    if (requirementBlockers.length === 0) {
      return { ...route, graphVersion: graph.version };
    }
  }

  const structural = structuralPath(adjacency, query.from, query.to);
  if (!structural) {
    return {
      reachable: false,
      graphVersion: graph.version,
      fromNodeId: query.from,
      toNodeId: query.to,
      constraints: publicRouteConstraints,
      reason: "graph_disconnected",
      blockers: []
    };
  }

  const blockers = [...requirementBlockers, ...boundaryBlockers(graph, adjacency, nodeById, query.from, constraints)]
    .sort(compareBlockers);
  const uniqueBlockers = blockers.filter((block, index) =>
    blockers.findIndex((candidate) => candidate.entityType === block.entityType && candidate.id === block.id && candidate.code === block.code) === index
  );
  return {
    reachable: false,
    graphVersion: graph.version,
    fromNodeId: query.from,
    toNodeId: query.to,
    constraints: publicRouteConstraints,
    reason: "constraints_not_satisfied",
    blockers: uniqueBlockers
  };
}
