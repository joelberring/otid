import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * PLAN K4c Huvudkälla (0143): en inläst vektorfil går före OpenStreetMap inom sitt område för de slag den täcker. Området är ytor
 * i kartans mm (yttre ring först, sedan hål), som `PrimaryArea` i map-revision.
 */
export const MAP_PROJECT_PRIMARY_KINDS = ["buildings", "roads", "railway", "bridges", "water", "walls", "fences"] as const;
export const MAP_PROJECT_PRIMARY_LIMITS = { sources: 20, polygons: 200, points: 6000, coordinate: 5_000_000 } as const;
const pointSchema = z.object({ x: z.number().finite().min(-MAP_PROJECT_PRIMARY_LIMITS.coordinate).max(MAP_PROJECT_PRIMARY_LIMITS.coordinate),
  y: z.number().finite().min(-MAP_PROJECT_PRIMARY_LIMITS.coordinate).max(MAP_PROJECT_PRIMARY_LIMITS.coordinate) }).strict();
export const mapProjectPrimaryAreaSchema = z.array(z.array(z.array(pointSchema).min(3)).min(1).max(50)).min(1).max(MAP_PROJECT_PRIMARY_LIMITS.polygons)
  .refine(area => area.reduce((sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0), 0) <= MAP_PROJECT_PRIMARY_LIMITS.points);
export const mapProjectPrimaryCreateRequestSchema = z.object({
  formatVersion: z.literal(1), sourceId: uuidSchema, name: z.string().trim().min(1).max(160),
  area: mapProjectPrimaryAreaSchema, kinds: z.array(z.enum(MAP_PROJECT_PRIMARY_KINDS)).min(1).max(MAP_PROJECT_PRIMARY_KINDS.length)
}).strict();
export type MapProjectPrimaryKind = (typeof MAP_PROJECT_PRIMARY_KINDS)[number];

export interface MapProjectPrimarySourceView {
  readonly sourceId: string; readonly name: string; readonly kinds: readonly MapProjectPrimaryKind[];
  readonly area: readonly (readonly (readonly { readonly x: number; readonly y: number }[])[])[]; readonly createdAt: string;
}
/**
 * Kartobjekt som ett inlagt utkast (0132) lade till och som ingen ändrat sedan, med symbolnumren som i det utkastet bara kom ur
 * OpenStreetMap. Utkast från före 0132 finns inte här: deras objekts ursprung går inte att avgöra.
 */
export interface MapProjectOsmOriginView { readonly decisions: readonly { readonly codes: readonly string[]; readonly keys: readonly string[] }[] }
