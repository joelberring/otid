import { z } from "zod";
import { UUID_SOURCE as canonicalUuidPattern } from "./ids";

/** PLAN.md steg L2–L3 (ägaren 2026-11-13): vad kontots kartlagring består av, per kartprojekt och slag. */
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const bytes = z.number().int().min(0);

export const accountStorageProjectSchema = z.object({
  projectId: uuid,
  name: z.string().min(1).max(200),
  /** Laserkörningarnas resultatfiler (också de som blivit underlag), andra underlagsbilder, resultat och grundfilen. */
  geoBytes: bytes,
  layerBytes: bytes,
  outputBytes: bytes,
  baseBytes: bytes,
  totalBytes: bytes,
  /** Kontots avslutade körningar i projektet utom projektets senaste klara – det "Ta bort äldre körningar" tar. */
  prunableRuns: z.number().int().min(0),
  /** När projektet senast användes (PLAN.md steg L4); null = inte sedan tidpunkten började sparas. */
  lastOpenedAt: z.iso.datetime({ offset: true }).nullable()
}).strict();

export const accountStorageSchema = z.object({
  formatVersion: z.literal(1),
  usedBytes: bytes,
  /** Kontots gällande gräns (den egna eller förvalet); null = ingen gräns. */
  limitBytes: bytes.nullable(),
  /** Störst först, högst 100. */
  projects: z.array(accountStorageProjectSchema).max(100),
  /** Det som inte hör till ett kartprojekt: klubbarkivet, tävlingars och träningars kartor. */
  otherBytes: bytes
}).strict();

export const geoJobPruneResponseSchema = z.object({
  formatVersion: z.literal(1),
  removedRuns: z.number().int().min(0),
  removedLayers: z.number().int().min(0)
}).strict();

export type AccountStorage = z.infer<typeof accountStorageSchema>;
