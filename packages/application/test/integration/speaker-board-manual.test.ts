import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import {
  contentHash,
  createEvent,
  importIofXml,
  ingestDeviceBatch,
  listSpeakerBoardAsAdmin,
  listAdministratorForestWatch,
  correctAdministratorStart,
  registerAdministratorReturn
} from "../../src";
import type { EntryStatusDecision } from "@o-tid/contracts";
import { statusFlow } from "./entry-status-helpers";
import { raceLogin } from "./accounts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-06T12:00:00.000Z");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

const flow = statusFlow(db);

/** Ett beslut för Ada i statusflödet. */
async function decideForAda(raceId: string, decision: EntryStatusDecision) {
  const auth = await admin(raceId, "ADMIN");
  const result = await flow.decide(auth, await flow.entryId(raceId, "Ada"), decision, { now });
  expect(result.status).toBe("decided");
}

async function fixture() {
  const { race } = await createEvent(db, { name: "Manuell speakertest", raceName: "Lång",
    raceDate: "2026-08-30", timeZone: "Europe/Stockholm" });
  for (const file of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, race.id, await readFile(new URL(`../../../../fixtures/iof/${file}`, import.meta.url), "utf8"));
  }
  return race.id;
}

async function admin(raceId: string, role: "ADMIN" | "FUNCTIONARY") {
  const login = await raceLogin(db, raceId, role, now);
  return { sessionToken: login.sessionToken, raceId, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

function payload(kind: "ok" | "missing") {
  const punches = kind === "ok" ? [31, 32, 33] : [31, 33];
  return { cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z", punches: punches.map((code, index) => ({
      code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z`
    })) };
}

async function ingest(raceId: string, kind: "ok" | "missing") {
  const value = payload(kind);
  const response = await ingestDeviceBatch(db, raceId, { deviceId: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator", payload: value, contentHash: contentHash(value) }] });
  expect(response.acknowledgements[0]?.status).toBe("stored");
}

async function board(raceId: string) {
  const auth = await admin(raceId, "FUNCTIONARY");
  const response = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: auth.sessionToken }, now);
  if (response.status !== "ok") throw new Error(`Speakerunderlag saknas: ${response.status}`);
  const [row] = response.response.rows;
  if (!row || row.state !== "ACTIVE_RESULT") throw new Error("Aktivt speakerresultat saknas");
  return row;
}

describe("TASK 008 speaker: manuella resultatlivscykler PostgreSQL", () => {
  it("behåller aktiv DSQ över senare teknisk OK", async () => {
    const raceId = await fixture();
    await ingest(raceId, "ok");
    await decideForAda(raceId, { kind: "DISQUALIFIED" });
    await ingest(raceId, "ok");
    expect((await board(raceId)).result).toMatchObject({ status: "DSQ", reason: "MANUAL_DISQUALIFICATION" });
  });

  it("behåller aktiv approval över senare teknisk MP", async () => {
    const raceId = await fixture();
    await ingest(raceId, "missing");
    await decideForAda(raceId, { kind: "APPROVE_MANUALLY" });
    await ingest(raceId, "missing");
    expect((await board(raceId)).result).toMatchObject({ status: "OK", reason: "MANUAL_APPROVAL" });
  });

  it("behåller aktiv DNF över senare teknisk MP utan tid", async () => {
    const raceId = await fixture();
    await ingest(raceId, "missing");
    await decideForAda(raceId, { kind: "DID_NOT_FINISH" });
    await ingest(raceId, "missing");
    expect((await board(raceId)).result).toEqual(expect.objectContaining({ status: "DNF", reason: "DID_NOT_FINISH" }));
    expect((await board(raceId)).result).not.toHaveProperty("elapsedMs");
  });

  it("behåller aktiv OOC över senare teknisk OK", async () => {
    const raceId = await fixture();
    await ingest(raceId, "ok");
    await decideForAda(raceId, { kind: "OUT_OF_COMPETITION" });
    await ingest(raceId, "ok");
    expect((await board(raceId)).result).toMatchObject({ status: "OOC", reason: "OUT_OF_COMPETITION" });
  });

  it("behåller aktiv NT över senare teknisk OK och exponerar aldrig tid", async () => {
    const raceId = await fixture();
    await ingest(raceId, "ok");
    await decideForAda(raceId, { kind: "WITHOUT_TIMING" });
    await ingest(raceId, "ok");
    const row = await board(raceId);
    expect(row.result).toEqual(expect.objectContaining({ status: "NT", reason: "WITHOUT_TIMING" }));
    expect(row.result).not.toHaveProperty("elapsedMs");
  });

  it("visar återtaget manuellt DNS som NO_ACTIVE_RESULT utan fallback eller tid", async () => {
    const raceId = await fixture();
    await decideForAda(raceId, { kind: "DID_NOT_START" });
    const speaker = await admin(raceId, "FUNCTIONARY");
    const before = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (before.status !== "ok") throw new Error("DNS-speakerunderlag saknas");
    const beforeRow = before.response.rows.find((row) => row.givenName === "Ada");
    expect(beforeRow).toMatchObject({ state: "ACTIVE_RESULT", result: { status: "DNS", reason: "DID_NOT_START" } });

    await decideForAda(raceId, { kind: "WITHDRAW" });

    const after = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (after.status !== "ok") throw new Error("Återtaget DNS-speakerunderlag saknas");
    const row = after.response.rows.find((item) => item.givenName === "Ada");
    // Borttaget ej start är en ny revision utan aktivt resultat.
    expect(row).toMatchObject({ state: "NO_ACTIVE_RESULT", registeredAt: beforeRow?.registeredAt });
    expect(row?.selectedRevision).not.toEqual(beforeRow?.selectedRevision);
    expect(row).not.toHaveProperty("result");
    expect(after.response.raceSnapshotVersion).toBe(before.response.raceSnapshotVersion);
  });

  it("tolkar avpricknings-DNS med exakt källa och döljer den efter målkorrektion", async () => {
    const raceId = await fixture();
    // Funktionären vid starten rapporterar Ada som ej startad (ADR-0172 beslut 3).
    const start = await admin(raceId, "FUNCTIONARY");
    const roster = await listAdministratorForestWatch(db, start, now);
    if (roster.status !== "ok") throw new Error("Avprickningsroster saknas");
    const ada = roster.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!ada) throw new Error("Ada saknas i avprickningsroster");
    const common = { formatVersion: 1 as const, entryId: ada.entryId, packageVersion: roster.response.snapshotVersion,
      expectedEntryVersion: ada.entryVersion, observedAt: now.toISOString() };
    const dns = await correctAdministratorStart(db, { ...start, request: { ...common, requestId: crypto.randomUUID(),
      expectedRevision: ada.revision, targetStartState: "REPORTED_NOT_STARTED" } }, now);
    expect(dns).toMatchObject({ status: "stored", response: { receipt: { effect: { kind: "APPLIED" } } } });

    const speaker = await admin(raceId, "FUNCTIONARY");
    const before = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (before.status !== "ok") throw new Error("Avpricknings-DNS speakerunderlag saknas");
    const beforeRow = before.response.rows.find((row) => row.givenName === "Ada");
    expect(beforeRow).toMatchObject({ state: "ACTIVE_RESULT", result: { status: "DNS", reason: "DID_NOT_START" } });

    // Funktionären i mål registrerar återkomst; avpricknings-DNS:et tas tillbaka.
    const withdrawn = await registerAdministratorReturn(db, { ...start, request: { ...common, requestId: crypto.randomUUID(),
      expectedRevision: 1, expectedStartState: "REPORTED_NOT_STARTED" } }, now);
    expect(withdrawn).toMatchObject({ status: "stored", response: { receipt: { effect: { kind: "APPLIED" } } } });

    const after = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (after.status !== "ok") throw new Error("Korrigerat avpricknings-DNS speakerunderlag saknas");
    const row = after.response.rows.find((item) => item.givenName === "Ada");
    expect(row).toMatchObject({ state: "NO_ACTIVE_RESULT", selectedRevision: beforeRow?.selectedRevision,
      registeredAt: beforeRow?.registeredAt });
    expect(row).not.toHaveProperty("result");
  });
});
