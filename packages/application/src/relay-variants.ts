import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { planRelayTeamVariants, relaySeedOf, unfairRelayTeams, type RelayLegCourse, type UnfairRelayTeam } from "@o-tid/domain";
import { loadCourseVersionVariants } from "./course-variants";
import { relayLegCourseVersionId, type RelayClassConfig } from "./relay-model";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/**
 * Gafflad stafett i applikationen (steg 47, ADR-0174): sträckornas banor med varianter, fördelningen för ett
 * nytt lag (deterministisk med klassens frö och utifrån de befintliga lagen) och rättvisekontrollen per lag.
 */
export async function loadRelayLegCourses(tx: Executor, config: RelayClassConfig): Promise<RelayLegCourse[]> {
  const versions = [...new Set(config.legs.map(leg => relayLegCourseVersionId(config, leg.leg)))];
  const variants = await loadCourseVersionVariants(tx, versions);
  return config.legs.map(leg => {
    const courseKey = relayLegCourseVersionId(config, leg.leg);
    return { leg: leg.leg, courseKey, variants: (variants.get(courseKey) ?? []).map(variant =>
      ({ code: variant.code, controlCodes: variant.controlCodes })), ...(leg.variantCode === null ? {} : { fixedVariant: leg.variantCode }) };
  });
}

/** Lagens varianter per sträcka i klassen (bara lag som inte är strukna). */
export async function loadRelayTeamVariantPlans(tx: Executor, classId: string, exceptTeamId?: string): Promise<Map<string, Map<number, string>>> {
  const rows = await tx.select({ teamId: schema.entries.teamId, leg: schema.entries.relayLeg, code: schema.entries.courseVariantCode })
    .from(schema.entries).innerJoin(schema.teams, eq(schema.teams.id, schema.entries.teamId))
    .where(and(eq(schema.entries.classId, classId), isNotNull(schema.entries.teamId), isNull(schema.teams.struckAt)));
  const plans = new Map<string, Map<number, string>>();
  for (const row of rows) {
    if (row.teamId === exceptTeamId) continue;
    const plan = plans.get(row.teamId!) ?? new Map<number, string>();
    if (row.code !== null && row.leg !== null) plan.set(row.leg, row.code);
    plans.set(row.teamId!, plan);
  }
  return plans;
}

/** Varianterna för ett nytt lag i klassen. */
export async function planNewRelayTeamVariants(tx: Executor, config: RelayClassConfig): Promise<Map<number, string>> {
  const legs = await loadRelayLegCourses(tx, config);
  if (!legs.some(leg => leg.variants.length > 0)) return new Map();
  const existing = [...(await loadRelayTeamVariantPlans(tx, config.classId)).values()];
  return planRelayTeamVariants({ seed: relaySeedOf(config.classId), legs, existing, mode: config.forking });
}

/** Rättvisekontrollen för klassens lag: lag som inte springer samma kontrollsträckor som de flesta. */
export function relayClassFairness(legs: readonly RelayLegCourse[], teams: readonly { key: string; variants: ReadonlyMap<number, string | null> }[],
  courseControls: ReadonlyMap<string, readonly number[]>): UnfairRelayTeam[] {
  if (!legs.some(leg => leg.variants.length > 0)) return [];
  const complete = teams.flatMap(team => {
    const runs = legs.map(leg => {
      if (leg.variants.length === 0) return { leg: leg.leg, controlCodes: courseControls.get(leg.courseKey) ?? [] };
      const code = team.variants.get(leg.leg);
      const variant = leg.variants.find(row => row.code === code);
      return variant ? { leg: leg.leg, controlCodes: variant.controlCodes } : undefined;
    });
    return runs.every(run => run !== undefined) ? [{ key: team.key, legs: runs as { leg: number; controlCodes: readonly number[] }[] }] : [];
  });
  return unfairRelayTeams(complete);
}
