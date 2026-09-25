import type { PoolClient } from "pg";
import { pool, query } from "../db";
import { AppError, notFound } from "../errors";
import { recordAudit } from "../audit";
import { getAccessibilityGraphCache } from "./cache";
import type {
  AccessibilityGraph,
  AccessibilityGraphEdge,
  AccessibilityGraphNode,
  AccessibilityRouteResult
} from "./graph";
import { findAccessibleRoute } from "./graph";
import type {
  AccessibilityEdgeInput,
  AccessibilityNodeInput,
  AccessibilityRouteQuery
} from "@map/shared/accessibility";

type GraphMetaRow = { version: string };
type NodeRow = Omit<AccessibilityGraphNode, "longitude" | "latitude"> & {
  longitude: string | number;
  latitude: string | number;
};
type EdgeRow = Omit<AccessibilityGraphEdge, "lengthM"> & {
  length_m: string | number;
  coordinates: Array<[number, number]>;
};

type NodeUpdate = { [K in keyof AccessibilityNodeInput]?: AccessibilityNodeInput[K] | undefined };
type EdgeUpdate = { [K in keyof AccessibilityEdgeInput]?: AccessibilityEdgeInput[K] | undefined };
type CompleteNodeInput = Required<Omit<AccessibilityNodeInput, "code" | "description" | "doorClearWidthMm" | "featureId">> &
  Pick<AccessibilityNodeInput, "code" | "description" | "doorClearWidthMm" | "featureId">;
type CompleteEdgeInput = Required<Omit<AccessibilityEdgeInput, "code" | "name" | "description" | "coordinates" | "lengthM" | "slopePercent" | "clearWidthMm" | "hasHandrails" | "doorClearWidthMm">> &
  Pick<AccessibilityEdgeInput, "code" | "name" | "description" | "coordinates" | "lengthM" | "slopePercent" | "clearWidthMm" | "hasHandrails" | "doorClearWidthMm">;

async function beginRepeatableRead(client: PoolClient): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
}

async function currentVersion(client: PoolClient): Promise<number> {
  const result = await client.query<GraphMetaRow>("SELECT version FROM accessibility_graph_meta WHERE id = 1");
  return Number(result.rows[0]?.version ?? 0);
}

const nodeSelect = `
  SELECT id, code, name, description, node_type AS "nodeType",
         ST_X(geom::geometry) AS longitude, ST_Y(geom::geometry) AS latitude,
         floor, indoor, operational_status AS "operationalStatus",
         threshold_step_mm AS "thresholdStepMm",
         door_clear_width_mm AS "doorClearWidthMm",
         feature_id AS "featureId"
  FROM accessibility_nodes
  WHERE deleted_at IS NULL
`;

const edgeSelect = `
  SELECT id, code, from_node_id AS "fromNodeId", to_node_id AS "toNodeId",
         edge_type AS "edgeType", direction, name, description,
         ST_AsGeoJSON(geom)::jsonb->'coordinates' AS coordinates,
         length_m AS length_m, surface, slope_percent AS "slopePercent",
         clear_width_mm AS "clearWidthMm", max_step_height_mm AS "maxStepHeightMm",
         has_handrails AS "hasHandrails", door_clear_width_mm AS "doorClearWidthMm",
         operational_status AS "operationalStatus", source
  FROM accessibility_edges
  WHERE deleted_at IS NULL
`;

async function loadGraphFromClient(client: PoolClient, version: number): Promise<AccessibilityGraph> {
  const [nodesResult, edgesResult] = await Promise.all([
    client.query<NodeRow>(nodeSelect),
    client.query<EdgeRow>(edgeSelect)
  ]);
  const nodes: AccessibilityGraphNode[] = nodesResult.rows.map(serializeNode);
  const edges: AccessibilityGraphEdge[] = edgesResult.rows.map((row) => {
    const { length_m, coordinates: _coordinates, ...edge } = row;
    return { ...edge, lengthM: Number(length_m) };
  });
  return { version, nodes, edges };
}

export async function getAccessibleGraphForRead(client: PoolClient): Promise<AccessibilityGraph> {
  const version = await currentVersion(client);
  const cached = await getAccessibilityGraphCache().get(version);
  if (cached && cached.version === version) return cached;
  const graph = await loadGraphFromClient(client, version);
  await getAccessibilityGraphCache().set(graph);
  return graph;
}

