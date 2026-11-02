import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { maskPublicNames } from "@o-tid/domain";
import { publicResults } from "../../src/results";
import { requireRaceRole } from "../../src/race-session";
import { publicRaceAccess, publicRaceGate } from "../../src/public-race-visibility";
import { listPublicRaces } from "../../src/public-races";
import { publicRaceContentVersion } from "../../src/public-race-version";
import { readPublicRaceMapImage } from "../../src/race-map";
import { exportRaceAsAdmin } from "../../src/race-export";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { purgeRows } from "../../src/purge";
import { addGroupMember, createTrainingGroup, readGroupAsLeader, removeGroupMember, setRaceGroup, updateGroupSettings } from "../../src/training-groups";
import { createGroupSessions, removeGroupSession, undoGroupSeries } from "../../src/training-group-sessions";
import { acknowledgeRaceMapPublicUse, readRaceMapAgreementAsAdmin, saveRaceMapToLibrary, updateLibraryMap } from "../../src/training-group-maps";
import { raceGroupNameDisplay, readGroupPublicView } from "../../src/training-group-public";
import { registerTestAccount, setRacePublished } from "./accounts";
import { ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * Steg 68 (ADR-0182): träningsgrupper mot PostgreSQL – ledarna är ADMIN på gruppens tävlingar (men inte medlemmar och
 * andra), synligheten (namn, bara inloggade, statistik), upprepning och ångra, kartbibliotekets avtal med spärren för
 * publik visning, och att export, kopia och borttagning hanterar gruppen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Grupptestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg68_grupper_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg68_grupper_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Account = Awaited<ReturnType<typeof registerTestAccount>>;
const account = () => registerTestAccount(db, undefined, NOW);
const settings = { formatVersion: 1, name: "Ungdom OK ÄÖ", pageVisibility: "LINK", nameDisplay: "FIRST", statsVisibility: "LEADERS",
  pointsMode: "ATTENDANCE", templateRaceId: null };
const agreement = { ownership: "EXTERNAL", ownerKind: "MUNICIPALITY", ownerName: "Stockholms stad", agreement: "Avtal 2026: bara träning",
  validUntil: "2026-12-31", contact: "karta@example.se", trainingOnly: true, feePerPrint: false, noPublicDisplay: true };

/** En grupp med ledaren `leader` och den seedade tävlingen (med två resultat) i gruppen, publicerad. */
async function groupWithRace(leader: Account) {
  const code = `ungdom-${randomUUID().slice(0, 8)}`;
  const created = await createTrainingGroup(db, { ...leader.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Ungdom OK ÄÖ", code } }, NOW);
  if (created.status !== "created") throw new Error(`Gruppen skapades inte: ${created.status}`);
  const seed = await seedRace(db, pool);
  // Tävlingen läggs till i gruppen av dess administratör, som också är ledare (setRaceGroup kräver båda).
  await addGroupMember(db, { ...leader.proof, groupId: created.group.groupId, request: { formatVersion: 1, requestId: randomUUID(),
    email: (await pool.query<{ email: string }>("select email from user_account where id = $1", [seed.admin.accountId])).rows[0]!.email,
    role: "LEADER" } }, NOW);
  const attached = await setRaceGroup(db, { ...seed.admin, raceId: seed.ids.race, request: { formatVersion: 1, groupId: created.group.groupId } }, NOW);
  expect(attached).toEqual({ status: "ok", groupId: created.group.groupId });
  expect(await setRacePublished(db, seed.admin, seed.ids.race, true, NOW)).toMatchObject({ status: "saved" });
  await ingest(db, seed.ids.race, [run(seed.cards.ada, "10:02:00", 30), run(seed.cards.bo, "10:04:00", 35)]);
  return { groupId: created.group.groupId, code, seed };
}

const roleOn = async (raceId: string, who: Account) =>
  (await requireRaceRole(db, { raceId, ...who.proof, role: "ADMIN" }, NOW)).status;

describe("steg 68: träningsgrupper", { timeout: 180_000 }, () => {
  it("ledarna är ADMIN på gruppens tävlingar; medlemmar och andra är det inte", async () => {
    const leader = await account();
    const { groupId, seed } = await groupWithRace(leader);
    const [second, member, stranger] = [await account(), await account(), await account()];
    // Ledaren har ingen egen rad på evenemanget men är administratör via gruppen.
    const [ownRow] = await db.select().from(schema.eventAdministrationGrants).where(eq(schema.eventAdministrationGrants.accountId, leader.accountId));
    expect(ownRow).toBeUndefined();
    expect(await roleOn(seed.ids.race, leader)).toBe("authenticated");
    expect(await roleOn(seed.ids.race, second)).toBe("unauthorized");
    const addedLeader = await addGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: second.email,
      role: "LEADER" } }, NOW);
    expect(addedLeader).toMatchObject({ status: "added", member: { role: "LEADER", email: second.email } });
    expect(await roleOn(seed.ids.race, second)).toBe("authenticated");
    const addedMember = await addGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: member.email,
      role: "MEMBER" } }, NOW);
    expect(addedMember.status).toBe("added");
    expect(await roleOn(seed.ids.race, member)).toBe("unauthorized");
    expect(await roleOn(seed.ids.race, stranger)).toBe("unauthorized");
    // En icke-ledare ser inte ledarnas vy och kan inte lägga till någon.
    expect((await readGroupAsLeader(db, { ...member.proof, groupId }, NOW)).status).toBe("not-found");
    expect((await addGroupMember(db, { ...stranger.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: stranger.email,
      role: "LEADER" } }, NOW)).status).toBe("not-found");
    // Borttagen ledare nekas från nästa anrop.
    if (addedLeader.status !== "added") throw new Error("Ledaren lades inte till");
    expect(await removeGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, memberId: addedLeader.member.memberId } }, NOW))
      .toEqual({ status: "removed" });
    expect(await roleOn(seed.ids.race, second)).toBe("unauthorized");
    // Funktionär på evenemanget och ledare i gruppen: ledarskapet ger ADMIN.
    await db.insert(schema.eventAdministrationGrants).values({ eventId: seed.ids.event, accountId: second.accountId, role: "FUNCTIONARY", grantedAt: NOW });
    expect(await roleOn(seed.ids.race, second)).toBe("forbidden");
    await addGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: second.email, role: "LEADER" } }, NOW);
    expect(await roleOn(seed.ids.race, second)).toBe("authenticated");
    // Den sista ledaren kan inte tas bort: här finns tre ledare (skaparen, seedens admin och second).
    const view = await readGroupAsLeader(db, { ...leader.proof, groupId }, NOW);
    if (view.status !== "ok") throw new Error("Vyn lästes inte");
    expect(view.view.members.filter(row => row.role === "LEADER")).toHaveLength(3);
    expect(view.view.sessions.map(row => row.raceId)).toEqual([seed.ids.race]);
  });

  it("namnen och synligheten följer gruppens inställningar, med försiktiga standardvärden", async () => {
    const leader = await account();
    const { groupId, code, seed } = await groupWithRace(leader);
    const raceId = seed.ids.race;
    const member = await account(), stranger = await account();
    await addGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: member.email, role: "MEMBER" } }, NOW);

    // Standard: alla med länken, förnamn, statistik bara för ledarna.
    const view = await readGroupPublicView(db, { code: code.toUpperCase(), sessionToken: null }, NOW);
    if (view.status !== "ok") throw new Error(`Gruppsidan syns inte: ${view.status}`);
    expect(view.view).toMatchObject({ nameDisplay: "FIRST", pageVisibility: "LINK", viewer: "PUBLIC", season: null });
    expect(view.view.latest?.raceId).toBe(raceId);
    expect(view.view.latest?.results.map(row => [row.givenName, row.familyName])).toEqual([["Ada", ""], ["Bo", ""]]);
    expect(JSON.stringify(view.view)).not.toContain("Ek");
    // Tävlingens egna publika listor får samma namn (webben maskerar med raceGroupNameDisplay).
    expect(await raceGroupNameDisplay(db, raceId)).toBe("FIRST");
    const ownList = maskPublicNames(await publicResults(db, raceId), await raceGroupNameDisplay(db, raceId));
    expect(JSON.stringify(ownList)).not.toMatch(/"familyName":"Ek"|610001/);
    // Gruppens tävlingar listas inte på startsidan.
    expect(JSON.stringify(await listPublicRaces(db, {}, NOW))).not.toContain(raceId);
    // Medlemmen ser inte statistiken förrän ledarna slår på den.
    const asMember = await readGroupPublicView(db, { code, sessionToken: member.proof.sessionToken }, NOW);
    expect(asMember.status === "ok" && asMember.view).toMatchObject({ viewer: "MEMBER", season: null });

    const versionBefore = await publicRaceContentVersion(db, raceId);
    expect((await updateGroupSettings(db, { ...leader.proof, groupId, request: { ...settings, nameDisplay: "FULL", statsVisibility: "MEMBERS" } }, NOW))
      .status).toBe("ok");
    expect(await publicRaceContentVersion(db, raceId)).not.toBe(versionBefore);
    const full = await readGroupPublicView(db, { code, sessionToken: member.proof.sessionToken }, NOW);
    if (full.status !== "ok") throw new Error("Gruppsidan syns inte");
    expect(full.view.latest?.results.map(row => row.familyName)).toEqual(["Ek", "Ek"]);
    expect(full.view.season?.rows.map(row => [row.givenName, row.attended, row.points])).toEqual([["Ada", 1, 1], ["Bo", 1, 1]]);
    expect(full.view.season?.rows.every(row => /^p\d+$/.test(row.key))).toBe(true);

    await updateGroupSettings(db, { ...leader.proof, groupId, request: { ...settings, nameDisplay: "NONE" } }, NOW);
    const none = await readGroupPublicView(db, { code, sessionToken: null }, NOW);
    expect(none.status === "ok" && JSON.stringify(none.view)).not.toMatch(/Ada|Bo"|Ek/);

    // Bara inloggade medlemmar: gruppsidan och tävlingens egna publika sidor.
    await updateGroupSettings(db, { ...leader.proof, groupId, request: { ...settings, pageVisibility: "MEMBERS" } }, NOW);
    expect(await readGroupPublicView(db, { code, sessionToken: null }, NOW)).toEqual({ status: "login-required", name: "Ungdom OK ÄÖ" });
    expect((await readGroupPublicView(db, { code, sessionToken: stranger.proof.sessionToken }, NOW)).status).toBe("login-required");
    expect((await readGroupPublicView(db, { code, sessionToken: member.proof.sessionToken }, NOW)).status).toBe("ok");
    expect(await publicRaceAccess(db, raceId, null, NOW)).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, stranger.proof.sessionToken, NOW)).toBe("NONE");
    expect(await publicRaceGate(db, raceId, member.proof.sessionToken, NOW)).toEqual({ access: "PUBLIC", privateCache: true });
    expect(await publicRaceGate(db, raceId, leader.proof.sessionToken, NOW)).toEqual({ access: "PUBLIC", privateCache: true });
  });

  it("upprepningen skapar tillfällena i förväg och ångras för de framtida, orörda", async () => {
    const leader = await account();
    const { groupId, seed } = await groupWithRace(leader);
    const request = { formatVersion: 1, requestId: randomUUID(), source: "RACE", sourceRaceId: seed.ids.race, eventName: "Tisdagsträning",
      raceDate: "2026-09-15", startTime: "18:00", mapId: null, includeCourseSetting: false, publish: true,
      repeat: { weekday: 2, lastDate: "2026-10-13" }, acknowledgeAgreement: false };
    const created = await createGroupSessions(db, { ...leader.proof, groupId, request }, NOW);
    if (created.status !== "created") throw new Error(`Upprepningen skapades inte: ${created.status}`);
    expect(created.raceIds).toHaveLength(5);
    const races = await db.select({ id: schema.races.id, raceDate: schema.races.raceDate, firstStartTime: schema.races.firstStartTime,
      publishedAt: schema.races.publishedAt, groupId: schema.events.trainingGroupId }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(inArray(schema.races.id, created.raceIds));
    expect(races.map(row => row.raceDate).sort()).toEqual(["2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13"]);
    expect(races.every(row => row.firstStartTime === "18:00" && row.publishedAt !== null && row.groupId === groupId)).toBe(true);
    // Klasser och banor följer med; deltagarna gör det inte. Ledaren är ADMIN utan egen rad.
    const copied = created.raceIds[1]!;
    expect((await pool.query<{ n: number }>("select count(*)::int as n from class where race_id = $1", [copied])).rows[0]!.n).toBe(2);
    expect((await pool.query<{ n: number }>("select count(*)::int as n from entry where race_id = $1", [copied])).rows[0]!.n).toBe(0);
    expect(await roleOn(copied, leader)).toBe("authenticated");
    // Samma begäran ger samma tillfällen.
    expect(await createGroupSessions(db, { ...leader.proof, groupId, request }, NOW)).toMatchObject({ status: "created", replayed: true,
      raceIds: created.raceIds });
    // Någon anmäler sig till 6 oktober; 15 september har varit (i dag är 19 september).
    const october6 = races.find(row => row.raceDate === "2026-10-06")!.id;
    const classId = (await pool.query<{ id: string }>("select id from class where race_id = $1 limit 1", [october6])).rows[0]!.id;
    await pool.query("insert into entry(race_id, class_id, given_name, family_name) values($1, $2, 'Ida', 'Ek')", [october6, classId]);
    const undone = await undoGroupSeries(db, { ...leader.proof, groupId, seriesId: created.seriesId! }, NOW);
    expect(undone).toEqual({ status: "undone", removed: 3, kept: 2 });
    const left = await db.select({ id: schema.races.id }).from(schema.races).where(inArray(schema.races.id, created.raceIds));
    expect(left.map(row => row.id).sort()).toEqual([races.find(row => row.raceDate === "2026-09-15")!.id, october6].sort());
    // Ett tillfälle med anmälda tas inte bort, ett orört gör det.
    expect(await removeGroupSession(db, { ...leader.proof, groupId, raceId: october6 }, NOW)).toEqual({ status: "conflict" });
    const firstId = races.find(row => row.raceDate === "2026-09-15")!.id;
    expect(await removeGroupSession(db, { ...leader.proof, groupId, raceId: firstId }, NOW)).toEqual({ status: "removed" });
    // Gruppen finns kvar.
    expect((await db.select().from(schema.trainingGroups).where(eq(schema.trainingGroups.id, groupId)))).toHaveLength(1);
  });

  it("kartbibliotekets avtal syns, spärrar publik visning och varnar vid ny träning", async () => {
    const leader = await account();
    const { groupId, seed } = await groupWithRace(leader);
    const raceId = seed.ids.race;
    const image = Buffer.from("inte en riktig bild men bytes");
    await pool.query(`insert into race_map (race_id, file_name, media_type, image, sha256, byte_length, width, height, tie_points, transform,
      uploaded_at, georeferenced_at) values ($1, 'karta.png', 'image/png', $2, $3, $4, 100, 80, '[]', '{}', $5, $5)`,
    [raceId, image, "a".repeat(64), image.byteLength, NOW]);
    expect(await readPublicRaceMapImage(db, raceId)).toBeDefined();
    const saved = await saveRaceMapToLibrary(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), raceId,
      name: "Älvsjöskogen", includeCourseSetting: false, agreement } }, NOW);
    if (saved.status !== "saved") throw new Error(`Kartan sparades inte: ${saved.status}`);
    // Tävlingen har nu avtalet: inte publik visning → kartbilden (och vägvalen, GPS-rutterna) spärras publikt.
    const read = await readRaceMapAgreementAsAdmin(db, { raceId, sessionToken: leader.proof.sessionToken }, NOW);
    expect(read).toMatchObject({ status: "ok", agreement: { mapName: "Älvsjöskogen", ownerName: "Stockholms stad", noPublicDisplay: true,
      publicUseBlocked: true, issues: ["NO_PUBLIC_DISPLAY", "TRAINING_ONLY"] } });
    expect(await readPublicRaceMapImage(db, raceId)).toBeUndefined();
    // Medvetet val: visa ändå.
    expect(await acknowledgeRaceMapPublicUse(db, { raceId, ...leader.proof, request: { formatVersion: 1, acknowledge: true } }, NOW))
      .toMatchObject({ status: "ok", agreement: { publicUseBlocked: false } });
    expect(await readPublicRaceMapImage(db, raceId)).toBeDefined();

    // Ny träning efter avtalets slut (och källan är en tävling, inte en träning): varning, sedan medvetet vidare.
    const request = { formatVersion: 1, requestId: randomUUID(), source: "PREVIOUS", sourceRaceId: null, eventName: "Vinterträning",
      raceDate: "2027-02-02", startTime: null, mapId: saved.mapId, includeCourseSetting: false, publish: true, repeat: null, acknowledgeAgreement: false };
    expect(await createGroupSessions(db, { ...leader.proof, groupId, request }, NOW))
      .toEqual({ status: "agreement", issues: ["EXPIRED", "TRAINING_ONLY"] });
    const created = await createGroupSessions(db, { ...leader.proof, groupId, request: { ...request, acknowledgeAgreement: true } }, NOW);
    if (created.status !== "created") throw new Error("Träningen skapades inte");
    const winter = created.raceIds[0]!;
    // ADR-0185: vintern har inte startat; kartan publikt direkt, så att det är avtalet som prövas här.
    await pool.query("update race set public_map_timing = 'ON_PUBLISH' where id = $1", [winter]);
    expect((await pool.query<{ n: number }>("select octet_length(image) as n from race_map where race_id = $1", [winter])).rows[0]!.n).toBe(image.byteLength);
    // Kartan är en kopia, och valet att visa publikt följer inte med.
    expect(await readPublicRaceMapImage(db, winter)).toBeUndefined();
    // Avtalet förnyas i biblioteket: tävlingarna som valt kartan följer med.
    expect(await updateLibraryMap(db, { ...leader.proof, groupId, mapId: saved.mapId, request: { formatVersion: 1, name: "Älvsjöskogen",
      agreement: { ...agreement, validUntil: "2027-12-31", noPublicDisplay: false } } }, NOW)).toEqual({ status: "ok", races: 2 });
    expect(await readPublicRaceMapImage(db, winter)).toBeDefined();
    // Borttagen tävling tar inte biblioteket med sig.
    await db.transaction(tx => purgeRows(tx, "event", [seed.ids.event]));
    expect((await pool.query<{ n: number }>("select count(*)::int as n from training_group_map where id = $1", [saved.mapId])).rows[0]!.n).toBe(1);
  });

  it("export och kopia hanterar gruppen", async () => {
    const leader = await account();
    const { groupId, code, seed } = await groupWithRace(leader);
    const exported = await exportRaceAsAdmin(db, { raceId: seed.ids.race, sessionToken: leader.proof.sessionToken }, NOW);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const content = JSON.parse(new TextDecoder().decode(exported.bytes)) as { event: { training_group_id: string };
      trainingGroup: { code: string; name_display: string }[]; mapAgreement: unknown[] };
    expect(content.event.training_group_id).toBe(groupId);
    expect(content.trainingGroup).toEqual([expect.objectContaining({ code, name_display: "FIRST" })]);
    expect(JSON.stringify(content.trainingGroup)).not.toContain(leader.email);
    // En ledare som kopierar får kopian i gruppen (och är ADMIN där via gruppen, och ägare).
    const copy = await copyRaceAsAdmin(db, { ...leader.proof, raceId: seed.ids.race, request: { formatVersion: 1, requestId: randomUUID(),
      eventName: "Kopia", raceName: "", raceDate: "2026-10-01", includePeople: false } }, NOW);
    if (copy.status !== "copied") throw new Error("Kopian misslyckades");
    const [copyEvent] = await db.select({ groupId: schema.events.trainingGroupId }).from(schema.events).where(eq(schema.events.id, copy.response.eventId));
    expect(copyEvent?.groupId).toBe(groupId);
    // Någon som är administratör på evenemanget men inte ledare får en fristående kopia.
    const outsider = await account();
    await db.insert(schema.eventAdministrationGrants).values({ eventId: seed.ids.event, accountId: outsider.accountId, role: "ADMIN", grantedAt: NOW });
    const own = await copyRaceAsAdmin(db, { ...outsider.proof, raceId: seed.ids.race, request: { formatVersion: 1, requestId: randomUUID(),
      eventName: "Egen", raceName: "", raceDate: "2026-10-01", includePeople: false } }, NOW);
    if (own.status !== "copied") throw new Error("Kopian misslyckades");
    const [ownEvent] = await db.select({ groupId: schema.events.trainingGroupId }).from(schema.events).where(eq(schema.events.id, own.response.eventId));
    expect(ownEvent?.groupId).toBeNull();
    // Att ta tävlingen ur gruppen kräver en egen roll på evenemanget (inte bara ledarskapet).
    expect((await setRaceGroup(db, { ...leader.proof, raceId: copy.response.raceId, request: { formatVersion: 1, groupId: null } }, NOW)).status)
      .toBe("ok");
    const [other] = await db.select({ id: schema.races.id }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.events.trainingGroupId, groupId)).limit(1);
    const onlyLeader = await account();
    await addGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: onlyLeader.email, role: "LEADER" } }, NOW);
    expect((await setRaceGroup(db, { ...onlyLeader.proof, raceId: other!.id, request: { formatVersion: 1, groupId: null } }, NOW)).status)
      .toBe("forbidden");
  });
});
