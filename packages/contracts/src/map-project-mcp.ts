import { z } from "zod";

/**
 * ADR-0219 (K2): MCP-verktygens argument. Koordinater i kartans mm med y uppåt; områden som min/max. Gränserna gäller både
 * verktygen och kartjobben.
 */
export const MCP_MAX_IMAGE_SIDE_PX = 1600;
export const MCP_PROPOSAL_MAX_OPERATIONS = 200;
export const MCP_PROPOSAL_MAX_SIDE_M = 500;
/**
 * Ägaren 2026-11-16 («stärka AI-kopplingen så att du får göra större ändringar», «se över så att det inte drar för mycket»):
 * i läget självständigt (AUTONOMOUS, när kontot självt får ändra kartan) får ett anrop täcka så mycket; förslag som en människa
 * ska granska håller sig inom 500 m. list_objects ger hela geometrin först på begäran (max_points), högst så många punkter
 * per objekt och i hela svaret, så att ett svar inte blir större än det som frågades efter.
 */
export const MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS = 3000;
export const MCP_OBJECTS_DEFAULT_POINTS = 40;
export const MCP_OBJECTS_MAX_POINTS_PER_OBJECT = 2000;
export const MCP_OBJECTS_MAX_POINTS = 6000;
/** Laserkörningens raster som kan hämtas som träningsdata (jobbets filer `<namn>.png` och `<namn>.pgw`). */
export const MCP_TRAINING_RASTERS = ["hojd", "fuktdjup", "vegetationsklasser", "relief", "skuggning", "lasveg", "lasmark", "laskron"] as const;

/** read_laser_output: högst så många objekt per svar, punkter per objekt och punkter i hela svaret, och så stor fil som läses. */
export const MCP_LASER_OUTPUT_MAX_OBJECTS = 500;
export const MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT = 500;
export const MCP_LASER_OUTPUT_MAX_POINTS = 5000;
export const MCP_LASER_OUTPUT_MAX_BYTES = 24 * 1024 * 1024;
/**
 * Ägaren 2026-11-13 (apply_base_map, AI:n lägger in grundkartan): laserjobbets filer får tillsammans vara högst så stora och
 * grundkartan ge högst så många objekt per laserjobb; ett större blad läggs in en etapp i taget. Gränserna följer kartjobbets
 * minne (512 MB i utskriftsarbetaren): ett syntetiskt blad om 16 km² med 37 MB filer gick på 9 s, 52 MB tog slut på minnet.
 */
export const MCP_BASE_MAP_MAX_BYTES = 32 * 1024 * 1024;
export const MCP_BASE_MAP_MAX_OBJECTS = 60_000;

const boxSchema = z.object({ min_x: z.number().finite(), min_y: z.number().finite(), max_x: z.number().finite(), max_y: z.number().finite() })
  .refine(box => box.max_x > box.min_x && box.max_y > box.min_y, "max ska vara större än min")
  .transform(box => ({ minX: box.min_x, minY: box.min_y, maxX: box.max_x, maxY: box.max_y }));
const idSchema = z.string().uuid();
const keySchema = z.string().min(3).max(300);
const codeSchema = z.string().min(1).max(12);
const pointsSchema = z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(2000);
/** En yta med hål: yttre ringen först, sedan hålen. */
const ringsSchema = z.array(z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(2000)).min(1).max(200);

export const mcpProposalOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), symbol: codeSchema, points: pointsSchema.optional(), rings: ringsSchema.optional(), angle: z.number().finite().optional() }),
  z.object({ op: z.literal("move"), key: keySchema, dx: z.number().finite(), dy: z.number().finite() }),
  z.object({ op: z.literal("reshape"), key: keySchema, points: pointsSchema.optional(), rings: ringsSchema.optional() }),
  // Klipp en yta mot andra ytor i kartan utan att skicka några koordinater (delarna som blir kvar; flera delar blir flera objekt).
  z.object({ op: z.literal("subtract"), key: keySchema, by: z.array(keySchema).min(1).max(50) }),
  z.object({ op: z.literal("change_symbol"), key: keySchema, symbol: codeSchema }),
  z.object({ op: z.literal("delete"), key: keySchema })
]);

/** Ny tom karta (ägaren 2026-11-12): en rektangel kring en mittpunkt i SWEREF 99 TM. */
export const mcpCreateMapProjectSchema = z.object({ name: z.string().trim().min(1).max(120), center_e: z.number().finite(), center_n: z.number().finite(),
  width_m: z.number().min(100).max(15000), height_m: z.number().min(100).max(15000), scale: z.union([z.literal(10000), z.literal(15000), z.literal(4000), z.literal(3000)]).optional() });

