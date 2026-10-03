import { z } from "zod";
import { raceAdministratorLoginRequestSchema } from "./race-administrator";
import { raceOverviewAdminLoginRequestSchema } from "./race-overview-admin";
import { startCheckinAdminLoginRequestSchema, finishForestWatchAdminLoginRequestSchema } from "./start-checkin-admin";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const timestamp = z.iso.datetime({ precision: 3 }).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const base = z.object({ formatVersion: z.literal(1), eventId: uuid, raceId: uuid, expiresAt: timestamp }).strict();
const credential = z.object({ formatVersion: z.literal(1), credentialId: uuid, raceId: uuid,
  label: z.string().min(1).max(120), issuedAt: timestamp, expiresAt: timestamp }).strict();
export const DemoInstallationSchema = base.extend({ credentials: z.tuple([
  credential.extend({ capability: z.literal("VIEW_RACE_OVERVIEW"), accessCredential: raceOverviewAdminLoginRequestSchema.shape.accessCredential }),
  credential.extend({ capability: z.literal("START_CHECKIN"), accessCredential: startCheckinAdminLoginRequestSchema.shape.accessCredential }),
  credential.extend({ capability: z.literal("FINISH_FOREST_WATCH"), accessCredential: finishForestWatchAdminLoginRequestSchema.shape.accessCredential }),
  credential.extend({ capability: z.literal("MANAGE_RACE"), accessCredential: raceAdministratorLoginRequestSchema.shape.accessCredential })
]) }).strict().superRefine((value, ctx) => {
  const ids = value.credentials.map(row => row.credentialId);
  if (new Set(ids).size !== ids.length || value.credentials.some(row => row.raceId !== value.raceId ||
    row.expiresAt !== value.expiresAt || row.accessCredential.split(".")[1] !== row.credentialId ||
    Date.parse(row.expiresAt) <= Date.parse(row.issuedAt) || Date.parse(row.expiresAt) - Date.parse(row.issuedAt) > 3_600_000)) {
    ctx.addIssue({ code: "custom", message: "Demo credentials must have exact scope, identity and bounded lifetime" });
  }
});
export const DemoSummarySchema = base.extend({
  synthetic: z.literal(true),
  paths: z.object({ overview: z.string(), manage: z.string(), simulator: z.string(), results: z.string(), checkin: z.string(), forestWatch: z.string() }).strict()
}).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value.paths) !== JSON.stringify(demoPaths(value.raceId))) ctx.addIssue({ code: "custom", message: "Demo paths must match scope" });
});
function demoPaths(raceId: string) {
  return { overview: `/admin/${raceId}`, manage: `/admin/${raceId}/manage`, simulator: `/admin/${raceId}/simulator`, results: `/results/${raceId}`,
    checkin: `/checkin/index.html#${raceId}`, forestWatch: `/admin/${raceId}/forest-watch` };
}
export function createDemoSummary(value: unknown) {
  const summary = base.parse(value);
  return DemoSummarySchema.parse({ ...summary, synthetic: true, paths: demoPaths(summary.raceId) });
}
