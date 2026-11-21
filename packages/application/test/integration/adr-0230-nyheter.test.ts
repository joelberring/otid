import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub } from "../../src/clubs";
import {
  deleteClubNews, deleteNewsAsSuperadmin, listClubNews, listHomeNews, listNewsAsSuperadmin, readNewsImage, saveClubNews, saveNewsAsSuperadmin
} from "../../src/news";
import { setSuperadmin } from "../../src/superadmin";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0230: nyhetsflödet mot PostgreSQL – superadmin skriver allmänna nyheter, klubbens ledare (inte medlemmar) klubbens; vem
 * som ser vad på startsidan (utloggad, medlem, annan klubb), dolda nyheter, 60-dagarsregeln, bilden, länkarna och modereringen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0230_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-21T12:00:00Z");
const LATER = new Date("2026-11-21T13:00:00Z");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0230_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const request = (title: string, extra: Record<string, unknown> = {}) => ({ formatVersion: 1, requestId: randomUUID(), title, body: `${title} i korthet`,
  link: "", ...extra });

async function clubWith(name: string) {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name } }, NOW);
  if (created.status !== "created") throw new Error(`Klubben skapades inte: ${created.status}`);
  const clubId = created.club.clubId;
  const member = async (role: "LEADER" | "READER") => {
    const account = await registerTestAccount(db, undefined, NOW);
    await db.insert(schema.clubMembers).values({ id: randomUUID(), clubId, accountId: account.accountId, role, addedAt: NOW, addedBy: owner.accountId,
      requestId: randomUUID() });
    return account;
  };
  return { clubId, owner, leader: await member("LEADER"), reader: await member("READER") };
}

