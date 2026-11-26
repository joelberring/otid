import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, objectRefFor, type ObjectState } from "@o-tid/map-revision";
import { acceptAllInvitations } from "../../src/account-arrival";
import { createClub, inviteClubMember, listMyClubs } from "../../src/clubs";
import { readClubArchive } from "../../src/club-archive";
import { updateClubMap, uploadClubMapVersion } from "../../src/club-maps";
import { readCourseSettingAsAdmin } from "../../src/course-setting";
import {
  createMapProject, createMapProjectFromUpload, inviteMapProjectMember, listMapProjects, readMapProject, readMapProjectSource, updateMapProject
} from "../../src/map-projects";
import { exportMapProjectChanges, readMapProjectOutput, writeMapProjectVersion } from "../../src/map-project-output";
import { syncMapProject } from "../../src/map-project-sync";
import { createOrganizerEvent } from "../../src/organizer-events";
import { upsertClubMapCatalogListing, upsertMapProjectCatalogListing } from "../../src/public-map-catalog";
import { readRaceMapStateAsAdmin } from "../../src/race-map";
import { readMapProjectCurrentFile, saveMapProjectSnapshotToRace } from "../../src/race-map-project";
import { readRaceMapSourceFileAsAdmin, saveRaceMapSourceAsAdmin, updateRaceMapSourceLockAsAdmin } from "../../src/race-map-source";
import { raceAuth, registerTestAccount } from "./accounts";

