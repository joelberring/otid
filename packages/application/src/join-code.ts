import { eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { normalizeJoinCode } from "@o-tid/domain";
import { accountRequestAllowanceExhausted, consumeAccountRequestAllowance } from "./account-throttle";
import { publicRaceGate } from "./public-race-visibility";
import { GROUP_CODE_MISSES_PER_HOUR } from "./training-group-public";

/**
 * Översynen av startsidan 2026-11-17: "Har du en kod?" slår upp koden och säger vart den leder: en tävling (/t/), en fest
 * (/fest/) eller en träningsgrupp (/g/).
 *
 * - En tävling räknas bara när dess publika sida syns för den som frågar (samma grind som /t/: publicerad, eller
 *   förhandsvisning för den som har behörighet). En opublicerad tävling ger samma svar som en okänd kod, så att fältet inte
 *   avslöjar mer än tävlingssidan.
 * - En grupp räknas när koden finns; gruppsidan själv avgör om den är för alla eller bara för inloggade medlemmar.
 * - Gissningar delar spärren med gruppsidan (ADR-0189 beslut 8, `GROUP_CODE_IP`): varje miss räknas, och efter 30 missar i
 *   timmen från samma IP-adress svarar fältet "för många försök", också för en riktig kod.
 */
export type JoinCodeTarget = { readonly kind: "race" | "party" | "group"; readonly code: string };
export type JoinCodeResolution = { status: "not-found" } | { status: "rate-limited" } | { status: "found"; target: JoinCodeTarget };

export async function resolveJoinCode(db: Database, input: { code: string; sessionToken: string | null; clientKey?: string | undefined },
  now = new Date()): Promise<JoinCodeResolution> {
  const throttle = input.clientKey ? { scope: "GROUP_CODE_IP" as const, key: input.clientKey, limit: GROUP_CODE_MISSES_PER_HOUR } : undefined;
  if (throttle && await accountRequestAllowanceExhausted(db, throttle, now)) return { status: "rate-limited" };
  const target = await lookup(db, input.code, input.sessionToken, now);
  if (target) return { status: "found", target };
  if (throttle) await db.transaction(tx => consumeAccountRequestAllowance(tx, throttle, now));
  return { status: "not-found" };
}

async function lookup(db: Database, raw: string, sessionToken: string | null, now: Date): Promise<JoinCodeTarget | undefined> {
  const code = normalizeJoinCode(raw);
  if (!code) return undefined;
  if (code.kind === "group") {
    const [group] = await db.select({ code: schema.trainingGroups.code }).from(schema.trainingGroups)
      .where(eq(schema.trainingGroups.code, code.code)).limit(1);
    return group ? { kind: "group", code: group.code } : undefined;
  }
  const [race] = await db.select({ id: schema.races.id, shortCode: schema.races.shortCode, raceType: schema.races.raceType })
    .from(schema.races).where(eq(schema.races.shortCode, code.code)).limit(1);
  if (!race || (await publicRaceGate(db, race.id, sessionToken, now)).access === "NONE") return undefined;
  return { kind: race.raceType === "PARTY" ? "party" : "race", code: race.shortCode };
}
