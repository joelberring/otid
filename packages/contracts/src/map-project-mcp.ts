import { z } from "zod";

/**
 * ADR-0219 (K2): MCP-verktygens argument. Koordinater i kartans mm med y uppåt; områden som min/max. Gränserna gäller både
 * verktygen och kartjobben.
 */
export const MCP_MAX_IMAGE_SIDE_PX = 1600;
export const MCP_PROPOSAL_MAX_OPERATIONS = 200;
export const MCP_PROPOSAL_MAX_SIDE_M = 500;

const boxSchema = z.object({ min_x: z.number().finite(), min_y: z.number().finite(), max_x: z.number().finite(), max_y: z.number().finite() })
  .refine(box => box.max_x > box.min_x && box.max_y > box.min_y, "max ska vara större än min")
  .transform(box => ({ minX: box.min_x, minY: box.min_y, maxX: box.max_x, maxY: box.max_y }));
const idSchema = z.string().uuid();
const keySchema = z.string().min(3).max(300);
const codeSchema = z.string().min(1).max(12);
const pointsSchema = z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(2000);

export const mcpProposalOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), symbol: codeSchema, points: pointsSchema, angle: z.number().finite().optional() }),
  z.object({ op: z.literal("move"), key: keySchema, dx: z.number().finite(), dy: z.number().finite() }),
  z.object({ op: z.literal("reshape"), key: keySchema, points: pointsSchema }),
  z.object({ op: z.literal("change_symbol"), key: keySchema, symbol: codeSchema }),
  z.object({ op: z.literal("delete"), key: keySchema })
]);

export const mcpToolInputSchemas = {
  map_overview: z.object({ project_id: idSchema }),
  render_view: z.object({ project_id: idSchema, area: boxSchema.optional(), width_px: z.number().int().min(200).max(MCP_MAX_IMAGE_SIDE_PX).optional(),
    grid: z.boolean().optional(), highlight: z.array(keySchema).max(200).optional(), hide_symbols: z.array(codeSchema).max(100).optional() }),
  render_compare: z.object({ project_id: idSchema, area: boxSchema.optional(), width_px: z.number().int().min(200).max(MCP_MAX_IMAGE_SIDE_PX / 2).optional() }),
  list_objects: z.object({ project_id: idSchema, area: boxSchema.optional(), symbols: z.array(codeSchema).max(50).optional(),
    limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }),
  norm_check: z.object({ project_id: idSchema, area: boxSchema.optional() }),
  propose_changes: z.object({ project_id: idSchema, note: z.string().trim().max(500),
    operations: z.array(mcpProposalOperationSchema).min(1).max(MCP_PROPOSAL_MAX_OPERATIONS) })
} as const;