/**
 * Etapp 2: Kartprojektens nedladdningsspärr (`source_download_policy`), arv från klubbarkiv och till tävling,
 * manuell tävlingskartspärr (uppladdning + PATCH i efterhand, spärr mot att låsa upp ärvd spärr),
 * samt katalogstatus på `ClubMapView` och `MapProjectView`.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_kartsparr_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-26T12:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const SHA = sha256Hex(mapBytes);
const parsed = readMapFile(mapBytes, "Skogen.omap", { sources: true });
const pointObject = parsed.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
const POINT_REF = objectRefFor(SHA, pointObject)!;
const moved = (dx: number): ObjectState => ({ kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + dx, y: pointObject.at.y } } });

async function* chunks(bytes: Uint8Array) { yield bytes; }

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const IMAGE = png(992, 832);
const METADATA: RaceMapSourceMetadata = {
  formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null,
  render: { pxPerMm: 8, originX: -2, originY: 102 },
  summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null
};

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);

afterAll(async () => {
  await pool.end();
  if (!/^otid_kartsparr_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function createRace(proof: Awaited<ReturnType<typeof registerTestAccount>>["proof"]): Promise<string> {
  const created = await createOrganizerEvent(db, {
    ...proof,
    idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({
      formatVersion: 1, eventName: "Spärrtest", raceName: "Träning",
      raceDate: "2026-11-27", timeZone: "Europe/Stockholm", raceType: "TRAINING"
    })
  }, NOW);
  if (created.status !== "created") throw new Error(`Kunde inte skapa tävling: ${JSON.stringify(created)}`);
  return created.response.raceId;
}

describe("Etapp 2: kartprojektens nedladdningsspärr och tävlingsarv", () => {
  it("spärrar /source, /outputs/:id, /export?format=omap och /current-file för icke-ägare men tillåter ägare och GeoJSON", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const editor = await registerTestAccount(db, undefined, NOW);
    const reader = await registerTestAccount(db, undefined, NOW);

    const created = await createMapProjectFromUpload(db, {
      ...owner.proof,
      metadata: { formatVersion: 1, requestId: randomUUID(), name: "Låst projekt", fileName: "Skogen.omap" },
      file: mapBytes
    }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;

    for (const [person, role] of [[editor, "EDIT"], [reader, "READ"]] as const) {
      expect((await inviteMapProjectMember(db, {
        ...owner.proof, projectId,
        request: { formatVersion: 1, requestId: randomUUID(), email: person.email, role }
      }, NOW)).status).toBe("invited");
      await db.transaction(tx => acceptAllInvitations(tx, person.accountId, NOW));
    }

    // Skapa en ändring och en output-fil.
    const synced = await syncMapProject(db, {
      ...owner.proof, projectId,
      request: {
        formatVersion: 1, clientId: "c1", since: 0,
        edits: [{ editId: randomUUID(), key: baseKey(POINT_REF), ref: POINT_REF, base: null, kind: "MOVE", state: moved(4), at: NOW.toISOString() }]
      }
    }, NOW);
    expect(synced.status).toBe("ok");
    const output = await writeMapProjectVersion(db, {
      ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID() }
    }, NOW);
    if (output.status !== "ok" || output.response.status !== "created") throw new Error("Ingen output");
    const outputId = output.response.outputId;

    // Standard: ALLOWED → alla medlemmar har canDownloadSource=true och når /source, /outputs, /export, /current-file.
    const openView = await readMapProject(db, { ...editor.proof, projectId }, NOW);
    expect(openView.status === "ok" && openView.view).toMatchObject({
      sourceDownloadPolicy: "ALLOWED",
      sourceDownloadLockedByArchive: false,
      effectiveSourceDownloadPolicy: "ALLOWED",
      viewer: { canDownloadSource: true }
    });
    expect((await readMapProjectSource(db, { ...editor.proof, projectId }, NOW)).status).toBe("ok");
    expect((await readMapProjectOutput(db, { ...editor.proof, projectId, outputId }, NOW)).status).toBe("ok");
    expect((await exportMapProjectChanges(db, { ...editor.proof, projectId, format: "omap" }, NOW)).status).toBe("ok");
    expect((await readMapProjectCurrentFile(db, { ...editor.proof, projectId }, NOW)).status).toBe("ok");

    // Icke-ägare får 403 vid försök att ändra sourceDownloadPolicy.
    expect(await updateMapProject(db, {
      ...editor.proof, projectId, request: { formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }
    }, NOW)).toEqual({ status: "forbidden" });
    expect(await updateMapProject(db, {
      ...reader.proof, projectId, request: { formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }
    }, NOW)).toEqual({ status: "forbidden" });

    // Ägaren slår på spärren.
    expect(await updateMapProject(db, {
      ...owner.proof, projectId, request: { formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }
    }, NOW)).toEqual({ status: "ok" });

    // Ägaren har fortfarande canDownloadSource=true och 200 på alla nedladdningar.
    const ownerView = await readMapProject(db, { ...owner.proof, projectId }, NOW);
    expect(ownerView.status === "ok" && ownerView.view).toMatchObject({
      sourceDownloadPolicy: "CUSTODIANS_ONLY",
      sourceDownloadLockedByArchive: false,
      effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
      viewer: { canDownloadSource: true }
    });
    expect((await readMapProjectSource(db, { ...owner.proof, projectId }, NOW)).status).toBe("ok");
    expect((await readMapProjectOutput(db, { ...owner.proof, projectId, outputId }, NOW)).status).toBe("ok");
    expect((await exportMapProjectChanges(db, { ...owner.proof, projectId, format: "omap" }, NOW)).status).toBe("ok");
    expect((await readMapProjectCurrentFile(db, { ...owner.proof, projectId }, NOW)).status).toBe("ok");

    // EDIT och READ får canDownloadSource=false och 403 på /source, /outputs, /export?format=omap och /current-file,
    // men får fortfarande exportera GeoJSON-ändringar!
    for (const member of [editor, reader]) {
      const view = await readMapProject(db, { ...member.proof, projectId }, NOW);
      expect(view.status === "ok" && view.view).toMatchObject({
        sourceDownloadPolicy: "CUSTODIANS_ONLY",
        effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
        viewer: { canDownloadSource: false }
      });
      expect(await readMapProjectSource(db, { ...member.proof, projectId }, NOW)).toEqual({ status: "forbidden" });
      expect(await readMapProjectOutput(db, { ...member.proof, projectId, outputId }, NOW)).toEqual({ status: "forbidden" });
      expect(await exportMapProjectChanges(db, { ...member.proof, projectId, format: "omap" }, NOW)).toEqual({ status: "forbidden" });
      expect(await readMapProjectCurrentFile(db, { ...member.proof, projectId }, NOW)).toEqual({ status: "forbidden" });
      expect((await exportMapProjectChanges(db, { ...member.proof, projectId, format: "geojson" }, NOW)).status).toBe("ok");
    }

    // listMapProjects inkluderar policyfälten i sammanfattningen.
    const list = await listMapProjects(db, owner.proof, NOW);
    expect(list.status === "ok" && list.list.projects.find(p => p.projectId === projectId)).toMatchObject({
      sourceDownloadPolicy: "CUSTODIANS_ONLY",
      sourceDownloadLockedByArchive: false,
      effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY"
    });

    // Arv till tävling: när det spärrade kartprojektet kopplas sätts source_download_locked = true och spärras från upplåsning.
    const raceId = await createRace(owner.proof);
    const current = await readMapProjectCurrentFile(db, { ...owner.proof, projectId }, NOW);
    if (current.status !== "ok") throw new Error(current.status);
    expect(await saveMapProjectSnapshotToRace(db, {
      ...owner.proof, projectId, raceId, sha256: current.sha256, image: IMAGE, metadata: METADATA
    }, NOW)).toEqual({ status: "ok", georeferenced: false, seq: 1 });

    const mapState = await readRaceMapStateAsAdmin(db, { ...owner.proof, raceId }, NOW);
    expect(mapState.status === "ok" && mapState.response.source).toMatchObject({
      sourceDownloadLocked: true,
      sourceDownloadLockedByOrigin: true
    });
    const csState = await readCourseSettingAsAdmin(db, { ...owner.proof, raceId }, NOW);
    expect(csState.status === "ok" && csState.response.mapFile).toMatchObject({
      sourceDownloadLocked: true,
      sourceDownloadLockedByOrigin: true
    });
    expect(await readRaceMapSourceFileAsAdmin(db, { ...owner.proof, raceId }, NOW)).toEqual({ status: "forbidden" });
    // Tävlingsadmin får INTE låsa upp spärren som ärvts från kartprojektet.
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      ...owner.proof, raceId, request: { formatVersion: 1, sourceDownloadLocked: false }
    }, NOW)).toEqual({ status: "forbidden" });
  });

  it("ärver spärr från klubbarkivet (även mot icke-admin projektägare) och exponerar katalogstatus på ClubMapView och MapProjectView", async () => {
    const clubAdmin = await registerTestAccount(db, undefined, NOW);
    const member = await registerTestAccount(db, undefined, NOW);

    const club = await createClub(db, { ...clubAdmin.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Spärr" } }, NOW);
    if (club.status !== "created") throw new Error(club.status);
    const clubId = club.club.clubId;
    const uploaded = await uploadClubMapVersion(db, {
      ...clubAdmin.proof, clubId, mapId: null, newMapName: "Arkivskogen", fileName: "Arkivskogen.omap",
      versionDate: "2026-01-01", note: null, body: chunks(mapBytes)
    }, NOW);
    if (uploaded.status !== "created") throw new Error(uploaded.status);

    expect((await inviteClubMember(db, {
      ...clubAdmin.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: member.email, role: "READER" }
    }, NOW)).status).toBe("invited");
    await listMyClubs(db, member.proof, NOW);

    // Katalogstatus före publicering på ClubMapView.
    const archiveBefore = await readClubArchive(db, { ...clubAdmin.proof, clubId }, NOW);
    expect(archiveBefore.status === "ok" && archiveBefore.list.maps[0]).toMatchObject({
      publishedInCatalog: false, publicListingId: null, publicListingAccessMode: null
    });

    // Publicera klubbkartan i Kartbanken och verifiera batchad status på ClubMapView.
    const published = await upsertClubMapCatalogListing(db, {
      ...clubAdmin.proof, clubId, mapId: uploaded.mapId,
      request: { formatVersion: 1, title: "Arkivskogen", accessMode: "INFO_ONLY", showPreview: false }
    }, NOW);
    if (published.status !== "ok") throw new Error(published.status);
    const archiveAfter = await readClubArchive(db, { ...clubAdmin.proof, clubId }, NOW);
    expect(archiveAfter.status === "ok" && archiveAfter.list.maps[0]).toMatchObject({
      publishedInCatalog: true, publicListingId: published.listing.id, publicListingAccessMode: "INFO_ONLY"
    });

    // Medlemmen skapar projekt medan klubbkartan fortfarande är ALLOWED (medlemmen blir projekt-OWNER).
    const project = await createMapProject(db, {
      ...member.proof, request: { formatVersion: 1, requestId: randomUUID(), clubId, baseVersionId: uploaded.versionId, name: "Arkivprojekt" }
    }, NOW);
    if (project.status !== "created") throw new Error(project.status);
    const projectId = project.projectId;

    // Klubbadmin slår nu på nedladdningsspärr på klubbkartan i arkivet.
    expect(await updateClubMap(db, {
      ...clubAdmin.proof, clubId, mapId: uploaded.mapId,
      request: {
        formatVersion: 1, name: "Arkivskogen",
        agreement: { ownership: "CLUB", ownerKind: "CLUB", ownerName: null, agreement: null, validUntil: null, contact: null, trainingOnly: false, feePerPrint: false, noPublicDisplay: false },
        sourceDownloadPolicy: "CUSTODIANS_ONLY"
      }
    }, NOW)).toEqual({ status: "ok" });

    // Projektets egen policy är fortsatt ALLOWED, men arkivspärren gäller → effektiv policy CUSTODIANS_ONLY!
    const memberView = await readMapProject(db, { ...member.proof, projectId }, NOW);
    expect(memberView.status === "ok" && memberView.view).toMatchObject({
      sourceDownloadPolicy: "ALLOWED",
      sourceDownloadLockedByArchive: true,
      effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
      viewer: { canDownloadSource: false },
      publishedInCatalog: false,
      publicListingId: null,
      publicListingAccessMode: null
    });
    // Medlemmen (även som projekt-OWNER) spärras från rå källfil och från att publicera projektet publikt!
    expect(await readMapProjectSource(db, { ...member.proof, projectId }, NOW)).toEqual({ status: "forbidden" });
    expect(await exportMapProjectChanges(db, { ...member.proof, projectId, format: "omap" }, NOW)).toEqual({ status: "forbidden" });
    expect(await readMapProjectCurrentFile(db, { ...member.proof, projectId }, NOW)).toEqual({ status: "forbidden" });
    expect(await upsertMapProjectCatalogListing(db, {
      ...member.proof, projectId,
      request: { formatVersion: 1, title: "Läckförsök", accessMode: "OPEN_DOWNLOAD", showPreview: false }
    }, NOW)).toEqual({ status: "forbidden" });

    // Klubbadmin har fortsatt tillgång och kan publicera samt koppla projektet till en tävling (som ärver spärren).
    const adminView = await readMapProject(db, { ...clubAdmin.proof, projectId }, NOW);
    expect(adminView.status === "ok" && adminView.view).toMatchObject({
      sourceDownloadLockedByArchive: true,
      effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
      viewer: { canDownloadSource: true }
    });
    expect((await readMapProjectSource(db, { ...clubAdmin.proof, projectId }, NOW)).status).toBe("ok");

    const projPublished = await upsertMapProjectCatalogListing(db, {
      ...clubAdmin.proof, projectId,
      request: { formatVersion: 1, title: "Arkivprojekt", accessMode: "INFO_ONLY", showPreview: false }
    }, NOW);
    if (projPublished.status !== "ok") throw new Error(projPublished.status);
    const afterProjPub = await readMapProject(db, { ...clubAdmin.proof, projectId }, NOW);
    expect(afterProjPub.status === "ok" && afterProjPub.view).toMatchObject({
      publishedInCatalog: true, publicListingId: projPublished.listing.id, publicListingAccessMode: "INFO_ONLY"
    });

    const raceId = await createRace(clubAdmin.proof);
    const current = await readMapProjectCurrentFile(db, { ...clubAdmin.proof, projectId }, NOW);
    if (current.status !== "ok") throw new Error(current.status);
    expect(await saveMapProjectSnapshotToRace(db, {
      ...clubAdmin.proof, projectId, raceId, sha256: current.sha256, image: IMAGE, metadata: METADATA
    }, NOW)).toEqual({ status: "ok", georeferenced: false, seq: 0 });
    const [raceSource] = await db.select().from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, raceId));
    expect(raceSource?.sourceDownloadLocked).toBe(true);
    expect(raceSource?.clubMapId).toBe(uploaded.mapId);
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      ...clubAdmin.proof, raceId, request: { formatVersion: 1, sourceDownloadLocked: false }
    }, NOW)).toEqual({ status: "forbidden" });
  });

  it("tillåter tävlingsadmin att sätta sourceDownloadLocked vid manuell uppladdning och växla den i efterhand", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const raceId = await createRace(owner.proof);
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY", NOW);

    // Manuell uppladdning med sourceDownloadLocked: true i metadata.
    expect(await saveRaceMapSourceAsAdmin(db, {
      ...owner.proof, raceId, file: mapBytes, fileName: "egen.omap", image: IMAGE,
      metadata: { ...METADATA, sourceDownloadLocked: true }
    }, NOW)).toEqual({ status: "ok", georeferenced: false });

    const lockedState = await readRaceMapStateAsAdmin(db, { ...owner.proof, raceId }, NOW);
    expect(lockedState.status === "ok" && lockedState.response.source).toMatchObject({
      sourceDownloadLocked: true,
      sourceDownloadLockedByOrigin: false
    });
    const lockedCs = await readCourseSettingAsAdmin(db, { ...owner.proof, raceId }, NOW);
    expect(lockedCs.status === "ok" && lockedCs.response.mapFile).toMatchObject({
      sourceDownloadLocked: true,
      sourceDownloadLockedByOrigin: false
    });
    expect(await readRaceMapSourceFileAsAdmin(db, { ...owner.proof, raceId }, NOW)).toEqual({ status: "forbidden" });

    // Funktionär och ogiltig kropp/utloggad avvisas korrekt.
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      ...functionary, raceId, request: { formatVersion: 1, sourceDownloadLocked: false }
    }, NOW)).toEqual({ status: "forbidden" });
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      raceId, sessionToken: null, csrfCookie: null, csrfHeader: null, request: { ogiltig: true }
    }, NOW)).toEqual({ status: "unauthorized" });
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      ...owner.proof, raceId, request: { formatVersion: 1, sourceDownloadLocked: "nej" }
    }, NOW)).toEqual({ status: "invalid-request" });

    // Egen karta (inte ärvd) kan låsas upp av tävlingsadmin i efterhand!
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      ...owner.proof, raceId, request: { formatVersion: 1, sourceDownloadLocked: false }
    }, NOW)).toEqual({ status: "ok", sourceDownloadLocked: false, sourceDownloadLockedByOrigin: false });
    expect((await readRaceMapSourceFileAsAdmin(db, { ...owner.proof, raceId }, NOW)).status).toBe("ok");

    // Och låsas igen!
    expect(await updateRaceMapSourceLockAsAdmin(db, {
      ...owner.proof, raceId, request: { formatVersion: 1, sourceDownloadLocked: true }
    }, NOW)).toEqual({ status: "ok", sourceDownloadLocked: true, sourceDownloadLockedByOrigin: false });
    expect(await readRaceMapSourceFileAsAdmin(db, { ...owner.proof, raceId }, NOW)).toEqual({ status: "forbidden" });
  });

  it("Etapp 4B: spärrar /export?format=ocd med 403 för icke-ägare på OCAD-projekt vid CUSTODIANS_ONLY men tillåter ägare och GeoJSON", async () => {
    const ocdBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.ocd", import.meta.url)));
    const owner = await registerTestAccount(db, undefined, NOW);
    const editor = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, {
      ...owner.proof,
      metadata: { formatVersion: 1, requestId: randomUUID(), name: "Låst OCAD", fileName: "Skogen.ocd" },
      file: ocdBytes
    }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    expect((await inviteMapProjectMember(db, {
      ...owner.proof, projectId,
      request: { formatVersion: 1, requestId: randomUUID(), email: editor.email, role: "EDIT" }
    }, NOW)).status).toBe("invited");
    await db.transaction(tx => acceptAllInvitations(tx, editor.accountId, NOW));

    expect(await updateMapProject(db, {
      ...owner.proof, projectId, request: { formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }
    }, NOW)).toEqual({ status: "ok" });

    // Icke-ägare blockeras från format=ocd men får fortfarande exportera geojson.
    expect(await exportMapProjectChanges(db, { ...editor.proof, projectId, format: "ocd" }, NOW)).toEqual({ status: "forbidden" });
    expect((await exportMapProjectChanges(db, { ...editor.proof, projectId, format: "geojson" }, NOW)).status).toBe("ok");

    // Ägaren får en giltig binär .ocd-fil.
    const ownerExport = await exportMapProjectChanges(db, { ...owner.proof, projectId, format: "ocd" }, NOW);
    expect(ownerExport.status).toBe("ok");
    if (ownerExport.status === "ok") {
      expect(ownerExport.fileName).toBe("Skogen ändringar.ocd");
      expect(ownerExport.body[0]).toBe(0xad);
      expect(ownerExport.body[1]).toBe(0x0c);
    }
  });
});
