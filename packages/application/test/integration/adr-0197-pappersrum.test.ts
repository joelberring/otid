import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { paperImageHashes, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { importCourseSettingAsAdmin, readCourseSettingAsAdmin } from "../../src/course-setting";
import { saveCourseSettingEditsAsAdmin } from "../../src/course-setting-collaboration";
import {
  deletePaperLibraryAsAdmin, listPaperLibraryAsAdmin, paperImagesFor, readPaperImageAsAdmin, savePaperLibraryAsAdmin, sniffPaperImage, uploadPaperImageAsAdmin
} from "../../src/course-setting-paper";
import { createOrganizerEvent } from "../../src/organizer-events";
import { accountOnRace, raceAuth, registerTestAccount } from "./accounts";

/**
 * ADR-0197 (migration 0063): papperets bilder en gång per innehåll och kontots mallbibliotek. Uppladdning prövar typen mot
 * innehållet och storleken; en bild visas för den som laddade upp den eller när tävlingens dokument pekar på den; samma
 * bild två gånger ger en rad; biblioteket är kontots eget; utskriftsarbetaren får bilderna som dokumentet pekar på.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Pappersrumstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0197_papper_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0197_papper_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

function png(width: number, height: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 200)])));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const owner = await registerTestAccount(db);
  const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Papper", raceName: "KM", raceDate: "2026-12-09", timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...owner.proof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const imported = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document: readPpen(ppen).document,
    fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error("Inläsningen misslyckades");
  return proof;
}

async function current(proof: Proof) {
  const read = await readCourseSettingAsAdmin(db, proof);
  if (read.status !== "ok" || !read.response.setting) throw new Error("Läget saknas");
  return { version: read.response.setting.version, document: read.response.setting.document as unknown as CourseSettingDocument };
}

describe("ADR-0197: papperets bilder och mallbibliotek", { timeout: 180_000 }, () => {
  it("bilden sparas en gång, visas bara för den som laddade upp den eller när dokumentet pekar på den, och når utskriften", async () => {
    const owner = await race();
    const other = await raceAuth(db, owner.raceId, "ADMIN");
    const image = png(4, 2);
    expect(sniffPaperImage(image)).toEqual({ mediaType: "image/png", width: 4, height: 2 });
    // Fel typ mot innehållet, tomt och för stort avvisas.
    expect((await uploadPaperImageAsAdmin(db, { ...owner, mediaType: "image/jpeg", image })).status).toBe("invalid-request");
    expect((await uploadPaperImageAsAdmin(db, { ...owner, mediaType: "image/png", image: new Uint8Array() })).status).toBe("invalid-request");
    const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(image);
    expect((await uploadPaperImageAsAdmin(db, { ...owner, mediaType: "image/png", image: big })).status).toBe("invalid-request");
    const uploaded = await uploadPaperImageAsAdmin(db, { ...owner, mediaType: "image/png", image });
    if (uploaded.status !== "ok") throw new Error(uploaded.status);
    expect(uploaded.response).toMatchObject({ mediaType: "image/png", width: 4, height: 2 });
    const sha = uploaded.response.sha256;
    // Samma bild igen (en annan administratör): samma rad.
    expect(await uploadPaperImageAsAdmin(db, { ...other, mediaType: "image/png", image })).toMatchObject({ status: "ok", response: { sha256: sha } });
    expect(await db.select().from(schema.courseSettingPaperImages).where(eq(schema.courseSettingPaperImages.sha256, sha))).toHaveLength(1);

    const third = await raceAuth(db, owner.raceId, "ADMIN");
    expect((await readPaperImageAsAdmin(db, { ...third, sha256: sha })).status).toBe("not-found");
    expect((await readPaperImageAsAdmin(db, { ...owner, sha256: sha })).status).toBe("ok");
    // Dokumentet pekar på bilden: alla som läser banläggningen ser den.
    const before = await current(owner);
    const course = before.document.courses[0]!.id;
    const saved = await saveCourseSettingEditsAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), baseVersion: before.version,
      edits: [{ type: "SET_PAPER_LAYOUT", course, layout: { items: [{ id: "logo", kind: "IMAGE", at: { corner: "TOP_RIGHT", x: 3, y: 3 }, image: sha,
        mediaType: "image/png", aspect: 2, widthMm: 20 }] } }] } });
    expect(saved).toMatchObject({ status: "ok", response: { applied: 1 } });
    const read = await readPaperImageAsAdmin(db, { ...third, sha256: sha });
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(new Uint8Array(read.image)).toEqual(image);
    // Utskriftsarbetaren: bilderna som dokumentet pekar på.
    const after = await current(owner);
    expect(paperImageHashes(after.document)).toEqual([sha]);
    const forPrint = await paperImagesFor(db, paperImageHashes(after.document));
    expect(forPrint.get(sha)?.mediaType).toBe("image/png");
    expect((await readPaperImageAsAdmin(db, { ...owner, sha256: "nope" })).status).toBe("invalid-request");
  });

  it("biblioteket är kontots eget: spara (samma namn ersätts), lista i en annan tävling, ta bort", async () => {
    const first = await race();
    const template = { schemaVersion: 1, id: "km", name: "x", items: [{ id: "t", kind: "TEXT", at: { corner: "TOP_LEFT", x: 1, y: 1 }, text: "{bana}", sizeMm: 4, widthMm: 50 }] };
    const saved = await savePaperLibraryAsAdmin(db, { ...first, request: { formatVersion: 1, name: "KM-mall", template } });
    if (saved.status !== "ok") throw new Error(saved.status);
    expect(saved.response.templates.map(row => row.name)).toEqual(["KM-mall"]);
    const again = await savePaperLibraryAsAdmin(db, { ...first, request: { formatVersion: 1, name: "KM-mall", template: { ...template, items: [] } } });
    expect(again).toMatchObject({ status: "ok", response: { templates: [{ name: "KM-mall", template: { items: [] } }] } });
    expect((await savePaperLibraryAsAdmin(db, { ...first, request: { formatVersion: 1, name: "Trasig", template: { ...template, schemaVersion: 9 } } })).status)
      .toBe("invalid-request");
    // En annan administratör ser inte kontots bibliotek.
    const stranger = await raceAuth(db, first.raceId, "ADMIN");
    expect(await listPaperLibraryAsAdmin(db, stranger)).toMatchObject({ status: "ok", response: { templates: [] } });
    const id = again.status === "ok" ? again.response.templates[0]!.id : "";
    expect((await deletePaperLibraryAsAdmin(db, { ...stranger, templateId: id })).status).toBe("not-found");
    expect(await deletePaperLibraryAsAdmin(db, { ...first, templateId: id })).toMatchObject({ status: "ok", response: { templates: [] } });
  });
});
