import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { decodeRecordedFrames, normalizeCard } from "../../../sportident/src";
import {
  applyReadoutRereadAsAdmin, exportIofResultListAsAdmin, getAdministratorEffectiveResult, listEntryTransfersAsAdmin,
  previewReadoutRereadAsAdmin, publicResults, setResultsOfficialAsAdmin
} from "../../src";
import { recalculateEntry } from "../../src/result-recalculation";
import { raceAuth } from "./accounts";
import { personResultBody, statusFlow, type Auth } from "./entry-status-helpers";
import { db, useRaceDatabase } from "./race-fixtures";
import { addNightRunner, CARDS, nightRace, oldFrames, oldPayload, options, payloadFrom, send, toHex } from "./reread-fixtures";

/**
 * Steg 38: avsluta tävlingen. Varje avgjort resultat ska kunna fastställas; bara det som verkligen är oklart stoppar.
 * Natt-KM-banan (14 kontroller, start 18:47:56, mål 19:41:19 svensk tid). Alla namn är påhittade.
 */
useRaceDatabase();
const { classBlockers, decide, revisions } = statusFlow(db);
type Normalized = ReturnType<typeof normalizeCard>;

/** Brickans korrekta avläsning (natt-KM) för ett bricknummer, ändrad med `change`. */
function changedPayload(card: number, change: (value: Normalized) => Normalized = (value) => value) {
  return payloadFrom(change(normalizeCard(decodeRecordedFrames(oldFrames(card)), options)), oldFrames(card).map(toHex), false);
}
const without = (...codes: number[]) => (value: Normalized): Normalized =>
  ({ ...value, punches: value.punches.filter((punch) => !codes.includes(punch.code)) });
const noFinish = (value: Normalized): Normalized => { const { finishPunchedAt, ...rest } = value; void finishPunchedAt; return rest; };

async function reread(admin: Auth, entryId: string) {
  const preview = await previewReadoutRereadAsAdmin(db, { ...admin, request: { formatVersion: 1, entryId } });
  if (preview.status !== "ok") throw new Error(preview.status);
  const [item] = preview.response.items;
  const saved = await applyReadoutRereadAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
    items: [{ readoutId: item!.readoutId, entryId: item!.entryId, itemHash: item!.itemHash }] } });
  expect(saved.status).toBe("applied");
}

function markOfficial(admin: Auth) {
  const requestId = randomUUID();
  return setResultsOfficialAsAdmin(db, { ...admin, idempotencyKey: `results-official:${requestId}`,
    request: { formatVersion: 1, requestId, action: "OFFICIAL" } });
}

async function roster(admin: Auth) {
  const listed = await listEntryTransfersAsAdmin(db, admin);
  if (listed.status !== "ok") throw new Error(listed.status);
  return listed.response.entries;
}

async function adminXml(admin: Auth) {
  const exported = await exportIofResultListAsAdmin(db, { sessionToken: admin.sessionToken, raceId: admin.raceId });
  if (exported.status !== "ok") throw new Error(`IOF-exporten misslyckades: ${exported.status}`);
  return new TextDecoder().decode(exported.bytes);
}

/** Den officiella (fastställda) IOF-filen. */
async function officialXml(raceId: string) {
  const [race] = await db.select({ id: schema.races.officialResultFinalizationId }).from(schema.races).where(eq(schema.races.id, raceId));
  const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, race!.id!));
  return { xml: frozen!.completeXml!, projection: JSON.stringify(frozen!.frozenProjection) };
}

const publicRow = async (raceId: string, givenName: string) =>
  (await publicResults(db, raceId)).results.find((row) => row.givenName === givenName);
/** Resultatets tider före sträcktiderna (Time på Result-nivå, inte i SplitTime). */
const resultHead = (body: string) => body.split("<SplitTime")[0]!;
const splitCodes = (row: unknown) => ((row as { splits?: { controlCode: number }[] }).splits ?? []).map((split) => split.controlCode);

