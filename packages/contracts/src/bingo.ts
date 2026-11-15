import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Bingoorientering med telefonen (ADR-0225). Löparen anmäler sig på plats utan konto (namn och grupp) och telefonen skickar
 * hela sitt läge med jämna mellanrum: tagna rutor, sträckan, status och spåret (kartans mm, förenklat). Mottagningen är
 * idempotent på tävling + `runnerId` (telefonens id för loppet); telefonen raderar inget förrän servern kvitterat.
 */
export const BINGO_NAME_MAX = 60;
export const BINGO_TRACK_MAX = 4000;
export const BINGO_CELLS_MAX = 900;

const instant = z.number().int().min(1_500_000_000_000).max(4_000_000_000_000);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
export const bingoStatusSchema = z.enum(["RUNNING", "FINISHED", "ABANDONED"]);
/** Bingo eller Sänka skepp (ägaren 2026-11-15), per träning. */
export const bingoModeSchema = z.enum(["BINGO", "SHIPS", "CONTROLS"]);
/** Virtuella kontroller (ADR-0226): duellens kod (versaler och siffror) och lagets namn. */
export const duelCodeSchema = z.string().regex(/^[A-Z0-9]{2,12}$/);
const punch = z.object({ control: z.string().min(1).max(64), at: z.number().int().min(1_500_000_000_000).max(4_000_000_000_000),
  x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000), accuracyM: z.number().finite().min(0).max(10_000) });
export type BingoMode = z.infer<typeof bingoModeSchema>;
const shot = z.object({ cell: z.string().min(1).max(8), at: instant, x: coordinate, y: coordinate, accuracyM: z.number().finite().min(0).max(10_000) });

export const bingoProgressRequestSchema = z.object({
  formatVersion: z.literal(1),
  runnerId: uuid,
  name: z.string().max(200),
  /** Gruppen: banans id i banläggningen. */
  group: z.string().min(1).max(64),
  status: bingoStatusSchema,
  startedAt: instant,
  finishedAt: instant.nullable(),
  distanceM: z.number().finite().min(0).max(500_000),
  taken: z.array(z.object({ cell: z.string().min(1).max(8), at: instant })).max(BINGO_CELLS_MAX),
  track: z.array(z.tuple([coordinate, coordinate, instant])).max(BINGO_TRACK_MAX),
  gaps: z.array(z.tuple([instant, instant])).max(500),
  /** Sänka skepp: fröet för löparens skepp (servern behåller det första) och skotten. */
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
  shots: z.array(shot).max(2000).optional(),
  /** Virtuella kontroller: stämplingarna (banans kontroll-id), duellens kod och laget (tomt = eget lag). */
  punches: z.array(punch).max(500).optional(),
  duel: duelCodeSchema.optional(),
  team: z.string().max(200).optional(),
  /** Fälla mot robotar: ett dolt fält som en människa lämnar tomt. */
  website: z.string().max(200).optional()
});
export type BingoProgressRequest = z.infer<typeof bingoProgressRequestSchema>;

/** Kvittot; `seed` är fröet som servern har för löparens skepp (Sänka skepp), som telefonen då använder. */
export const bingoProgressResponseSchema = z.object({ formatVersion: z.literal(1), runnerId: uuid, cells: z.number().int().min(0),
  seed: z.number().int().min(0).optional() });
export type BingoProgressResponse = z.infer<typeof bingoProgressResponseSchema>;

export const bingoStandingSchema = z.object({
  /** Virtuella kontroller: tagna kontroller, i mål, duellen och laget. `points` = poängbanans eller duellens poäng. */
  controls: z.number().int().min(0).optional(), finished: z.boolean().optional(), duel: z.string().optional(), team: z.string().optional(),
  name: z.string(), cells: z.number().int().min(0), status: bingoStatusSchema, seconds: z.number().int().min(0), distanceM: z.number().int().min(0),
  /** Sänka skepp: poäng, sänkta skepp, träffar, fel ruta och senaste skottet (ms). */
  points: z.number().int().optional(), sunk: z.number().int().min(0).optional(), hits: z.number().int().min(0).optional(),
  wrong: z.number().int().min(0).optional(), water: z.number().int().min(0).optional(), sharedSunk: z.number().int().min(0).optional(), lastShotAt: z.number().nullable().optional()
});
export const bingoLeaderboardSchema = z.object({
  formatVersion: z.literal(1),
  mode: bingoModeSchema,
  groups: z.array(z.object({ course: z.string(), name: z.string(), cells: z.number().int().min(0), runners: z.array(bingoStandingSchema),
    /** Sänka skepp: hur många i gruppen som skjutit på rutan och stått i den (inte om det var träff), per ruta. Inga namn. */
    shotCells: z.record(z.string(), z.number().int().min(0)).optional(),
    /** Sänka skepp: rutornas namn (för rutnätet på tävlingssidan). */
    cellNames: z.array(z.string()).optional() })),
  /**
   * Virtuella kontroller: dueller (lagens poäng och vem som tog vilken kontroll först, för notiserna och färgerna). Inga
   * positioner.
   */
  duels: z.array(z.object({ code: z.string(), course: z.string(),
    teams: z.array(z.object({ team: z.string(), points: z.number().int(), runners: z.array(z.string()) })),
    taken: z.array(z.object({ control: z.string(), code: z.string(), team: z.string(), runner: z.string(), at: z.number(), points: z.number().int(),
      place: z.number().int() })) })).optional()
});
export type BingoLeaderboard = z.infer<typeof bingoLeaderboardSchema>;

