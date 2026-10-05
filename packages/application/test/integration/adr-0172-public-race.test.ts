import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { performSuperadminAction, setSuperadmin } from "../../src/superadmin";
import { isRacePubliclyVisible, publicRaceAccess } from "../../src/public-race-visibility";
import { listPublicRaces, raceIdForShortCode, readPublicRaceHub } from "../../src/public-races";
import { setRacePublicationAsAdministrator } from "../../src/race-publication";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { grantRacePerson, registerTestAccount, setRacePublished } from "./accounts";

/**
 * ADR-0172 beslut 4 / PLAN.md steg 19: en ny tävling är dold tills admin publicerar den. Synlig = publicerad och
 * inte dold av superadmin; ägare, administratörer och funktionärer förhandsvisar. Kort adress per tävling,
 * startsidans avsnitt efter dagens datum i tävlingens tidszon och sök på namn.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet av den publika ytan kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0172_public_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0172_public_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const suffix = () => randomUUID().slice(0, 8);
type Proof = { sessionToken: string; csrfCookie: string; csrfHeader: string };

async function createRace(proof: Proof, eventName: string, raceDate = "2026-10-08", timeZone = "Europe/Stockholm") {
  const created = await createEventAsUserAccount(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName, raceName: "Torsdag", raceDate, timeZone }) });
  if (created.status !== "created") throw new Error(`Tävlingen kunde inte skapas: ${created.status}`);
  return created.response.raceId;
}

describe("ADR-0172 publicerad tävling", () => {
  it("är dold tills admin publicerar, förhandsvisas av egna och döljs av superadmin", async () => {
    const owner = await registerTestAccount(db, `agare.${suffix()}`);
    const functionary = await registerTestAccount(db, `funk.${suffix()}`);
    const stranger = await registerTestAccount(db, `annan.${suffix()}`);
    const raceId = await createRace(owner.proof, `Opublicerad ${suffix()}`);
    expect((await grantRacePerson(db, owner.proof, raceId, functionary.email, "FUNCTIONARY")).status).toBe("granted");

    // Ny tävling: syns inte för besökare, men ägaren och funktionären förhandsvisar.
    expect(await isRacePubliclyVisible(db, raceId)).toBe(false);
    expect(await publicRaceAccess(db, raceId, null)).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, stranger.proof.sessionToken)).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, "otid_user_session_v1.fel")).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, owner.proof.sessionToken)).toBe("PREVIEW");
    expect(await publicRaceAccess(db, raceId, functionary.proof.sessionToken)).toBe("PREVIEW");
    expect(await publicRaceAccess(db, randomUUID(), owner.proof.sessionToken)).toBe("NONE");
    expect(await publicRaceAccess(db, "inte-ett-id", null)).toBe("NONE");

    // Funktionären får inte publicera.
    const enteredAsFunctionary = await enterRaceAsUserAccount(db, { ...functionary.proof, raceId });
    if (enteredAsFunctionary.status !== "entered") throw new Error("Funktionären kom inte in");
    expect(await setRacePublicationAsAdministrator(db, { sessionToken: enteredAsFunctionary.sessionToken,
      csrfCookie: enteredAsFunctionary.csrfToken, csrfHeader: enteredAsFunctionary.csrfToken, raceId, published: true }))
      .toEqual({ status: "forbidden" });

    // Publicera: alla ser tävlingen. Att publicera igen behåller tidpunkten.
    const publishedAt = new Date();
    const published = await setRacePublished(db, owner.proof, raceId, true, publishedAt);
    expect(published).toMatchObject({ status: "saved", response: { raceId,
      publication: { publishedAt: publishedAt.toISOString(), hiddenBySuperadmin: false } } });
    expect((await setRacePublished(db, owner.proof, raceId, true, new Date(publishedAt.getTime() + 60_000))))
      .toMatchObject({ response: { publication: { publishedAt: publishedAt.toISOString() } } });
    expect(await publicRaceAccess(db, raceId, null)).toBe("PUBLIC");
    expect(await isRacePubliclyVisible(db, raceId)).toBe(true);

    // Arbetsytan ser publiceringen och den korta adressen.
    const entered = await enterRaceAsUserAccount(db, { ...owner.proof, raceId });
    if (entered.status !== "entered") throw new Error("Ägaren kom inte in");
    const workspace = await listEntryTransfersAsAdministrator(db, { sessionToken: entered.sessionToken, raceId });
    expect(workspace.status === "ok" && workspace.response.publication).toMatchObject({ publishedAt: publishedAt.toISOString() });

    // Dold av superadmin: syns inte, inte ens som förhandsvisning.
    const boss = await registerTestAccount(db, `super.${suffix()}`);
    expect(await setSuperadmin(db, { email: boss.email, superadmin: true })).toMatchObject({ status: "changed" });
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "HIDE_RACE", raceId, reason: "Test" }))
      .toEqual({ status: "done", action: "HIDE_RACE" });
    expect(await publicRaceAccess(db, raceId, null)).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, owner.proof.sessionToken)).toBe("NONE");
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "UNHIDE_RACE", raceId, reason: "Test" }))
      .toEqual({ status: "done", action: "UNHIDE_RACE" });

    // Sluta publicera: dold igen, och båda ändringarna loggas.
    expect(await setRacePublished(db, owner.proof, raceId, false)).toMatchObject({ response: { publication: { publishedAt: null } } });
    expect(await publicRaceAccess(db, raceId, null)).toBe("NONE");
    const audit = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents)
      .where(eq(schema.auditEvents.raceId, raceId));
    expect(audit.map(row => row.action).filter(action => action.startsWith("RACE_")))
      .toEqual(expect.arrayContaining(["RACE_PUBLISHED_BY_ADMIN", "RACE_UNPUBLISHED_BY_ADMIN"]));
    expect(audit.filter(row => row.action === "RACE_PUBLISHED_BY_ADMIN")).toHaveLength(1);
  });

  it("ger varje tävling en unik kort adress som går att slå upp", async () => {
    const owner = await registerTestAccount(db, `kod.${suffix()}`);
    const first = await createRace(owner.proof, `Kort adress ${suffix()}`);
    const second = await createRace(owner.proof, `Kort adress ${suffix()}`);
    const codes = await db.select({ id: schema.races.id, shortCode: schema.races.shortCode }).from(schema.races);
    const firstCode = codes.find(row => row.id === first)!.shortCode;
    const secondCode = codes.find(row => row.id === second)!.shortCode;
    expect(firstCode).toMatch(/^[2-9a-hjkmnp-z]{6}$/);
    expect(new Set(codes.map(row => row.shortCode)).size).toBe(codes.length);
    expect(await raceIdForShortCode(db, firstCode)).toBe(first);
    expect(await raceIdForShortCode(db, ` ${firstCode.toUpperCase()} `)).toBe(first);
    expect(await raceIdForShortCode(db, "zzzzzz") === first).toBe(false);
    for (const bad of ["", "abc", "abcdefg", "abc0de", "../x", "abcdeI"]) expect(await raceIdForShortCode(db, bad)).toBeUndefined();
    // Databasen tillåter inte två tävlingar med samma adress eller tecken utanför alfabetet.
    await expect(db.update(schema.races).set({ shortCode: firstCode }).where(eq(schema.races.id, second))).rejects.toThrow();
    await expect(db.update(schema.races).set({ shortCode: "abcde1" }).where(eq(schema.races.id, second))).rejects.toThrow();
    expect(await raceIdForShortCode(db, secondCode)).toBe(second);
  });

  it("delar startsidan i pågår nu, kommande och senaste efter tävlingens tidszon, med sök", async () => {
    const owner = await registerTestAccount(db, `lista.${suffix()}`);
    const tag = `Lista${suffix()}`;
    // 23:30 UTC är redan nästa dag i Stockholm men samma dag i New York.
    const now = new Date("2026-10-05T23:30:00Z");
    const races = {
      stockholmToday: await createRace(owner.proof, `${tag} Stockholm i dag`, "2026-10-06"),
      newYorkToday: await createRace(owner.proof, `${tag} New York i dag`, "2026-10-05", "America/New_York"),
      newYorkTomorrow: await createRace(owner.proof, `${tag} New York i morgon`, "2026-10-06", "America/New_York"),
      stockholmYesterday: await createRace(owner.proof, `${tag} Stockholm i går`, "2026-10-05"),
      older: await createRace(owner.proof, `${tag} Äldre 100%_klart`, "2026-09-01"),
      unpublished: await createRace(owner.proof, `${tag} Opublicerad`, "2026-10-06")
    };
    for (const [name, raceId] of Object.entries(races)) {
      if (name !== "unpublished") expect((await setRacePublished(db, owner.proof, raceId)).status).toBe("saved");
    }
    const listing = await listPublicRaces(db, { search: tag }, now);
    const ids = (rows: { raceId: string }[]) => rows.map(row => row.raceId);
    expect(ids(listing.ongoing).sort()).toEqual([races.stockholmToday, races.newYorkToday].sort());
    expect(ids(listing.upcoming)).toEqual([races.newYorkTomorrow]);
    expect(ids(listing.recent)).toEqual([races.stockholmYesterday, races.older]);
    expect(listing.moreRecent).toBe(false);
    expect(listing.ongoing[0]).toMatchObject({ raceType: "STANDARD", startListPublished: false });
    expect(listing.ongoing[0]?.shortCode).toMatch(/^[2-9a-hjkmnp-z]{6}$/);

    // "Visa fler": begränsat antal senaste.
    const limited = await listPublicRaces(db, { search: tag, recentLimit: 1 }, now);
    expect(ids(limited.recent)).toEqual([races.stockholmYesterday]);
    expect(limited.moreRecent).toBe(true);

    // Sök utan hänsyn till versaler, på eventets och loppets namn; % och _ är vanliga tecken.
    const york = await listPublicRaces(db, { search: `${tag.toUpperCase()} new york` }, now);
    expect([...ids(york.ongoing), ...ids(york.upcoming), ...ids(york.recent)].sort())
      .toEqual([races.newYorkToday, races.newYorkTomorrow].sort());
    const percent = await listPublicRaces(db, { search: "100%_klart" }, now);
    expect(ids(percent.recent)).toEqual([races.older]);
    const wildcard = await listPublicRaces(db, { search: `${tag}%` }, now);
    expect([...wildcard.ongoing, ...wildcard.upcoming, ...wildcard.recent]).toHaveLength(0);
    const byRace = await listPublicRaces(db, { search: "torsdag" }, now);
    expect(ids(byRace.ongoing)).toContain(races.stockholmToday);
    expect([...ids(byRace.ongoing), ...ids(byRace.upcoming)]).not.toContain(races.unpublished);

    // Tävlingssidan: namn, typ och senaste ändring (publiceringen när inget annat finns).
    const hub = await readPublicRaceHub(db, races.older);
    expect(hub).toMatchObject({ raceId: races.older, eventName: `${tag} Äldre 100%_klart`, raceName: "Torsdag", raceDate: "2026-09-01",
      raceType: "STANDARD", timeZone: "Europe/Stockholm", startListPublished: false, hasResults: false });
    expect(hub?.lastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await readPublicRaceHub(db, randomUUID())).toBeUndefined();
  });
});
