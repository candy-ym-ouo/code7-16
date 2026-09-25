import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { accessibilityRouteQuerySchema } from "@map/shared/accessibility";
import { AppError } from "../errors";
import { findAccessibleRouteInGraph, listAccessibleEdges, listAccessibleNodes } from "./service";

function parseBbox(value: string): [number, number, number, number] {
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) {
    throw new AppError(400, "VALIDATION_FAILED", "bbox must contain four numbers");
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90 || minLat >= maxLat) {
    throw new AppError(400, "VALIDATION_FAILED", "bbox longitude, latitude or order is invalid");
  }
  return [minLon, minLat, maxLon, maxLat];
}

export async function accessibilityRoutes(app: FastifyInstance) {
  app.get("/accessibility/nodes", async (request) => {
    const input = z.object({
      bbox: z.string(),
      limit: z.coerce.number().int().min(1).max(1000).default(500)
    }).parse(request.query);
    return { nodes: await listAccessibleNodes({ bbox: parseBbox(input.bbox), limit: input.limit }) };
  });

  app.get("/accessibility/edges", async (request) => {
    const input = z.object({
      bbox: z.string(),
      limit: z.coerce.number().int().min(1).max(2000).default(1000)
    }).parse(request.query);
    return { edges: await listAccessibleEdges({ bbox: parseBbox(input.bbox), limit: input.limit }) };
  });

  app.get("/accessibility/routes/shortest", async (request) => {
    const input = accessibilityRouteQuerySchema.parse(request.query);
    return await findAccessibleRouteInGraph(input);
  });
}
