import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { createEvent, importIofXmlAsAdmin } from "../../src";
import { db, useRaceDatabase } from "./race-fixtures";
import { raceLogin } from "./accounts";

useRaceDatabase();

const demoEntryXml = await readFile(new URL("../../../../fixtures/iof/demo-entry-list.xml", import.meta.url), "utf8");
const usedAt = new Date("2026-11-12T10:00:00.000Z");

/** Användartestet 2026-11-12: klasser skapade i arbetsytan (Ny bana med klassnamn), utan IOF-identitet. */
async function raceWithHandClasses(names: readonly string[]) {
  const { race } = await createEvent(db, { name: `Handklasser ${crypto.randomUUID()}`, raceName: "Individuellt",
    raceDate: "2026-11-12", timeZone: "Europe/Stockholm" });
  for (const name of names) {
    const [course] = await db.insert(schema.courses).values({ raceId: race.id, name: `Bana ${name}` }).returning();
    const [version] = await db.insert(schema.courseVersions).values({ courseId: course!.id, version: 1 }).returning();
    await db.insert(schema.classes).values({ raceId: race.id, name, courseVersionId: version!.id, startRule: "PUNCH" });
  }
  return race.id;
}

async function importAs(raceId: string, xml: string) {
  const login = await raceLogin(db, raceId, "ADMIN", new Date("2026-11-12T09:59:00.000Z"));
  if (login.status !== "authenticated") throw new Error("Inloggning saknas");
  return importIofXmlAsAdmin(db, { sessionToken: login.sessionToken, raceId, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken,
    idempotencyKey: `iof-import:${crypto.randomUUID()}`, xmlBytes: Buffer.from(xml, "utf8") }, usedAt);
}

describe("import av anmälningar och startlista till klasser skapade för hand (användartestet 2026-11-12)", () => {
  it("matchar demo-entry-list.xml på klassnamn och låter klasserna förbli handskapade", async () => {
    // Skiftläge och blanksteg spelar ingen roll, som i Eventor-hämtningen.
    const raceId = await raceWithHandClasses(["h21 ", "D21"]);
    await expect(importAs(raceId, demoEntryXml)).resolves.toMatchObject({ status: "stored",
      response: { report: { kind: "EntryList", imported: { entries: 2 } } } });
    const classes = await db.select().from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name));
    expect(classes.map(row => ({ name: row.name, externalSource: row.externalSource, externalId: row.externalId })))
      .toEqual([{ name: "D21", externalSource: null, externalId: null }, { name: "h21 ", externalSource: null, externalId: null }]);
    const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.givenName));
    const classOf = new Map(classes.map(row => [row.id, row.name]));
    expect(entries.map(entry => [entry.givenName, classOf.get(entry.classId)])).toEqual([["Ada", "h21 "], ["Bo", "D21"]]);

    // En startlista med samma klasser hittar dem också på namnet.
    const startList = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"><Event><Name>Test</Name></Event>` +
      `<ClassStart><Class><Id>class-h21</Id><Name>H21</Name></Class><PersonStart><EntryId>demo-entry-ada</EntryId><Start>` +
      `<StartTime>2026-11-12T10:00:00Z</StartTime></Start></PersonStart></ClassStart></StartList>`;
    await expect(importAs(raceId, startList)).resolves.toMatchObject({ status: "stored",
      response: { report: { kind: "StartList", imported: { classes: 1, entries: 1 } } } });
    const [ada] = await db.select().from(schema.entries).where(eq(schema.entries.externalId, "demo-entry-ada"));
    expect(ada?.fixedStartTime?.toISOString()).toBe("2026-11-12T10:00:00.000Z");
  });

  it("avvisar listan med vilka klasser som saknas, utan att spara något", async () => {
    const raceId = await raceWithHandClasses(["H21"]);
    await expect(importAs(raceId, demoEntryXml)).resolves.toEqual({ status: "classes-missing",
      issues: ["Klassen D21 finns inte i tävlingen. Skapa klasserna under Klasser eller läs in banfilen först."] });
    const empty = await raceWithHandClasses([]);
    await expect(importAs(empty, demoEntryXml)).resolves.toEqual({ status: "classes-missing",
      issues: ["Klasserna H21 och D21 finns inte i tävlingen. Skapa klasserna under Klasser eller läs in banfilen först."] });
    expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId))).toEqual([]);
    expect(await db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId))).toEqual([]);
  });
});