export async function listAccessibleNodes(input: { bbox: [number, number, number, number]; limit: number }) {
  const [minLon, minLat, maxLon, maxLat] = input.bbox;
  const envelope = minLon > maxLon
    ? `ST_Collect(
        ST_SetSRID(ST_MakeEnvelope($1, $2, 180, $4), 4326),
        ST_SetSRID(ST_MakeEnvelope(-180, $2, $3, $4), 4326)
      )`
    : "ST_SetSRID(ST_MakeEnvelope($1, $2, $3, $4), 4326)";
  const result = await query<NodeRow>(
    `${nodeSelect} AND ST_Intersects(geom, ${envelope}::geography) ORDER BY name LIMIT $5`,
    [minLon, minLat, maxLon, maxLat, input.limit]
  );
  return result.rows.map(serializeNode);
}

export async function listAccessibleEdges(input: { bbox: [number, number, number, number]; limit: number }) {
  const [minLon, minLat, maxLon, maxLat] = input.bbox;
  const envelope = minLon > maxLon
    ? `ST_Collect(
        ST_SetSRID(ST_MakeEnvelope($1, $2, 180, $4), 4326),
        ST_SetSRID(ST_MakeEnvelope(-180, $2, $3, $4), 4326)
      )`
    : "ST_SetSRID(ST_MakeEnvelope($1, $2, $3, $4), 4326)";
  const result = await query<EdgeRow>(
    `${edgeSelect} AND ST_Intersects(geom, ${envelope}::geography) ORDER BY length_m DESC LIMIT $5`,
    [minLon, minLat, maxLon, maxLat, input.limit]
  );
  return result.rows.map(serializeEdge);
}

