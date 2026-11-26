import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { schema, type Database } from "@o-tid/database";
import type { MapProjectRole } from "@o-tid/contracts";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, newKey, objectRefFor } from "@o-tid/map-revision";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-26T18:00:00Z");

const OCD_BYTES = new Uint8Array(readFileSync(new URL("../../../fixtures/maps/kartfil.ocd", import.meta.url)));
const OCD_SHA = sha256Hex(OCD_BYTES);
const OMAP_BYTES = new Uint8Array(readFileSync(new URL("../../../fixtures/maps/kartfil.omap", import.meta.url)));
const OMAP_SHA = sha256Hex(OMAP_BYTES);
const OMAP_MAP = readMapFile(OMAP_BYTES, "skogen.omap", { sources: true });

const storeMock = vi.hoisted(() => ({
  storeMapContent: vi.fn()
}));

vi.mock("../src/user-account", () => ({
  authenticateUserAccountSessionForProtectedRead: vi.fn(async () => ({
    status: "authenticated" as const,
    principal: { accountId: ACCOUNT_ID }
  })),
  authenticateUserAccountSessionForMutation: vi.fn(async () => ({
    status: "authenticated" as const,
    principal: { accountId: ACCOUNT_ID }
  }))
}));

vi.mock("../src/map-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/map-content")>();
  return {
    ...actual,
    storeMapContent: storeMock.storeMapContent
  };
});

import { createMapProjectNew } from "../src/map-project-new";
import { exportMapProjectChanges } from "../src/map-project-output";

const PROOF = { sessionToken: "tok", csrfCookie: "csrf", csrfHeader: "csrf" };

function mockNewProjectDb() {
  const insertedProjects: Record<string, unknown>[] = [];
  const storedBytes: Uint8Array[] = [];
  storeMock.storeMapContent.mockImplementation(async (_tx: unknown, bytes: Uint8Array) => {
    storedBytes.push(bytes);
    return { status: "stored", sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
  });
  const db = {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve([]))
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === schema.mapProjects) insertedProjects.push(row);
        const promise = Promise.resolve([]);
        return Object.assign(promise, { onConflictDoNothing: async () => [] });
      }
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
  };
  return { db: db as unknown as Database, insertedProjects, storedBytes };
}

