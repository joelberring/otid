import { describe, expect, it } from "vitest";
import { importIofXmlAsAdmin, ingestDeviceBatch } from "../../src";
import { batch, courseXml, db, entryXml, importedRace, okPayload, pool, useRaceDatabase } from "./race-fixtures";
import { raceLogin } from "./accounts";

/**
 * Översynen 2026-11-02, punkt 2 och 5: direkt import av banor och anmälningar efter avläsning. Banfilen går samma väg som
 * "Läs in ny banfil" (behåll varianten, räkna om), eller avvisas med hänvisning till banfilsjämförelsen när resultat ändras.
 * Anmälningslistan visar vem och vad som skiljer i stället för ett tomt 409, och brickbyten görs efter bekräftelse.
 */
useRaceDatabase();
const now = new Date("2026-08-30T12:00:00Z");

async function input(raceId: string, xml: string, confirmChanges = false) {
  const login = await raceLogin(db, raceId, "ADMIN", now);
  return { sessionToken: login.sessionToken, raceId, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken,
    idempotencyKey: `iof-import:${crypto.randomUUID()}`, xmlBytes: Buffer.from(xml, "utf8"), confirmChanges };
}

async function readOut(raceId: string, payload: typeof okPayload) {
  const deviceId = crypto.randomUUID();
  const ack = await ingestDeviceBatch(db, raceId, batch(deviceId, payload, { packageVersion: 1 }));
  expect(ack.acknowledgements[0]?.status).toBe("stored");
}

async function entryId(raceId: string, givenName: string) {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM entry WHERE race_id=$1 AND given_name=$2", [raceId, givenName]);
  return rows[0]!.id;
}

async function activeCards(raceId: string) {
  const { rows } = await pool.query<{ given_name: string; card_number: string }>(`SELECT e.given_name, c.card_number FROM card_assignment c
    JOIN entry e ON e.id = c.entry_id WHERE c.race_id=$1 AND c.active ORDER BY e.given_name`, [raceId]);
  return rows.map((row) => [row.given_name, row.card_number]);
}

/** Korta med andra kontroller (H21 springer Korta). */
function courseWith(controls: readonly number[]) {
  const start = courseXml.indexOf("<Name>Korta</Name>");
  const end = courseXml.indexOf("</Course>", start);
  const body = controls.map((code) => `<CourseControl type="Control"><Control>${code}</Control></CourseControl>`).join("");
  return courseXml.slice(0, start) + `<Name>Korta</Name><CourseControl type="Start"><Control>S</Control></CourseControl>${body}` +
    "<CourseControl type=\"Finish\"><Control>F</Control></CourseControl>" + courseXml.slice(end);
}

