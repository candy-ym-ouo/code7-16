import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createAccessibilityEdgeSchema,
  createAccessibilityNodeSchema,
  updateAccessibilityEdgeSchema,
  updateAccessibilityNodeSchema
} from "@map/shared/accessibility";
import { requireModerator } from "../auth";
import {
  createAccessibleEdge,
  createAccessibleNode,
  deleteAccessibleEdge,
  deleteAccessibleNode,
  updateAccessibleEdge,
  updateAccessibleNode
} from "./service";

const uuidParams = z.object({ id: z.string().uuid() });

export async function accessibilityAdminRoutes(app: FastifyInstance) {
  app.post("/moderation/accessibility/nodes", { preHandler: requireModerator }, async (request, reply) => {
    const input = createAccessibilityNodeSchema.parse(request.body);
    const result = await createAccessibleNode(input, request.user!.id);
    return reply.code(201).send(result);
  });

  app.patch("/moderation/accessibility/nodes/:id", { preHandler: requireModerator }, async (request) => {
    const params = uuidParams.parse(request.params);
    const input = updateAccessibilityNodeSchema.parse(request.body);
    return await updateAccessibleNode(params.id, input, request.user!.id);
  });

  app.delete("/moderation/accessibility/nodes/:id", { preHandler: requireModerator }, async (request) => {
    const params = uuidParams.parse(request.params);
    return await deleteAccessibleNode(params.id, request.user!.id);
  });

  app.post("/moderation/accessibility/edges", { preHandler: requireModerator }, async (request, reply) => {
    const input = createAccessibilityEdgeSchema.parse(request.body);
    const result = await createAccessibleEdge(input, request.user!.id);
    return reply.code(201).send(result);
  });

  app.patch("/moderation/accessibility/edges/:id", { preHandler: requireModerator }, async (request) => {
    const params = uuidParams.parse(request.params);
    const input = updateAccessibilityEdgeSchema.parse(request.body);
    return await updateAccessibleEdge(params.id, input, request.user!.id);
  });

  app.delete("/moderation/accessibility/edges/:id", { preHandler: requireModerator }, async (request) => {
    const params = uuidParams.parse(request.params);
    return await deleteAccessibleEdge(params.id, request.user!.id);
  });
}