/**
 * IOF 3.0 XSD (IOF.xsd från IOF:s datastandard) med xmllint, som i tidigare steg. Schemat vendlas inte (licensen är
 * oklar, `packages/iof-xml/README.md`); ange sökvägen med IOF_XSD. Utan den görs bara de strukturella kontrollerna.
 */
function validateAgainstXsd(xml: string) {
  const xsd = process.env.IOF_XSD;
  if (!xsd || !existsSync(xsd)) return;
  const file = join(mkdtempSync(join(tmpdir(), "otid-iof-")), "result.xml");
  writeFileSync(file, xml);
  expect(() => execFileSync("xmllint", ["--noout", "--schema", xsd, file], { stdio: "pipe" })).not.toThrow();
}

describe("steg 38: avsluta tävlingen", () => {
  it("H12: omläsning, manuell tid (även ovanpå omläsning) och godkända kontroller stoppar inte Resultaten är klara", async () => {
    const ids = await nightRace("H12");
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [oldPayload(CARDS.ada), changedPayload(CARDS.bo, noFinish), changedPayload(CARDS.cia, without(35)),
      oldPayload(CARDS.dan)]);
    await reread(admin, ids.ada);
    expect(await decide(admin, ids.bo, { kind: "MANUAL_TIME", finishTime: "2026-10-20T19:45:00+02:00", status: "OK",
      note: "Glömde stämpla mål" })).toMatchObject({ status: "decided" });
    expect(await decide(admin, ids.cia, { kind: "APPROVE_CONTROLS", controls: [35], note: "Kontrollen var trasig" }))
      .toMatchObject({ status: "decided" });
    // Dan: manuell tid först (fel stämplingar från avläsningen), sedan omläsning – beslutet ligger kvar ovanpå.
    expect(await decide(admin, ids.dan, { kind: "MANUAL_TIME", finishTime: "2026-10-20T19:41:19+02:00", status: "OK",
      note: "Fel stämplingar" })).toMatchObject({ status: "decided" });
    await reread(admin, ids.dan);
    expect((await revisions(ids.dan)).map((row) => row.cause)).toEqual(["CARD_READOUT", "MANUAL_TIME", "READOUT_REREAD"]);
    expect(await decide(admin, ids.eva, { kind: "DID_NOT_START" })).toMatchObject({ status: "decided" });

    // Förut: "H12: Minst ett resultat eller en bana kan inte kontrolleras" (INVALID_RESULT_REVISION) för manuell tid
    // och godkända kontroller, som saknar avläsning på beslutets revision.
    expect(await classBlockers(admin)).toEqual([]);
    expect(await markOfficial(admin)).toMatchObject({ status: "saved", response: { result: { outcome: "OFFICIAL" } } });
    const { xml, projection } = await officialXml(ids.race);
    expect(projection).toContain('"cause":"MANUAL_TIME"');
    expect(projection).toContain('"cause":"MANUAL_CONTROL_APPROVAL"');
    for (const name of ["Ada", "Bo", "Cia", "Dan"]) expect(personResultBody(xml, name)).toContain("<Status>OK</Status>");
    validateAgainstXsd(xml);
  });

  it("det som verkligen är oklart stoppar och säger vem det gäller (löpare kvar i skogen)", async () => {
    const ids = await nightRace("H12");
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [changedPayload(CARDS.ada), changedPayload(CARDS.bo), changedPayload(CARDS.cia), changedPayload(CARDS.dan)]);
    expect(await markOfficial(admin)).toMatchObject({ status: "saved", response: { result: { outcome: "BLOCKED", classes: [{
      className: "H12", blockerCodes: ["MISSING_RESULT_REVISION"],
      entries: [{ entryId: ids.eva, displayName: "Eva Test", code: "MISSING_RESULT_REVISION" }] }] } } });
    expect(await decide(admin, ids.eva, { kind: "DID_NOT_FINISH" })).toMatchObject({ status: "decided" });
    expect(await markOfficial(admin)).toMatchObject({ status: "saved", response: { result: { outcome: "OFFICIAL" } } });
  });

  it("Bekräfta felstämplad: står kvar som felstämplad med sträcktider, är inte att titta på och överlever omräkning och ny avläsning", async () => {
    const ids = await nightRace("H12");
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [changedPayload(CARDS.ada, without(35)), changedPayload(CARDS.bo, without(36))]);
    const before = (await revisions(ids.ada)).at(-1)!;
    const requestId = randomUUID();
    expect(await decide(admin, ids.ada, { kind: "CONFIRM_MISPUNCH", note: "Missade 35, kontrollerat med löparen" }, { requestId }))
      .toMatchObject({ status: "decided", response: { cause: "MANUAL_MISPUNCH_CONFIRMATION", status: "MP" } });
    expect((await revisions(ids.ada)).at(-1)).toMatchObject({ readoutId: null, note: "Missade 35, kontrollerat med löparen",
      evaluation: before.evaluation });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toEqual([expect.objectContaining({ action: "MISPUNCH_CONFIRMED", actorId: admin.actorId })]);
    expect(await decide(admin, ids.ada, { kind: "CONFIRM_MISPUNCH" })).toMatchObject({ status: "conflict",
      readiness: "ACTIVE_MISPUNCH_CONFIRMATION" });

    const flags = async () => Object.fromEntries((await roster(admin)).filter((row) => row.id === ids.ada || row.id === ids.bo)
      .map((row) => [row.id === ids.ada ? "ada" : "bo", row.mispunchConfirmed ?? false]));
    expect(await flags()).toEqual({ ada: true, bo: false });
    const ada = await publicRow(ids.race, "Ada");
    expect(ada).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [35] });
    expect(splitCodes(ada)).toEqual([31, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 52, 43]);
    expect(await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada })).toMatchObject({ status: "ok",
      response: { governingDecision: "MP_CONFIRMED", decisionNote: "Missade 35, kontrollerat med löparen", result: { status: "MP" } } });

    // Ny avläsning av samma bricka och omräkning: bekräftelsen ligger kvar.
    await send(ids.race, [changedPayload(CARDS.ada, without(35))]);
    await recalculateEntry(db, ids.race, ids.ada);
    expect((await revisions(ids.ada)).map((row) => row.cause)).toEqual(["CARD_READOUT", "MANUAL_MISPUNCH_CONFIRMATION", "CARD_READOUT",
      "CLASS_CHANGE_RECALCULATION"]);
    expect(await flags()).toEqual({ ada: true, bo: false });

    // "Ta bort bekräftelsen": att titta på igen, utan omräkning.
    const withdrawId = randomUUID();
    expect(await decide(admin, ids.ada, { kind: "WITHDRAW" }, { requestId: withdrawId })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_MISPUNCH_CONFIRMATION_WITHDRAWAL", status: "MP" } });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, withdrawId)))
      .toEqual([expect.objectContaining({ action: "MISPUNCH_CONFIRMATION_WITHDRAWN" })]);
    expect(await flags()).toEqual({ ada: false, bo: false });
    // Obekräftade felstämplade stoppar inte Resultaten är klara.
    for (const name of ["cia", "dan", "eva"] as const) await decide(admin, ids[name], { kind: "DID_NOT_START" });
    expect(await markOfficial(admin)).toMatchObject({ status: "saved", response: { result: { outcome: "OFFICIAL" } } });
  });

  it("brutit, disk, utom tävlan och deltog utan tid behåller avläsningens sträcktider utan placering", async () => {
    const ids = await nightRace("H12");
    const admin = await raceAuth(db, ids.race);
    // Ada bröt efter 34 utan målstämpling; Bo bröt men stämplade mål; Cia sprang utom tävlan; Dan felstämplade och diskas
    // utan mål; Eva deltog utan tid.
    await send(ids.race, [changedPayload(CARDS.ada, (value) => noFinish(without(35, 36, 37, 38, 39, 40, 41, 42, 52, 43)(value))),
      changedPayload(CARDS.bo, without(38, 39, 40, 41, 42, 52, 43)), changedPayload(CARDS.cia),
      changedPayload(CARDS.dan, (value) => noFinish(without(40)(value))), changedPayload(CARDS.eva)]);
    for (const [name, kind] of [["ada", "DID_NOT_FINISH"], ["bo", "DID_NOT_FINISH"], ["cia", "OUT_OF_COMPETITION"],
      ["dan", "DISQUALIFIED"], ["eva", "WITHOUT_TIMING"]] as const) {
      expect(await decide(admin, ids[name], { kind })).toMatchObject({ status: "decided" });
    }
    const ada = await publicRow(ids.race, "Ada");
    expect(ada).toMatchObject({ status: "DNF", rankingState: "NOT_RANKABLE_STATUS" });
    expect(ada).not.toHaveProperty("elapsedMs");
    expect(ada).not.toHaveProperty("position");
    expect(splitCodes(ada)).toEqual([31, 32, 33, 34]);
    expect(splitCodes(await publicRow(ids.race, "Bo"))).toEqual([31, 32, 33, 34, 35, 36, 37]);
    expect(await publicRow(ids.race, "Cia")).toMatchObject({ status: "OOC", elapsedMs: 3_203_000 });
    expect(await publicRow(ids.race, "Cia")).not.toHaveProperty("position");
    expect(splitCodes(await publicRow(ids.race, "Dan"))).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 52, 43]);
    const eva = await publicRow(ids.race, "Eva");
    expect(eva).toMatchObject({ status: "NT" });
    expect(eva).not.toHaveProperty("elapsedMs");
    expect(splitCodes(eva)).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 52, 43]);
    // Deltagarkortet visar tiderna vid kontrollerna.
    const card = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada });
    expect(card).toMatchObject({ status: "ok", response: { governingDecision: "DNF", result: { status: "DNF" },
      controlDetails: { startTime: "2026-10-20T16:47:56.000Z", finishTime: null } } });
    if (card.status !== "ok" || card.response.state !== "ACTIVE_RESULT") throw new Error("Deltagarkortet saknar resultat");
    expect(card.response.controlDetails!.controls.filter((control) => control.elapsedMs !== null).map((control) => control.controlCode))
      .toEqual([31, 32, 33, 34]);

    // IOF-exporten: DidNotFinish med sträcktider fram till sista stämplade kontrollen, utan tid och placering.
    const xml = await adminXml(admin);
    const adaXml = personResultBody(xml, "Ada");
    expect(adaXml).toContain("<Status>DidNotFinish</Status>");
    expect(resultHead(adaXml)).not.toMatch(/<(Time|FinishTime|Position|TimeBehind)>/);
    expect(adaXml).toContain("<StartTime>2026-10-20T16:47:56.000Z</StartTime>");
    expect(adaXml.match(/<SplitTime status="OK">/g)).toHaveLength(4);
    expect(adaXml.match(/<SplitTime status="Missing">/g)).toHaveLength(10);
    const evaXml = personResultBody(xml, "Eva");
    expect(evaXml).toContain("<Status>NotCompeting</Status>");
    expect(resultHead(evaXml)).not.toMatch(/<(Time|FinishTime|Position)>/);
    expect(evaXml.match(/<SplitTime status="OK">/g)).toHaveLength(14);
    validateAgainstXsd(xml);
  });

  it("hela flödet för en klubbtävling: OK, MP (bekräftad och obekräftad), DNF med sträcktider, DNS, manuell tid, omläsning, NT och NC", async () => {
    const ids = await nightRace("H21");
    const admin = await raceAuth(db, ids.race);
    const more = { fia: 8_001_301, gus: 8_001_302, hed: 8_001_303, ivo: 8_001_304, jon: 8_001_305 };
    const extra = {} as Record<keyof typeof more, string>;
    for (const [name, card] of Object.entries(more) as [keyof typeof more, number][]) {
      extra[name] = await addNightRunner(ids, name[0]!.toUpperCase() + name.slice(1), card);
    }
    await send(ids.race, [
      oldPayload(CARDS.ada), // omläses till godkänd
      changedPayload(CARDS.bo, noFinish), // manuell tid
      changedPayload(CARDS.cia, without(35)), // felstämplad, bekräftad
      changedPayload(CARDS.dan, without(36)), // felstämplad, inte bekräftad
      changedPayload(CARDS.eva), // godkänd
      changedPayload(more.fia), // godkänd
      changedPayload(more.gus, (value) => noFinish(without(37, 38, 39, 40, 41, 42, 52, 43)(value))), // brutit
      changedPayload(more.ivo), // deltog utan tid
      changedPayload(more.jon) // utom tävlan (NC)
    ]);
    await reread(admin, ids.ada);
    await decide(admin, ids.bo, { kind: "MANUAL_TIME", finishTime: "2026-10-20T19:50:00+02:00", status: "OK", note: "Glömde stämpla mål" });
    await decide(admin, ids.cia, { kind: "CONFIRM_MISPUNCH" });
    await decide(admin, extra.gus, { kind: "DID_NOT_FINISH", note: "Skadad fot" });
    await decide(admin, extra.hed, { kind: "DID_NOT_START" });
    await decide(admin, extra.ivo, { kind: "WITHOUT_TIMING" });
    await decide(admin, extra.jon, { kind: "OUT_OF_COMPETITION" });

    const unconfirmed = (await roster(admin)).filter((row) => row.effectiveResult.state === "ACTIVE_RESULT" &&
      row.effectiveResult.result.status === "MP" && !row.mispunchConfirmed);
    expect(unconfirmed.map((row) => row.displayName)).toEqual(["Dan Test"]);
    expect(await classBlockers(admin)).toEqual([]);
    expect(await markOfficial(admin)).toMatchObject({ status: "saved", response: { result: { outcome: "OFFICIAL" } } });
    expect((await publicResults(db, ids.race)) as { standing?: unknown }).toMatchObject({ standing: { kind: "OFFICIAL" } });

    const { xml } = await officialXml(ids.race);
    const status = (name: string) => personResultBody(xml, name).match(/<Status>(\w+)<\/Status>/)![1];
    expect(Object.fromEntries(["Ada", "Bo", "Cia", "Dan", "Eva", "Fia", "Gus", "Hed", "Ivo", "Jon"].map((name) => [name, status(name)])))
      .toEqual({ Ada: "OK", Bo: "OK", Cia: "MissingPunch", Dan: "MissingPunch", Eva: "OK", Fia: "OK", Gus: "DidNotFinish",
        Hed: "DidNotStart", Ivo: "NotCompeting", Jon: "NotCompeting" });
    // Placering bara för godkända; brutit har sträcktider fram till sista stämplade kontrollen men ingen tid.
    expect(personResultBody(xml, "Ada")).toContain("<Position>");
    expect(personResultBody(xml, "Bo")).toContain("<Time>3724</Time>");
    expect(resultHead(personResultBody(xml, "Gus"))).not.toMatch(/<(Time|Position)>/);
    expect(personResultBody(xml, "Gus").match(/<SplitTime status="OK">/g)).toHaveLength(6);
    expect(personResultBody(xml, "Jon")).toContain("<Time>3203</Time>");
    expect(personResultBody(xml, "Jon")).not.toContain("<Position>");
    expect(personResultBody(xml, "Hed")).not.toContain("<SplitTime");
    validateAgainstXsd(xml);
  }, 30_000);
});
