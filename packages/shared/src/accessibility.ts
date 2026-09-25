import { z } from "zod";

export const accessibilityNodeTypes = [
  "entrance", "building", "room", "platform", "crossing", "intersection", "landmark", "transit_stop"
] as const;
export const accessibilityEdgeTypes = [
  "sidewalk", "ramp", "elevator", "lift", "stairs", "threshold", "path", "crossing", "door"
] as const;
export const accessibilitySurfaces = [
  "paved", "asphalt", "concrete", "rubber", "brick", "gravel", "grass", "dirt", "tactile", "metal", "wood", "unknown"
] as const;
export const accessibilityOperationalStatuses = ["operational", "closed", "maintenance", "unknown"] as const;
export const accessibilityEdgeDirections = ["forward", "backward", "both"] as const;
export const accessibilityTravelProfiles = ["wheelchair", "walk"] as const;
export const accessibilityRouteObjectives = ["distance", "accessibility"] as const;

const longitude = z.number().min(-180).max(180);
const latitude = z.number().min(-90).max(90);
export const coordinateSchema = z.tuple([longitude, latitude]);
const code = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9:_-]*$/i);
const optionalCode = code.optional();
const optionalDescription = z.string().trim().max(2000).nullable().optional();
const optionalText = z.string().trim().max(160).nullable().optional();
const millimeters = z.number().int().min(0).max(10000);

export const createAccessibilityNodeSchema = z.object({
  code: optionalCode,
  name: z.string().trim().min(1).max(160),
  description: optionalDescription,
  nodeType: z.enum(accessibilityNodeTypes),
  longitude,
  latitude,
  floor: z.string().trim().min(1).max(20).default("1"),
  indoor: z.boolean().default(false),
  operationalStatus: z.enum(accessibilityOperationalStatuses).default("operational"),
  thresholdStepMm: z.number().int().min(0).max(1000).default(0),
  doorClearWidthMm: millimeters.nullable().optional(),
  featureId: z.string().uuid().nullable().optional()
}).strict();

export const updateAccessibilityNodeSchema = createAccessibilityNodeSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one node field must be provided" }
);

const edgeGeometrySchema = z.array(coordinateSchema).min(2).max(10_000);

export const createAccessibilityEdgeSchema = z.object({
  code: optionalCode,
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  edgeType: z.enum(accessibilityEdgeTypes),
  direction: z.enum(accessibilityEdgeDirections).default("both"),
  name: optionalText,
  description: optionalDescription,
  coordinates: edgeGeometrySchema.optional(),
  lengthM: z.number().min(0).max(20_000).optional(),
  surface: z.enum(accessibilitySurfaces).default("unknown"),
  slopePercent: z.number().min(0).max(100).nullable().optional(),
  clearWidthMm: z.number().int().min(100).max(10_000).nullable().optional(),
  maxStepHeightMm: z.number().int().min(0).max(1000).default(0),
  hasHandrails: z.boolean().nullable().optional(),
  doorClearWidthMm: z.number().int().min(100).max(5000).nullable().optional(),
  operationalStatus: z.enum(accessibilityOperationalStatuses).default("operational"),
  source: z.string().trim().min(1).max(80).default("curator")
}).strict().refine((value) => value.fromNodeId !== value.toNodeId, {
  message: "Edge cannot connect a node to itself",
  path: ["toNodeId"]
});

export const updateAccessibilityEdgeSchema = createAccessibilityEdgeSchema.omit({
  fromNodeId: true,
  toNodeId: true
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one edge field must be provided"
});

export const accessibilityRouteQuerySchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
  profile: z.enum(accessibilityTravelProfiles).default("wheelchair"),
  objective: z.enum(accessibilityRouteObjectives).default("distance"),
  maxSlopePercent: z.coerce.number().min(0).max(100).optional(),
  minClearWidthMm: z.coerce.number().int().min(100).max(10_000).optional(),
  maxStepHeightMm: z.coerce.number().int().min(0).max(1000).optional(),
  requireElevator: z.coerce.boolean().optional(),
  requireRamp: z.coerce.boolean().optional(),
  avoidStairs: z.coerce.boolean().optional(),
  requireOperational: z.coerce.boolean().default(true),
  allowUnknownSurface: z.coerce.boolean().default(false),
  allowedSurfaces: z.string().trim().max(300).optional(),
  includeUnavailable: z.coerce.boolean().default(false)
}).strict().refine((value) => value.from !== value.to, {
  message: "Origin and destination must be different",
  path: ["to"]
});

export type AccessibilityNodeInput = z.infer<typeof createAccessibilityNodeSchema>;
export type AccessibilityEdgeInput = z.infer<typeof createAccessibilityEdgeSchema>;
export type AccessibilityRouteQuery = z.infer<typeof accessibilityRouteQuerySchema>;
