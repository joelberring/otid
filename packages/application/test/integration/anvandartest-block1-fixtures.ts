import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { createDatabase, Database } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { commitStartDrawAsAdmin, previewStartDrawAsAdmin } from "../../src/start-draw";
import { accountOnRace } from "./accounts";

/**
 * Användartestet 2026-11-12, block 1: en tävling med gafflad bana (course-data-forked.xml: H21 på Lång med varianterna
 * AC, AD, BC och BD, D21 på Kort) och anmälda ur entry-list-forked.xml (Cia AD, Dan BC, Eva AC, Fia BD; Ada, Bo utan).
 * H21 lottas med masstart 07:55 och D21 med minutstart från 08:00.
 */
type Pool = ReturnType<typeof createDatabase>["pool"];
export type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

export const RACE_DATE = "2027-10-07";
export const MASS_START = "2027-10-07T05:55:00.000Z"; // 07:55 i Stockholm
export const MINUTE_START = "2027-10-07T06:00:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/iof/${name}`, import.meta.url));
const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
export type Variant = "AC" | "AD" | "BC" | "BD";
export function variantCodes(code: Variant): number[] {
  const first = code[0] as "A" | "B", second = code[1] as "C" | "D";
  return [31, ...loops[first], ...loops[first === "A" ? "B" : "A"], 50, 32, ...loops[second], ...loops[second === "C" ? "D" : "C"], 60, 33];
}

export async function forkedRace(db: Database, pool: Pool) {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `block1.${suffix}@test.o-tid.se`, displayName: "Arrangör",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Gafflat", raceName: "Natt", raceDate: RACE_DATE, timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
    csrfHeader: entered.csrfToken };
  for (const name of ["course-data-forked.xml", "entry-list-forked.xml", "course-assignment-forked.xml"]) {
    const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
    if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
  }
  const classes = Object.fromEntries((await pool.query<{ id: string; name: string }>("select id, name from class where race_id = $1",
    [proof.raceId])).rows.map(row => [row.name, row.id])) as Record<"H21" | "D21", string>;
  const settings = { firstStartTime: MASS_START, clubSeparation: false, classes: [
    { classId: classes.H21, method: "MASS" as const, intervalMinutes: 2, vacancies: { kind: "COUNT" as const, value: 0 } },
    { classId: classes.D21, method: "MINUTE" as const, intervalMinutes: 2, vacancies: { kind: "COUNT" as const, value: 0 },
      laterStart: { kind: "CLOCK" as const, startTime: MINUTE_START } }] };
  const before = new Date();
  const shown = await previewStartDrawAsAdmin(db, { ...proof, request: { formatVersion: 1, ...settings } }, before);
  if (shown.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${shown.status}`);
  const requestId = randomUUID();
  const drawn = await commitStartDrawAsAdmin(db, { ...proof, idempotencyKey: `start-draw:${requestId}`,
    request: { formatVersion: 1, requestId, seed: shown.response.seed, ...settings, confirmChanges: shown.response.requiresConfirmation } }, before);
  if (drawn.status !== "drawn") throw new Error(`Lottningen sparades inte: ${drawn.status}`);
  return { proof, classes };
}

export async function entryIds(pool: Pool, raceId: string): Promise<Record<string, string>> {
  const rows = (await pool.query<{ id: string; given_name: string }>("select id, given_name from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.id]));
}

/** En avläsning med stämplingarna för varianten, startstämpling `start` och mål `minutes` efter masstarten. */
export async function readout(db: Database, pool: Pool, proof: Proof, cardNumber: string, variant: Variant,
  options: { start?: string; minutes?: number } = {}) {
  const startMs = Date.parse(options.start ?? "2027-10-07T05:08:21.000Z");
  const finishMs = Date.parse(MASS_START) + (options.minutes ?? 30) * 60_000;
  const codes = variantCodes(variant);
  const step = Math.floor((finishMs - Date.parse(MASS_START)) / (codes.length + 1));
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: new Date(startMs).toISOString(), finishPunchedAt: new Date(finishMs).toISOString(),
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse(MASS_START) + (index + 1) * step).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version.snapshot_version,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(),
      transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
  return ingested.response.acknowledgements[0]!;
}