export async function findAccessibleRouteInGraph(input: AccessibilityRouteQuery): Promise<AccessibilityRouteResult> {
  const client = await pool.connect();
  await beginRepeatableRead(client);
  try {
    const graph = await getAccessibleGraphForRead(client);
    const result = findAccessibleRoute(graph, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createAccessibleNode(input: AccessibilityNodeInput, actorId: string): Promise<{ id: string; version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.featureId) await assertFeatureExists(client, input.featureId);
    const result = await client.query<{ id: string }>(
      `INSERT INTO accessibility_nodes(
         code, name, description, node_type, geom, floor, indoor, operational_status,
         threshold_step_mm, door_clear_width_mm, feature_id
       ) VALUES (
         $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         $7, $8, $9, $10, $11, $12
       ) RETURNING id`,
      [
        input.code ?? null, input.name, input.description ?? null, input.nodeType,
        input.longitude, input.latitude, input.floor, input.indoor, input.operationalStatus,
        input.thresholdStepMm, input.doorClearWidthMm ?? null, input.featureId ?? null
      ]
    );
    await recordAudit(client, {
      actorId,
      action: "accessibility_node.created",
      resourceType: "accessibility_node",
      resourceId: result.rows[0]!.id,
      metadata: { code: input.code ?? null, nodeType: input.nodeType }
    });
    const version = await readVersionAfterWrite(client);
    await client.query("COMMIT");
    return { id: result.rows[0]!.id, version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAccessibleNode(id: string, input: NodeUpdate, actorId: string): Promise<{ version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id FROM accessibility_nodes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [id]
    );
    if (!existing.rowCount) throw notFound("Accessibility node not found");
    if (input.featureId) await assertFeatureExists(client, input.featureId);

    const next = {
      ...(await getNodeForUpdate(client, id)),
      ...input
    } as CompleteNodeInput;
    await client.query(
      `UPDATE accessibility_nodes SET
         code = $2, name = $3, description = $4, node_type = $5,
         geom = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
         floor = $8, indoor = $9, operational_status = $10,
         threshold_step_mm = $11, door_clear_width_mm = $12, feature_id = $13,
         updated_at = now()
       WHERE id = $1`,
      [
        id, next.code ?? null, next.name, next.description ?? null, next.nodeType,
        next.longitude, next.latitude, next.floor, next.indoor, next.operationalStatus,
        next.thresholdStepMm, next.doorClearWidthMm ?? null, next.featureId ?? null
      ]
    );
    await recordAudit(client, {
      actorId,
      action: "accessibility_node.updated",
      resourceType: "accessibility_node",
      resourceId: id,
      metadata: { fields: Object.keys(input) }
    });
    const version = await readVersionAfterWrite(client);
    await client.query("COMMIT");
    return { version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAccessibleNode(id: string, actorId: string): Promise<{ version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const references = await client.query(
      `SELECT 1 FROM accessibility_edges
       WHERE deleted_at IS NULL AND ($1 IN (from_node_id, to_node_id))
       LIMIT 1`,
      [id]
    );
    if (references.rowCount) throw new AppError(409, "NODE_IN_USE", "Delete or detach active edges before deleting this node");
    const result = await client.query(
      "UPDATE accessibility_nodes SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (!result.rowCount) throw notFound("Accessibility node not found");
    await recordAudit(client, {
      actorId,
      action: "accessibility_node.deleted",
      resourceType: "accessibility_node",
      resourceId: id
    });
    const version = await readVersionAfterWrite(client);
    await client.query("COMMIT");
    return { version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createAccessibleEdge(input: AccessibilityEdgeInput, actorId: string): Promise<{ id: string; version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { coordinates, lengthM } = await resolveEdgeGeometry(client, input);
    const result = await client.query<{ id: string }>(
      `INSERT INTO accessibility_edges(
         code, from_node_id, to_node_id, edge_type, direction, name, description,
         geom, length_m, surface, slope_percent, clear_width_mm, max_step_height_mm,
         has_handrails, door_clear_width_mm, operational_status, source
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         ST_GeomFromGeoJSON($8)::geography,
         COALESCE($9::numeric, ST_Length(ST_GeomFromGeoJSON($8)::geography)),
         $10, $11, $12, $13, $14, $15, $16, $17
       ) RETURNING id`,
      [
        input.code ?? null, input.fromNodeId, input.toNodeId, input.edgeType, input.direction,
        input.name ?? null, input.description ?? null, JSON.stringify({
          type: "LineString",
          coordinates
        }),
        input.lengthM ?? null, input.surface, input.slopePercent ?? null,
        input.clearWidthMm ?? null, input.maxStepHeightMm, input.hasHandrails ?? null,
        input.doorClearWidthMm ?? null, input.operationalStatus, input.source
      ]
    );
    await recordAudit(client, {
      actorId,
      action: "accessibility_edge.created",
      resourceType: "accessibility_edge",
      resourceId: result.rows[0]!.id,
      metadata: { code: input.code ?? null, edgeType: input.edgeType }
    });
    const version = await readVersionAfterWrite(client);
    await client.query("COMMIT");
    return { id: result.rows[0]!.id, version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAccessibleEdge(id: string, input: EdgeUpdate, actorId: string): Promise<{ version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id FROM accessibility_edges WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [id]
    );
    if (!existing.rowCount) throw notFound("Accessibility edge not found");
    const current = await getEdgeForUpdate(client, id);
    const next = { ...current, ...input } as CompleteEdgeInput;
    const { coordinates } = await resolveEdgeGeometry(client, next);
    const explicitLength = Object.prototype.hasOwnProperty.call(input, "lengthM") ? input.lengthM ?? null : null;
    await client.query(
      `UPDATE accessibility_edges SET
         code = $2, edge_type = $3, direction = $4, name = $5, description = $6,
         geom = ST_GeomFromGeoJSON($7)::geography,
         length_m = COALESCE($8::numeric, ST_Length(ST_GeomFromGeoJSON($7)::geography)),
         surface = $9, slope_percent = $10, clear_width_mm = $11,
         max_step_height_mm = $12, has_handrails = $13, door_clear_width_mm = $14,
         operational_status = $15, source = $16, updated_at = now()
       WHERE id = $1`,
      [
        id, next.code ?? null, next.edgeType, next.direction, next.name ?? null,
        next.description ?? null, JSON.stringify({ type: "LineString", coordinates }),
        explicitLength, next.surface, next.slopePercent ?? null, next.clearWidthMm ?? null,
        next.maxStepHeightMm, next.hasHandrails ?? null, next.doorClearWidthMm ?? null,
        next.operationalStatus, next.source
      ]
    );
    await recordAudit(client, {
      actorId,
      action: "accessibility_edge.updated",
      resourceType: "accessibility_edge",
      resourceId: id,
      metadata: { fields: Object.keys(input) }
    });
    const version = await readVersionAfterWrite(client);
    await client.query("COMMIT");
    return { version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAccessibleEdge(id: string, actorId: string): Promise<{ version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "UPDATE accessibility_edges SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (!result.rowCount) throw notFound("Accessibility edge not found");
    await recordAudit(client, {
      actorId,
      action: "accessibility_edge.deleted",
      resourceType: "accessibility_edge",
      resourceId: id
    });
    const version = await readVersionAfterWrite(client);
    await client.query("COMMIT");
    return { version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertFeatureExists(client: PoolClient, featureId: string): Promise<void> {
  const result = await client.query(
    "SELECT 1 FROM map_features WHERE id = $1 AND deleted_at IS NULL",
    [featureId]
  );
  if (!result.rowCount) throw notFound("Linked map feature not found");
}

async function getNodeForUpdate(client: PoolClient, id: string): Promise<AccessibilityNodeInput> {
  const result = await client.query<NodeRow>(`${nodeSelect} AND id = $1 FOR UPDATE`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound("Accessibility node not found");
  const { longitude, latitude, ...rest } = row;
  return {
    ...rest,
    longitude: Number(longitude),
    latitude: Number(latitude),
    description: rest.description ?? undefined,
    code: rest.code ?? undefined,
    doorClearWidthMm: rest.doorClearWidthMm ?? undefined,
    featureId: rest.featureId ?? undefined
  };
}

async function getEdgeForUpdate(client: PoolClient, id: string): Promise<AccessibilityEdgeInput> {
  const result = await client.query<EdgeRow & { coordinates: Array<[number, number]> }>(
    `${edgeSelect} AND id = $1 FOR UPDATE`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw notFound("Accessibility edge not found");
  const { length_m, fromNodeId, toNodeId, ...rest } = row;
  return {
    ...rest,
    fromNodeId,
    toNodeId,
    lengthM: Number(length_m),
    coordinates: row.coordinates,
    code: rest.code ?? undefined,
    name: rest.name ?? undefined,
    description: rest.description ?? undefined,
    slopePercent: rest.slopePercent ?? undefined,
    clearWidthMm: rest.clearWidthMm ?? undefined,
    hasHandrails: rest.hasHandrails ?? undefined,
    doorClearWidthMm: rest.doorClearWidthMm ?? undefined
  };
}

async function resolveEdgeGeometry(
  client: PoolClient,
  input: Pick<AccessibilityEdgeInput, "fromNodeId" | "toNodeId" | "coordinates" | "lengthM">
): Promise<{ coordinates: Array<[number, number]>; lengthM: number | null }> {
  const endpoints = await client.query<{
    from_lon: string; from_lat: string; to_lon: string; to_lat: string;
  }>(
    `SELECT
       ST_X(from_node.geom::geometry) AS from_lon,
       ST_Y(from_node.geom::geometry) AS from_lat,
       ST_X(to_node.geom::geometry) AS to_lon,
       ST_Y(to_node.geom::geometry) AS to_lat
     FROM accessibility_nodes from_node
     JOIN accessibility_nodes to_node ON to_node.id = $2 AND to_node.deleted_at IS NULL
     WHERE from_node.id = $1 AND from_node.deleted_at IS NULL`,
    [input.fromNodeId, input.toNodeId]
  );
  const endpointsRow = endpoints.rows[0];
  if (!endpointsRow) throw notFound("Accessibility edge endpoint not found");

  const start: [number, number] = [Number(endpointsRow.from_lon), Number(endpointsRow.from_lat)];
  const end: [number, number] = [Number(endpointsRow.to_lon), Number(endpointsRow.to_lat)];
  const coordinates = input.coordinates ?? [start, end];
  if (!sameCoordinate(coordinates[0]!, start) || !sameCoordinate(coordinates[coordinates.length - 1]!, end)) {
    throw new AppError(400, "EDGE_ENDPOINT_MISMATCH", "Edge geometry must start and end at its connected nodes");
  }
  return { coordinates, lengthM: input.lengthM ?? null };
}

function serializeNode(row: NodeRow): AccessibilityGraphNode {
  return { ...row, longitude: Number(row.longitude), latitude: Number(row.latitude) };
}

function serializeEdge(row: EdgeRow): AccessibilityGraphEdge & { coordinates: Array<[number, number]> } {
  const { length_m, coordinates, ...edge } = row;
  return { ...edge, lengthM: Number(length_m), coordinates };
}

function sameCoordinate(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
}

async function readVersionAfterWrite(client: PoolClient): Promise<number> {
  const result = await client.query<GraphMetaRow>("SELECT version FROM accessibility_graph_meta WHERE id = 1");
  return Number(result.rows[0]?.version ?? 0);
}