export const mcpToolInputSchemas = {
  map_overview: z.object({ project_id: idSchema }),
  render_view: z.object({ project_id: idSchema, area: boxSchema.optional(), width_px: z.number().int().min(200).max(MCP_MAX_IMAGE_SIDE_PX).optional(),
    grid: z.boolean().optional(), highlight: z.array(keySchema).max(200).optional(), hide_symbols: z.array(codeSchema).max(100).optional(),
    // Ägaren 2026-11-17: underlagen (ortofoto, IR, skuggning) under kartan, utpekade med en del av namnet.
    underlays: z.array(z.string().min(1).max(80)).max(4).optional(), map_opacity: z.number().min(0).max(1).optional() }),
  render_compare: z.object({ project_id: idSchema, area: boxSchema.optional(), width_px: z.number().int().min(200).max(MCP_MAX_IMAGE_SIDE_PX / 2).optional() }),
  // Ägaren 2026-11-11: träningsdata för att lära geo-arbetarens regler av en väl ritad karta.
  training_labels: z.object({ project_id: idSchema, min_e: z.number().finite(), min_n: z.number().finite(), max_e: z.number().finite(), max_n: z.number().finite(),
    cell: z.number().min(0.5).max(10).optional() }).refine(box => box.max_e > box.min_e && box.max_n > box.min_n, "max ska vara större än min"),
  training_raster: z.object({ project_id: idSchema, name: z.enum(MCP_TRAINING_RASTERS), job_id: idSchema.optional() }),
  list_objects: z.object({ project_id: idSchema, area: boxSchema.optional(), symbols: z.array(codeSchema).max(50).optional(),
    limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional(),
    keys: z.array(keySchema).min(1).max(100).optional(), max_points: z.number().int().min(2).max(MCP_OBJECTS_MAX_POINTS_PER_OBJECT).optional(),
    brief: z.boolean().optional() }),
  // Ägaren 2026-11-13: AI-kopplingen startar och läser laserkörningar (etapp 1 av «AI:n tar fram ett kartblad»).
  list_laser_jobs: z.object({ project_id: idSchema }),
  start_laser_job: z.object({ project_id: idSchema, area_id: idSchema.optional(), name: z.string().trim().min(1).max(80).optional(),
    contour_interval: z.number().min(1).max(10).optional(), settings: z.record(z.string().max(40), z.number().finite()).optional() }),
  read_laser_output: z.object({ project_id: idSchema, file: z.string().regex(/^[a-z0-9_.-]{1,60}$/), job_id: idSchema.optional(), area: boxSchema.optional(),
    layers: z.array(z.string().min(1).max(120)).max(50).optional(), limit: z.number().int().min(1).max(MCP_LASER_OUTPUT_MAX_OBJECTS).optional(),
    offset: z.number().int().min(0).optional(), max_points: z.number().int().min(2).max(MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT).optional() }),
  apply_base_map: z.object({ project_id: idSchema, job_id: idSchema.optional(), knolls: z.number().int().min(1).max(10).optional(),
    cliffs: z.number().int().min(1).max(10).optional(), again: z.boolean().optional(),
    // Ägaren 2026-11-16 («fylla det hav som saknas»): bara vissa symboler ur grundkartan, och kartans objekt med dem byts ut.
    symbols: z.array(z.string().regex(/^\d{3}(\.\d{1,2})?$/)).min(1).max(50).optional(), replace: z.boolean().optional() }),
  norm_check: z.object({ project_id: idSchema, area: boxSchema.optional() }),
  // K6 del 2: generaliseringen (förenkla, ta bort det som är mindre än normen, foga ihop linjer, ytor inuti likadana ytor).
  generalize: z.object({ project_id: idSchema, area: boxSchema.optional(), simplify_mm: z.number().min(0).max(0.5).optional(),
    remove_small: z.boolean().optional(), join_lines: z.boolean().optional(), remove_inside: z.boolean().optional(), propose: z.boolean().optional(),
    note: z.string().trim().max(500).optional() }),
  // Ägaren 2026-11-16 («det som lyser över fel på tomtmark»): markens detaljer och vegetationen bort ur det bebyggda.
  clear_built: z.object({ project_id: idSchema, area: boxSchema.optional(), propose: z.boolean().optional(), note: z.string().trim().max(500).optional() }),
  propose_changes: z.object({ project_id: idSchema, note: z.string().trim().max(500),
    operations: z.array(mcpProposalOperationSchema).min(1).max(MCP_PROPOSAL_MAX_OPERATIONS) })
} as const;
