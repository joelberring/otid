import { z } from "zod";
import { pmObjectManifestSchema } from "./pm-object-manifest";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime().refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
});
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const engine = z.object({ version: z.string().max(32).regex(/^\d+\.\d+\.\d+$/), sha256: hash }).strict();
const run = z.object({
  exitCode: z.number().int().min(0).max(255).nullable(),
  signal: z.enum(["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGBUS", "OTHER"]).nullable(),
  timedOut: z.boolean(), outputTruncated: z.boolean(), hasErrors: z.boolean(), hasWarnings: z.boolean()
}).strict();
const signature = z.object({ version: count.min(1), sha256: hash, builtAt: instant }).strict();

/** Server-internal observations, never a public request or proof of production isolation. */
export const pmScanEvidenceSchema = z.object({
  formatVersion: z.literal(1),
  executionProfile: z.literal("native-probe-v1"),
  scanPolicy: z.literal("pm-pdf-v1"),
  manifest: pmObjectManifestSchema,
  startedAt: instant,
  finishedAt: instant,
  contentVerified: z.boolean(),
  cleanupSucceeded: z.boolean(),
  qpdf: z.object({ engine, check: run.nullable(), encryption: run.nullable() }).strict().nullable(),
  clamav: z.object({
    engine, run,
    summary: z.object({ scannedFiles: count, infectedFiles: count }).strict().nullable(),
    databases: z.object({ signaturesVerified: z.boolean(), daily: signature, main: signature, bytecode: signature }).strict().nullable()
  }).strict().nullable()
}).strict().refine(value => Date.parse(value.finishedAt) >= Date.parse(value.startedAt), "Invalid scan interval");

export type PmScanEvidence = z.infer<typeof pmScanEvidenceSchema>;