const rect = z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() });
export const bingoGroupSchema = z.object({
  course: z.string(), name: z.string(), cellMeters: z.number(),
  /** Sänka skepp: skeppens längder (gruppens eller efter rutnätets storlek). */
  ships: z.array(z.number().int()),
  /** Sänka skepp: de gemensamma skeppens längder (samma för alla i gruppen; placeras ur tävlingens och banans id). */
  sharedShips: z.array(z.number().int()),
  /** Fröet för de gemensamma skeppen (ur tävlingens och banans id, eller gruppens efter «Slumpa om»). */
  sharedSeed: z.number().int().min(0),
  /** Bara i ledarens vy: de gemensamma skeppen (rutornas namn). */
  sharedCells: z.array(z.array(z.string())).optional(),
  cells: z.array(z.object({ name: z.string(), rect }))
});
export type BingoGroup = z.infer<typeof bingoGroupSchema>;

/** Virtuella kontroller: radien (5–100 m), automatisk stämpling eller knapp, och duellens poäng per kod. */
export const virtualSettingsSchema = z.object({ radiusM: z.number().int().min(5).max(100), punch: z.enum(["AUTO", "BUTTON"]),
  points: z.record(z.string().regex(/^[A-Za-z0-9]{1,8}$/), z.number().int().min(0).max(1000)) });
export type VirtualSettings = z.infer<typeof virtualSettingsSchema>;

/** En bana för virtuella kontroller: kontrollerna i banans ordning med läget i kartans mm. */
export const virtualCourseSchema = z.object({ course: z.string(), name: z.string(), order: z.enum(["ORDERED", "SCORE"]),
  controls: z.array(z.object({ id: z.string(), kind: z.enum(["START", "CONTROL", "FINISH"]), code: z.string(), x: z.number(), y: z.number(),
    points: z.number() })) });
export type VirtualCourseView = z.infer<typeof virtualCourseSchema>;

/** Ledarens vy (admin): grupperna och alla löpare med spåren. */
export const bingoAdminViewSchema = z.object({
  formatVersion: z.literal(1),
  enabled: z.boolean(),
  mode: bingoModeSchema,
  published: z.boolean(),
  shortCode: z.string(),
  raceDate: z.string(),
  mapScale: z.number(),
  /** Kartbilden i kartans mm (bildens övre vänstra hörn och pixlar per mm); null utan kartfil. */
  image: z.object({ originX: z.number(), originY: z.number(), pxPerMm: z.number(), width: z.number(), height: z.number() }).nullable(),
  groups: z.array(bingoGroupSchema),
  /** Virtuella kontroller: banorna och inställningarna. */
  courses: z.array(virtualCourseSchema).optional(),
  settings: virtualSettingsSchema.optional(),
  runners: z.array(z.object({
    id: uuid, name: z.string(), course: z.string(), groupName: z.string(), status: bingoStatusSchema,
    startedAt: z.number(), finishedAt: z.number().nullable(), updatedAt: z.number(), distanceM: z.number().int(), seconds: z.number().int(),
    taken: z.array(z.object({ cell: z.string(), at: z.number() })),
    track: z.array(z.tuple([z.number(), z.number(), z.number()])),
    gaps: z.array(z.tuple([z.number(), z.number()])),
    /** Sänka skepp: skeppen (rutornas namn), skotten med bedömningen och poängen. */
    ships: z.array(z.array(z.string())),
    /** Hur många av skeppen (de första i `ships`) som är gruppens gemensamma. */
    sharedShips: z.number().int().min(0),
    shots: z.array(shot.extend({ result: z.enum(["HIT", "SUNK", "WATER", "WRONG"]) })),
    points: z.number().int(), sunk: z.number().int(), hits: z.number().int(), wrong: z.number().int(), water: z.number().int().min(0).optional(),
    sharedSunk: z.number().int().min(0),
    /** Virtuella kontroller: de giltiga stämplingarna, duellen och laget. */
    punches: z.array(punch.extend({ code: z.string(), fromStartMs: z.number() })).optional(),
    duel: z.string().nullable().optional(), team: z.string().nullable().optional(), controls: z.number().int().optional()
  }))
});
export type BingoAdminView = z.infer<typeof bingoAdminViewSchema>;

export const bingoSettingRequestSchema = z.object({ formatVersion: z.literal(1), enabled: z.boolean(), mode: bingoModeSchema.optional(),
  settings: virtualSettingsSchema.optional() });
