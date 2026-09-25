import { z } from "zod";

/**
 * 无障碍通行链数据模型。
 *
 * 地点（节点）之间由通行段（边）连接：步道、坡道、电梯、楼梯、自动扶梯。
 * 每条通行段携带坡度、路面、净宽、状态等属性，通行约束档案决定某类出行者
 * （如轮椅使用者）能否通过该段。
 */

export const SEGMENT_KINDS = ["walkway", "ramp", "elevator", "stairs", "escalator"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const SEGMENT_KIND_LABELS: Record<SegmentKind, string> = {
  walkway: "步道",
  ramp: "坡道",
  elevator: "电梯",
  stairs: "楼梯",
  escalator: "自动扶梯"
};

export const SEGMENT_STATUSES = ["open", "maintenance", "closed"] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

export const SEGMENT_STATUS_LABELS: Record<SegmentStatus, string> = {
  open: "开放",
  maintenance: "维护中",
  closed: "已封闭"
};

/** 路面从平整到粗糙排列，数组下标即粗糙度等级，约束按等级上限比较。 */
export const SURFACE_KINDS = ["smooth", "paved", "uneven", "gravel"] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const SURFACE_LABELS: Record<SurfaceKind, string> = {
  smooth: "平整",
  paved: "铺装",
  uneven: "不平整",
  gravel: "碎石"
};

export const accessNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120).optional(),
    /** 所在楼层/高程层级，仅作展示与数据组织用途 */
    level: z.number().int().min(-20).max(200).optional()
  })
  .strict();
export type AccessNode = z.output<typeof accessNodeSchema>;
export type AccessNodeInput = z.input<typeof accessNodeSchema>;

export const accessSegmentSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    from: z.string().trim().min(1).max(64),
    to: z.string().trim().min(1).max(64),
    kind: z.enum(SEGMENT_KINDS),
    /** 通行长度（米），最短路以此为代价 */
    lengthM: z.number().positive().max(100_000),
    /** 坡度百分比；未知为 null */
    slopePct: z.number().min(0).max(100).nullable().optional(),
    surface: z.enum(SURFACE_KINDS).default("smooth"),
    /** 通行净宽（米）；未知为 null，未知宽度不会因净宽约束被拦截 */
    widthM: z.number().positive().max(100).nullable().optional(),
    status: z.enum(SEGMENT_STATUSES).default("open"),
    /** false 时仅允许 from → to 方向通行（如下行扶梯） */
    bidirectional: z.boolean().default(true),
    /** 垂直高差（米），信息性字段 */
    levelChangeM: z.number().min(-100).max(100).optional()
  })
  .strict();
export type AccessSegment = z.output<typeof accessSegmentSchema>;
export type AccessSegmentInput = z.input<typeof accessSegmentSchema>;

/**
 * 通行约束档案：描述出行者的能力与偏好。
 * 默认值面向轮椅使用者：避开楼梯、接受任意路面。
 */
export const accessibilityProfileSchema = z
  .object({
    /** 可接受的最大坡度百分比，超过则该段不可通行 */
    maxSlopePct: z.number().min(0).max(100).optional(),
    avoidStairs: z.boolean().default(true),
    avoidEscalators: z.boolean().default(false),
    /** 可接受的最粗糙路面，默认接受全部 */
    maxSurface: z.enum(SURFACE_KINDS).default("gravel"),
    /** 要求的最小通行净宽（米） */
    minWidthM: z.number().positive().max(100).optional(),
    /** 是否允许穿越维护中的路段，默认不允许 */
    allowMaintenance: z.boolean().default(false)
  })
  .strict();
export type AccessibilityProfile = z.output<typeof accessibilityProfileSchema>;
export type AccessibilityProfileInput = z.input<typeof accessibilityProfileSchema>;

/** 解析并补全默认值，得到规范化的约束档案。 */
export function resolveProfile(input?: AccessibilityProfileInput): AccessibilityProfile {
  return accessibilityProfileSchema.parse(input ?? {});
}