function mockExportDb(options: {
  baseFormat: "OCD" | "OMAP";
  role: MapProjectRole;
  policy?: "ALLOWED" | "CUSTODIANS_ONLY";
  objects?: Record<string, unknown>[];
  colors?: { id: number; cmyk: { c: number; m: number; y: number; k: number } }[];
}) {
  const isOcd = options.baseFormat === "OCD";
  const bytes = isOcd ? OCD_BYTES : OMAP_BYTES;
  const project = {
    id: PROJECT_ID,
    clubId: null,
    name: isOcd ? "Högdalen OCAD" : "Skogen Mapper",
    baseVersionId: null,
    baseFileName: isOcd ? "hogdalen.ocd" : "skogen.omap",
    baseSource: "UPLOAD" as const,
    baseSha256: isOcd ? OCD_SHA : OMAP_SHA,
    baseFormat: options.baseFormat,
    readerVersion: 1,
    status: "OPEN" as const,
    mode: null,
    area: null,
    recon: null,
    leaderboard: null,
    colors: options.colors ?? null,
    symbolColors: null,
    textSymbols: null,
    normSymbols: null,
    colorsChangedAt: null,
    aiMode: "PROPOSE" as const,
    sourceDownloadPolicy: options.policy ?? "ALLOWED",
    seq: 2,
    createdBy: ACCOUNT_ID,
    createdAt: NOW,
    closedAt: null,
    closedBy: null,
    lastOpenedAt: NOW,
    requestId: REQUEST_ID
  };
  const db = {
    select: () => {
      let table: unknown;
      const chain = {
        from: (source: unknown) => { table = source; return chain; },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        groupBy: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => {
          if (table === schema.mapProjects) return Promise.resolve(resolve([project]));
          if (table === schema.mapProjectMembers) return Promise.resolve(resolve([{ role: options.role, addedBy: ACCOUNT_ID }]));
          if (table === schema.mapProjectObjects) return Promise.resolve(resolve(options.objects ?? []));
          return Promise.resolve(resolve([]));
        }
      };
      return chain;
    },
    execute: async () => ({ rows: [{ data: Buffer.from(bytes), byte_length: bytes.byteLength }] }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
  };
  return db as unknown as Database;
}

describe("Etapp 5B: createMapProjectNew stödjer format OMAP (förval) och OCD", () => {
  const area = {
    crs: "SWEREF99TM" as const,
    rings: [[[671000, 6573000], [672000, 6573000], [672000, 6574000], [671000, 6574000]]]
  };

  it("skapar ny .ocd-karta med OCAD 12-innehåll när format=OCD anges", async () => {
    const { db, insertedProjects, storedBytes } = mockNewProjectDb();
    const res = await createMapProjectNew(db, {
      ...PROOF,
      request: {
        formatVersion: 1, requestId: REQUEST_ID, name: "Älvsjöskogen", symbolSet: "ISOM2017-2", scale: 10000,
        format: "OCD", declination: 6.5, area
      }
    }, NOW);
    expect(res.status).toBe("created");
    expect(insertedProjects).toHaveLength(1);
    expect(insertedProjects[0]).toMatchObject({ baseFormat: "OCD", baseFileName: "Älvsjöskogen.ocd", baseSource: "NEW" });
    expect(storedBytes).toHaveLength(1);
    expect(storedBytes[0]![0]).toBe(0xad);
    expect(storedBytes[0]![1]).toBe(0x0c);
    const parsed = readMapFile(storedBytes[0]!, "Älvsjöskogen.ocd");
    expect(parsed.format).toBe("OCD");
    expect(parsed.scale).toBe(10000);
    expect(parsed.georeference?.crs).toEqual({ kind: "EPSG", code: 3006 });
    expect(parsed.warnings).toEqual([]);
  });

  it("faller tillbaka till Mapper (.omap) som förval när format utelämnas", async () => {
    const { db, insertedProjects, storedBytes } = mockNewProjectDb();
    const res = await createMapProjectNew(db, {
      ...PROOF,
      request: { formatVersion: 1, requestId: REQUEST_ID, name: "Kungshatt", symbolSet: "ISSPROM2019-2", scale: 4000, area }
    }, NOW);
    expect(res.status).toBe("created");
    expect(insertedProjects[0]).toMatchObject({ baseFormat: "OMAP", baseFileName: "Kungshatt.omap" });
    expect(readMapFile(storedBytes[0]!, "Kungshatt.omap").format).toBe("OMAP");
  });
});

describe("Etapp 5B: exportMapProjectChanges fullkartekonvertering (ocd-full & omap-full) + CUSTODIANS_ONLY 403-spärr", () => {
  it("konverterar .omap-projekt (inkl. sparad ändring & färgändring) till giltig .ocd med rapport", async () => {
    const pt = OMAP_MAP.objects.find(o => o.kind === "point") as Extract<MapObject, { kind: "point" }>;
    const ref = objectRefFor(OMAP_SHA, pt)!;
    const objects = [
      {
        projectId: PROJECT_ID, objectKey: baseKey(ref), ref, lastEditId: "e1", authorAccountId: ACCOUNT_ID, editedAt: NOW,
        state: { kind: "OBJECT", object: { ...pt, at: { x: pt.at.x + 2.5, y: pt.at.y } } }
      },
      {
        projectId: PROJECT_ID, objectKey: newKey("n1"), ref: null, lastEditId: "e2", authorAccountId: ACCOUNT_ID, editedAt: NOW,
        state: { kind: "OBJECT", object: { kind: "point", symbol: pt.symbol, at: { x: 15.125, y: 12.375 }, angle: 0 } }
      }
    ];
    const colorEdit = [{ id: OMAP_MAP.colors[0]!.id, cmyk: { c: 0.1, m: 0.9, y: 0.2, k: 0 } }];

    const res = await exportMapProjectChanges(
      mockExportDb({ baseFormat: "OMAP", role: "OWNER", policy: "CUSTODIANS_ONLY", objects, colors: colorEdit }),
      { ...PROOF, projectId: PROJECT_ID, format: "ocd-full" },
      NOW
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.fileName).toBe("skogen.ocd");
    expect(res.contentType).toBe("application/octet-stream");
    expect(res.body[0]).toBe(0xad);
    expect(res.body[1]).toBe(0x0c);
    expect(res.report.sourceFormat).toBe("OMAP");
    expect(res.report.targetFormat).toBe("OCD");
    expect(res.report.objects).toBe(OMAP_MAP.objects.length + 1);
    expect(res.report.warnings.some(w => w.code === "PRECISION_ROUNDED")).toBe(true);

    const reread = readMapFile(res.body, res.fileName);
    expect(reread.format).toBe("OCD");
    expect(reread.objects).toHaveLength(OMAP_MAP.objects.length + 1);
    expect(reread.colors[0]!.cmyk).toEqual({ c: 0.1, m: 0.9, y: 0.2, k: 0 });
  });

  it("konverterar .ocd-projekt till giltig .omap med rapport", async () => {
    const res = await exportMapProjectChanges(
      mockExportDb({ baseFormat: "OCD", role: "OWNER", policy: "CUSTODIANS_ONLY" }),
      { ...PROOF, projectId: PROJECT_ID, format: "omap-full" },
      NOW
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.fileName).toBe("hogdalen.omap");
    expect(res.contentType).toBe("application/xml");
    expect(res.report.sourceFormat).toBe("OCD");
    expect(res.report.targetFormat).toBe("OMAP");
    const reread = readMapFile(res.body, res.fileName);
    expect(reread.format).toBe("OMAP");
    expect(reread.warnings).toEqual([]);
    expect(reread.objects).toHaveLength(res.report.objects);
  });

  it("blockerar BÅDE ocd-full och omap-full med forbidden (403) för icke-ägare när CUSTODIANS_ONLY gäller, men tillåter GeoJSON", async () => {
    for (const role of ["EDIT", "SUGGEST", "READ"] as const) {
      const lockedOmap = mockExportDb({ baseFormat: "OMAP", role, policy: "CUSTODIANS_ONLY" });
      expect(await exportMapProjectChanges(lockedOmap, { ...PROOF, projectId: PROJECT_ID, format: "ocd-full" }, NOW))
        .toEqual({ status: "forbidden" });
      expect((await exportMapProjectChanges(lockedOmap, { ...PROOF, projectId: PROJECT_ID, format: "geojson" }, NOW)).status)
        .toBe("ok");

      const lockedOcd = mockExportDb({ baseFormat: "OCD", role, policy: "CUSTODIANS_ONLY" });
      expect(await exportMapProjectChanges(lockedOcd, { ...PROOF, projectId: PROJECT_ID, format: "omap-full" }, NOW))
        .toEqual({ status: "forbidden" });
      expect((await exportMapProjectChanges(lockedOcd, { ...PROOF, projectId: PROJECT_ID, format: "geojson" }, NOW)).status)
        .toBe("ok");
    }

    // Fel konverteringsriktning mot projektets format ger invalid-request.
    expect(await exportMapProjectChanges(mockExportDb({ baseFormat: "OCD", role: "OWNER" }), { ...PROOF, projectId: PROJECT_ID, format: "ocd-full" }, NOW))
      .toEqual({ status: "invalid-request" });
    expect(await exportMapProjectChanges(mockExportDb({ baseFormat: "OMAP", role: "OWNER" }), { ...PROOF, projectId: PROJECT_ID, format: "omap-full" }, NOW))
      .toEqual({ status: "invalid-request" });
  });
});