describe("ADR-0230 nyheter", () => {
  it("allmänt, klubb, utloggad, annan klubb, dolda, moderering och bilden", async () => {
    const boss = await registerTestAccount(db, undefined, NOW);
    expect(await setSuperadmin(db, { email: boss.email, superadmin: true })).toMatchObject({ status: "changed" });
    const okaa = await clubWith("OK Älvsjö-Örby");
    const centrum = await clubWith("Centrum OK");
    const stranger = await registerTestAccount(db, undefined, NOW);

    // Bara superadmin skriver allmänna nyheter.
    expect(await saveNewsAsSuperadmin(db, { ...stranger.proof, request: request("Inte min") }, NOW)).toEqual({ status: "forbidden" });
    expect(await saveNewsAsSuperadmin(db, { sessionToken: null, request: request("Utan konto") }, NOW)).toEqual({ status: "unauthorized" });
    const generalRequest = request("Egen meny för tävlingsdagen", { link: "/om", image: { mediaType: "image/png", base64: PNG, width: 1, height: 1 } });
    const general = await saveNewsAsSuperadmin(db, { ...boss.proof, request: generalRequest }, NOW);
    expect(general).toMatchObject({ status: "saved", created: true, item: { clubId: null, title: "Egen meny för tävlingsdagen", link: "/om" } });
    if (general.status !== "saved") throw new Error("Ingen nyhet");
    expect(general.item.imageUrl).toMatch(new RegExp(`^/api/public/news/${general.item.newsId}/image\\?v=[0-9a-f]{16}$`));
    // Samma requestId igen ger samma nyhet (idempotent).
    expect(await saveNewsAsSuperadmin(db, { ...boss.proof, request: generalRequest }, NOW)).toMatchObject({ status: "saved", created: false,
      item: { newsId: general.item.newsId } });

    // Länkar och bilder som inte godtas.
    for (const bad of [request("Fel länk", { link: "javascript:alert(1)" }), request("Fel länk", { link: "//evil.example" }),
      request("Fel bild", { image: { mediaType: "image/jpeg", base64: PNG, width: 1, height: 1 } }),
      request("Fel mått", { image: { mediaType: "image/png", base64: PNG, width: 2, height: 1 } }), request("")]) {
      expect(await saveNewsAsSuperadmin(db, { ...boss.proof, request: bad }, NOW)).toEqual({ status: "invalid-request" });
    }

    // Klubbens ledare skriver; en medlem och en utomstående får inte.
    expect(await saveClubNews(db, { ...okaa.reader.proof, clubId: okaa.clubId, request: request("Medlem") }, NOW)).toEqual({ status: "forbidden" });
    expect(await saveClubNews(db, { ...stranger.proof, clubId: okaa.clubId, request: request("Främling") }, NOW)).toEqual({ status: "not-found" });
    const club = await saveClubNews(db, { ...okaa.leader.proof, clubId: okaa.clubId, request: request("Natt-KM på torsdag", { link: "https://okaa.se/natt" }) }, LATER);
    expect(club).toMatchObject({ status: "saved", item: { clubId: okaa.clubId, clubName: "OK Älvsjö-Örby", link: "https://okaa.se/natt" } });
    if (club.status !== "saved") throw new Error("Ingen klubbnyhet");
    const hidden = await saveClubNews(db, { ...okaa.owner.proof, clubId: okaa.clubId, request: request("Utkast", { hidden: true }) }, LATER);
    expect(hidden).toMatchObject({ status: "saved", item: { hidden: true } });

    // Startsidan: utloggad bara allmänt; medlemmen i datumordning med klubbens; annan klubb inte; dolda aldrig.
    const titles = async (token: string | null) => (await listHomeNews(db, token, LATER)).map(item => item.title);
    expect(await titles(null)).toEqual(["Egen meny för tävlingsdagen"]);
    expect(await titles(okaa.reader.proof.sessionToken)).toEqual(["Natt-KM på torsdag", "Egen meny för tävlingsdagen"]);
    expect(await titles(centrum.leader.proof.sessionToken)).toEqual(["Egen meny för tävlingsdagen"]);
    expect(await titles(stranger.proof.sessionToken)).toEqual(["Egen meny för tävlingsdagen"]);
    expect(await titles("ogiltig-session")).toEqual(["Egen meny för tävlingsdagen"]);

    // Klubbytan: medlemmen ser de synliga, ledaren också den dolda; en annan klubbs ledare inte alls.
    expect((await listClubNews(db, { ...okaa.reader.proof, clubId: okaa.clubId }, LATER))).toMatchObject({ status: "ok",
      response: { canWrite: false, items: [{ title: "Natt-KM på torsdag" }] } });
    const leaderList = await listClubNews(db, { ...okaa.leader.proof, clubId: okaa.clubId }, LATER);
    expect(leaderList.status === "ok" && leaderList.response.canWrite && leaderList.response.items.map(item => item.title).sort())
      .toEqual(["Natt-KM på torsdag", "Utkast"]);
    expect(await listClubNews(db, { ...centrum.leader.proof, clubId: okaa.clubId }, LATER)).toEqual({ status: "not-found" });
    // En annan klubbs ledare kan inte ändra eller ta bort klubbens nyhet, inte ens via sin egen klubb.
    expect(await saveClubNews(db, { ...centrum.leader.proof, clubId: centrum.clubId, newsId: club.item.newsId, request: request("Kapat") }, LATER))
      .toEqual({ status: "not-found" });
    expect(await deleteClubNews(db, { ...centrum.leader.proof, clubId: centrum.clubId, newsId: club.item.newsId }, LATER)).toEqual({ status: "not-found" });

    // Bilden: den allmänna för alla (delad cache), inte för en dold.
    expect(await readNewsImage(db, general.item.newsId, null, LATER)).toMatchObject({ mediaType: "image/png", shared: true });
    const withImage = await saveClubNews(db, { ...okaa.leader.proof, clubId: okaa.clubId, request: request("Bild", {
      image: { mediaType: "image/png", base64: PNG, width: 1, height: 1 } }) }, LATER);
    if (withImage.status !== "saved") throw new Error("Ingen bild");
    expect(await readNewsImage(db, withImage.item.newsId, null, LATER)).toBeUndefined();
    expect(await readNewsImage(db, withImage.item.newsId, centrum.leader.proof.sessionToken, LATER)).toBeUndefined();
    expect(await readNewsImage(db, withImage.item.newsId, okaa.reader.proof.sessionToken, LATER)).toMatchObject({ shared: false });

    // Ändra: bilden behålls när den inte skickas, tas bort med null; dölj och visa.
    const edited = await saveNewsAsSuperadmin(db, { ...boss.proof, newsId: general.item.newsId, request: request("Egen meny i mobilen", { link: "/om" }) }, LATER);
    expect(edited).toMatchObject({ status: "saved", item: { title: "Egen meny i mobilen", imageUrl: general.item.imageUrl } });
    expect(await saveNewsAsSuperadmin(db, { ...boss.proof, newsId: general.item.newsId, request: request("Egen meny i mobilen", { image: null, hidden: true }) }, LATER))
      .toMatchObject({ status: "saved", item: { imageUrl: null, hidden: true } });
    expect(await titles(null)).toEqual([]);
    expect(await readNewsImage(db, general.item.newsId, null, LATER)).toBeUndefined();

    // Moderering: superadmin ser allt och tar bort klubbens nyhet; medlemmen ser den inte längre.
    const all = await listNewsAsSuperadmin(db, boss.proof, LATER);
    expect(all.status === "ok" && all.response.items.length).toBe(4);
    expect(await listNewsAsSuperadmin(db, okaa.leader.proof, LATER)).toEqual({ status: "forbidden" });
    expect(await deleteNewsAsSuperadmin(db, { ...boss.proof, newsId: club.item.newsId }, LATER)).toEqual({ status: "removed" });
    expect(await titles(okaa.reader.proof.sessionToken)).toEqual(["Bild"]);
    expect(await deleteClubNews(db, { ...okaa.reader.proof, clubId: okaa.clubId, newsId: withImage.item.newsId }, LATER)).toEqual({ status: "forbidden" });
    expect(await deleteClubNews(db, { ...okaa.leader.proof, clubId: okaa.clubId, newsId: withImage.item.newsId }, LATER)).toEqual({ status: "removed" });
    expect(await deleteNewsAsSuperadmin(db, { ...boss.proof, newsId: randomUUID() }, LATER)).toEqual({ status: "not-found" });

    // 60-dagarsregeln: om två månader är spalten tom, också för medlemmen.
    expect(await listHomeNews(db, okaa.reader.proof.sessionToken, new Date("2027-01-25T12:00:00Z"))).toEqual([]);
  });
});