describe("direkt import efter avläsning (översynen 2026-11-02)", () => {
  it("CourseData efter avläsning: ny banversion och omräkning i samma transaktion, inga blandade banversioner", async () => {
    const { raceId } = await importedRace();
    await readOut(raceId, okPayload);
    const ada = await entryId(raceId, "Ada");
    const imported = await importIofXmlAsAdmin(db, await input(raceId, courseWith([31, 32])), now);
    if (imported.status !== "stored") throw new Error(JSON.stringify(imported));
    expect(imported.response.report.warnings).toContain("1 resultat räknades om mot de nya banorna");
    const { rows } = await pool.query<{ class_version: string; result_version: string; status: string }>(`SELECT k.course_version_id AS class_version,
      r.course_version_id AS result_version, r.status FROM entry e JOIN class k ON k.id = e.class_id
      JOIN LATERAL (SELECT * FROM result_revision WHERE entry_id = e.id ORDER BY revision DESC LIMIT 1) r ON true WHERE e.id=$1`, [ada]);
    expect(rows[0]).toMatchObject({ status: "OK" });
    expect(rows[0]!.result_version).toBe(rows[0]!.class_version);
  });

  it("CourseData som ändrar ett resultat avvisas och hänvisar till banfilsjämförelsen; inget sparas", async () => {
    const { raceId } = await importedRace();
    await readOut(raceId, okPayload);
    const before = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM course_version cv JOIN course c ON c.id = cv.course_id WHERE c.race_id=$1",
      [raceId])).rows[0];
    const refused = await importIofXmlAsAdmin(db, await input(raceId, courseWith([31, 32, 34])), now);
    expect(refused.status).toBe("course-file-sync-required");
    if (refused.status !== "course-file-sync-required") return;
    expect(refused.issues[0]).toContain("Läs in ny banfil");
    expect(refused.issues.join(" ")).toContain("Ada Löpare (H21): godkänd → felstämplad");
    expect((await pool.query("SELECT count(*)::int AS n FROM course_version cv JOIN course c ON c.id = cv.course_id WHERE c.race_id=$1",
      [raceId])).rows[0]).toEqual(before);
  });

  it("EntryList med brickbyte: visar vem och vad, sparar efter bekräftelse och kopplar en avläsning som redan fanns", async () => {
    const { raceId } = await importedRace();
    // Ada springer med en annan bricka än den anmälda och läses ut som okänd.
    await readOut(raceId, { ...okPayload, cardNumber: "2001848" });
    const changed = entryXml.replace(">12345<", ">2001848<");
    const unconfirmed = await importIofXmlAsAdmin(db, await input(raceId, changed), now);
    expect(unconfirmed).toEqual({ status: "entry-list-changes", changes: [{ name: "Ada Löpare", className: "H21",
      field: "CARD", from: "12345", to: "2001848", readOut: false, blocking: false }] });
    expect(await activeCards(raceId)).toEqual([["Ada", "12345"], ["Bo", "67890"]]);
    const confirmed = await importIofXmlAsAdmin(db, await input(raceId, changed, true), now);
    if (confirmed.status !== "stored") throw new Error(JSON.stringify(confirmed));
    expect(confirmed.response.report.warnings).toContain("1 brickbyten sparades");
    expect(confirmed.response.report.warnings).toContain("1 avläsningar som redan fanns kopplades och räknades");
    expect(await activeCards(raceId)).toEqual([["Ada", "2001848"], ["Bo", "67890"]]);
    const { rows } = await pool.query<{ status: string }>("SELECT status FROM result_revision WHERE entry_id=$1 ORDER BY revision DESC LIMIT 1",
      [await entryId(raceId, "Ada")]);
    expect(rows[0]?.status).toBe("OK");
  });

  it("EntryList där två löpare bytt brickor med varandra går att bekräfta", async () => {
    const { raceId } = await importedRace();
    const swapped = entryXml.replace(">12345<", ">TMP<").replace(">67890<", ">12345<").replace(">TMP<", ">67890<");
    const result = await importIofXmlAsAdmin(db, await input(raceId, swapped), now);
    expect(result.status === "entry-list-changes" && result.changes.map((row) => [row.name, row.to, row.blocking]))
      .toEqual([["Ada Löpare", "67890", false], ["Bo Skog", "12345", false]]);
    expect((await importIofXmlAsAdmin(db, await input(raceId, swapped, true), now)).status).toBe("stored");
    expect(await activeCards(raceId)).toEqual([["Ada", "67890"], ["Bo", "12345"]]);
  });

  it("krockar avvisas med vem det gäller: bricka som en annan har kvar, ny klass för den som läst ut", async () => {
    const { raceId } = await importedRace();
    const taken = await importIofXmlAsAdmin(db, await input(raceId, entryXml.replace(">12345<", ">67890<"), true), now);
    expect(taken).toMatchObject({ status: "conflict", changes: [{ name: "Ada Löpare", field: "CARD",
      to: "67890", blocking: true, note: "Brickan används av Bo Skog. Byt bricka för den löparen först." }] });
    await readOut(raceId, okPayload);
    const moved = entryXml.replace("<Class><Id>class-h21</Id><Name>H21</Name></Class>", "<Class><Id>class-d21</Id><Name>D21</Name></Class>");
    const result = await importIofXmlAsAdmin(db, await input(raceId, moved, true), now);
    expect(result).toMatchObject({ status: "conflict", changes: [{ name: "Ada Löpare", field: "CLASS",
      from: "H21", to: "D21", readOut: true, blocking: true }] });
    expect(await activeCards(raceId)).toEqual([["Ada", "12345"], ["Bo", "67890"]]);
  });
});
