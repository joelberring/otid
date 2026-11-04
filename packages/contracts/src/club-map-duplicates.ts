import { z } from "zod";
import { uuidSchema } from "./ids";
import type { ClubMapView } from "./club-archive";

/**
 * ADR-0210: dubbletter och versioner av klubbarkivets kartor (förslagen, "Slå ihop till en karta", "Inte samma karta",
 * "Ångra sammanslagning", "Kopiera till alla versioner") och kartorna som kontot får använda i en ny tävling
 * ("Välj karta från klubbarkivet").
 */
const coordinate = z.number().finite().min(-100_000_000).max(100_000_000);
const extentSchema = z.object({ minX: coordinate, minY: coordinate, maxX: coordinate, maxY: coordinate }).strict()
  .refine(extent => extent.minX <= extent.maxX && extent.minY <= extent.maxY);

/** Kartversionens fingeravtryck (som `MapFingerprint` i @o-tid/domain), räknat i webbläsaren vid kontrollen. */
export const mapFingerprintSchema = z.object({
  scale: z.number().int().min(100).max(1_000_000),
  bounds: extentSchema,
  projected: z.object({ epsg: z.number().int().min(1).max(999_999), extent: extentSchema }).strict().nullable(),
  symbols: z.array(z.string().min(1).max(24)).max(600),
  symbolHash: z.string().regex(/^[0-9a-f]{8}$/),
  objectCount: z.number().int().nonnegative().max(10_000_000)
}).strict();
export type MapFingerprintPayload = z.infer<typeof mapFingerprintSchema>;

const mapIds = z.array(uuidSchema).min(2).max(20).refine(ids => new Set(ids).size === ids.length);

/** "Slå ihop till en karta": `keepMapId` behåller namnet och uppgifterna; de andras versioner flyttas dit. */
export const clubMapsMergeRequestSchema = z.object({ formatVersion: z.literal(1), keepMapId: uuidSchema, mapIds })
  .strict().refine(value => value.mapIds.includes(value.keepMapId));

/** "Inte samma karta": alla par bland kartorna föreslås aldrig igen. */
export const clubMapDuplicateDismissRequestSchema = z.object({ formatVersion: z.literal(1), mapIds }).strict();

export const CLUB_MAP_COPY_FIELDS = ["maker", "note"] as const;
export type ClubMapCopyField = typeof CLUB_MAP_COPY_FIELDS[number];

/**
 * "Kopiera till alla versioner" (från en version) eller "Från kartan" (`fromVersionId` null: kartans kartritare).
 * `versionIds` är versionerna som ska ändras (alla andra versioner av kartan, eller en).
 */
export const clubMapVersionsCopyRequestSchema = z.object({
  formatVersion: z.literal(1),
  fromVersionId: uuidSchema.nullable(),
  fields: z.array(z.enum(CLUB_MAP_COPY_FIELDS)).min(1).max(CLUB_MAP_COPY_FIELDS.length).refine(fields => new Set(fields).size === fields.length),
  versionIds: z.array(uuidSchema).min(1).max(500)
}).strict();

export type ClubMapDuplicateReason =
  | { kind: "AREA"; overlap: number; contained: number }
  | { kind: "SAME_NAME" } | { kind: "SIMILAR_NAME" } | { kind: "SAME_EXTENT" } | { kind: "SAME_SYMBOLS" } | { kind: "SIMILAR_SYMBOLS" }
  | { kind: "SAME_SCALE" } | { kind: "SHARED_TRAININGS"; count: number };

export interface ClubMapDuplicateCluster {
  /** Kartorna i gruppen; `keepMapId` är förvalet (flest träningar, annars nyaste versionen). */
  mapIds: string[];
  keepMapId: string;
  level: "HIGH" | "MEDIUM";
  reasons: ClubMapDuplicateReason[];
  /** Kartorna utan fingeravtryck (inte kontrollerade än): jämförda bara på namnet och träningarna. */
  unchecked: string[];
  /** Varje kartas yta ur nyaste kontrollerade versionen: i terrängen (meter) och på papperet (mm och skala). */
  extents: { mapId: string; ground: { width: number; height: number } | null; paper: { width: number; height: number; scale: number } | null }[];
}

export interface ClubMapDuplicatesResponse { formatVersion: 1; clusters: ClubMapDuplicateCluster[] }

/** En sammanslagning i kartans historik. */
export interface ClubMapMergeView {
  mergeId: string;
  createdAt: string;
  absorbedNames: string[];
  versions: number;
  /** "Ångra sammanslagning" går så länge ingenting annat har ändrat kartan. */
  undoable: boolean;
  undoneAt: string | null;
}

export interface ClubMapMergeResponse { formatVersion: 1; mapId: string; mergeId: string; versionsMoved: number }

/** En karta som kontot får använda i en ny tävling, med klubben och vad kartans villkor säger. */
export interface UsableClubMap {
  clubId: string;
  clubName: string;
  map: ClubMapView;
  /** Villkoren att säga till om ("Avtalet har gått ut", "Bara träning", "Avgift per utskrift"). */
  issues: ("EXPIRED" | "TRAINING_ONLY" | "FEE_PER_PRINT")[];
}

export interface UsableClubMapsResponse { formatVersion: 1; maps: UsableClubMap[] }
