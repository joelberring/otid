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
export const bingoModeSchema = z.enum(["BINGO", "SHIPS"]);
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
  /** Fälla mot robotar: ett dolt fält som en människa lämnar tomt. */
  website: z.string().max(200).optional()
});
export type BingoProgressRequest = z.infer<typeof bingoProgressRequestSchema>;

/** Kvittot; `seed` är fröet som servern har för löparens skepp (Sänka skepp), som telefonen då använder. */
export const bingoProgressResponseSchema = z.object({ formatVersion: z.literal(1), runnerId: uuid, cells: z.number().int().min(0),
  seed: z.number().int().min(0).optional() });
export type BingoProgressResponse = z.infer<typeof bingoProgressResponseSchema>;

export const bingoStandingSchema = z.object({
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
    cellNames: z.array(z.string()).optional() }))
});
export type BingoLeaderboard = z.infer<typeof bingoLeaderboardSchema>;

const rect = z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() });
export const bingoGroupSchema = z.object({
  course: z.string(), name: z.string(), cellMeters: z.number(),
  /** Sänka skepp: skeppens längder (gruppens eller efter rutnätets storlek). */
  ships: z.array(z.number().int()),
  /** Sänka skepp: de gemensamma skeppens längder (samma för alla i gruppen; placeras ur tävlingens och banans id). */
  sharedShips: z.array(z.number().int()),
  cells: z.array(z.object({ name: z.string(), rect }))
});
export type BingoGroup = z.infer<typeof bingoGroupSchema>;

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
    sharedSunk: z.number().int().min(0)
  }))
});
export type BingoAdminView = z.infer<typeof bingoAdminViewSchema>;

export const bingoSettingRequestSchema = z.object({ formatVersion: z.literal(1), enabled: z.boolean(), mode: bingoModeSchema.optional() });
