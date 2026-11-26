import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema, type Database } from "@o-tid/database";
import type { MapProjectRole } from "@o-tid/contracts";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, newKey, objectRefFor } from "@o-tid/map-revision";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-26T14:00:00Z");
const OCD_BYTES = new Uint8Array(readFileSync(new URL("../../../fixtures/maps/kartfil.ocd", import.meta.url)));
const OCD_SHA = sha256Hex(OCD_BYTES);
const OCD_MAP = readMapFile(OCD_BYTES, "hogdalen.ocd", { sources: true });

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

import { mapProjectCanWriteVersion } from "../src/map-project-access";
import { loadProjectMap } from "../src/map-project-job-run";
import { applyProjectColors, exportMapProjectChanges, ocadWriteEnabled } from "../src/map-project-output";
import { readMapProject, updateMapProject } from "../src/map-projects";

const PROOF = { sessionToken: "tok", csrfCookie: "csrf", csrfHeader: "csrf" };

function projectRow(format: "OMAP" | "OCD", status: "OPEN" | "CLOSED" = "OPEN") {
  return {
    id: PROJECT_ID,
    clubId: null,
    name: format === "OCD" ? "Högdalen OCAD" : "Kungshatt Mapper",
    baseVersionId: null,
    baseFileName: format === "OCD" ? "hogdalen.ocd" : "kungshatt.omap",
    baseSource: "UPLOAD" as const,
    baseSha256: "a".repeat(64),
    baseFormat: format,
    readerVersion: 1,
    status,
    mode: null,
    area: null,
    recon: null,
    leaderboard: null,
    colors: null,
    symbolColors: null,
    textSymbols: null,
    normSymbols: null,
    colorsChangedAt: null,
    aiMode: "PROPOSE" as const,
    sourceDownloadPolicy: "ALLOWED" as const,
    seq: 3,
    createdBy: ACCOUNT_ID,
    createdAt: NOW,
    closedAt: null,
    closedBy: null,
    lastOpenedAt: NOW,
    requestId: "33333333-3333-4333-8333-333333333333"
  };
}

/** Enkel Drizzle-mock som svarar per tabell så att readMapProject/updateMapProject kan testas utan Postgres. */
function mockProjectDb(format: "OMAP" | "OCD", role: MapProjectRole, status: "OPEN" | "CLOSED" = "OPEN") {
  const project = projectRow(format, status);
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => {
      let table: unknown;
      let joined = false;
      const chain = {
        from: (source: unknown) => { table = source; return chain; },
        innerJoin: () => { joined = true; return chain; },
        leftJoin: () => { joined = true; return chain; },
        where: () => chain,
        groupBy: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => {
          if (table === schema.mapProjects) return Promise.resolve(resolve([project]));
          if (table === schema.mapProjectMembers && !joined) {
            return Promise.resolve(resolve([{ role, addedBy: ACCOUNT_ID }]));
          }
          if (table === schema.mapProjectProposals) return Promise.resolve(resolve([{ value: 0 }]));
          return Promise.resolve(resolve([]));
        }
      };
      return chain;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => [] };
      }
    }),
    execute: async () => ({ rows: [{ map_file: "2048", files: "2048", rows: "0" }] }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
  };
  return { db: db as unknown as Database, updates };
}

describe("Etapp 3B: mapProjectCanWriteVersion & ocadWriteEnabled", () => {
  it("ocadWriteEnabled kräver uttryckligt OTID_OCAD_WRITE=1", () => {
    expect(ocadWriteEnabled({})).toBe(false);
    expect(ocadWriteEnabled({ OTID_OCAD_WRITE: "0" })).toBe(false);
    expect(ocadWriteEnabled({ OTID_OCAD_WRITE: "true" })).toBe(false);
    expect(ocadWriteEnabled({ OTID_OCAD_WRITE: "1" })).toBe(true);
    expect(ocadWriteEnabled({ OTID_OCAD_WRITE: " 1 " })).toBe(true);
  });

  it("mapProjectCanWriteVersion matchar ägarbehörighet + format/serverflagga", () => {
    expect(mapProjectCanWriteVersion("OWNER", { status: "OPEN", baseFormat: "OMAP" }, false)).toBe(true);
    expect(mapProjectCanWriteVersion("OWNER", { status: "CLOSED", baseFormat: "OMAP" }, false)).toBe(true);
    expect(mapProjectCanWriteVersion("EDIT", { status: "OPEN", baseFormat: "OMAP" }, true)).toBe(false);
    expect(mapProjectCanWriteVersion("SUGGEST", { status: "OPEN", baseFormat: "OMAP" }, true)).toBe(false);
    expect(mapProjectCanWriteVersion("READ", { status: "OPEN", baseFormat: "OMAP" }, true)).toBe(false);

    expect(mapProjectCanWriteVersion("OWNER", { status: "OPEN", baseFormat: "OCD" }, false)).toBe(false);
    expect(mapProjectCanWriteVersion("OWNER", { status: "OPEN", baseFormat: "OCD" }, true)).toBe(true);
    expect(mapProjectCanWriteVersion("OWNER", { status: "CLOSED", baseFormat: "OCD" }, true)).toBe(true);
    expect(mapProjectCanWriteVersion("EDIT", { status: "OPEN", baseFormat: "OCD" }, true)).toBe(false);
    expect(mapProjectCanWriteVersion("READ", { status: "OPEN", baseFormat: "OCD" }, true)).toBe(false);
  });
});

describe("Etapp 3B: readMapProject sätter viewer.canWriteVersion efter format, roll och OTID_OCAD_WRITE", () => {
  const originalOcadWrite = process.env.OTID_OCAD_WRITE;
  afterEach(() => {
    if (originalOcadWrite === undefined) delete process.env.OTID_OCAD_WRITE;
    else process.env.OTID_OCAD_WRITE = originalOcadWrite;
  });

  it("OMAP: true för OWNER och false för EDIT även när OTID_OCAD_WRITE är av", async () => {
    delete process.env.OTID_OCAD_WRITE;
    const owner = await readMapProject(mockProjectDb("OMAP", "OWNER").db, { ...PROOF, projectId: PROJECT_ID }, NOW);
    expect(owner.status === "ok" && owner.view.viewer).toMatchObject({ canManage: true, canWriteVersion: true });

    const editor = await readMapProject(mockProjectDb("OMAP", "EDIT").db, { ...PROOF, projectId: PROJECT_ID }, NOW);
    expect(editor.status === "ok" && editor.view.viewer).toMatchObject({ canManage: false, canWriteVersion: false });
  });

  it("OCD: false för OWNER när OTID_OCAD_WRITE=0/av, true när OTID_OCAD_WRITE=1, och alltid false för EDIT", async () => {
    process.env.OTID_OCAD_WRITE = "0";
    const ownerOff = await readMapProject(mockProjectDb("OCD", "OWNER").db, { ...PROOF, projectId: PROJECT_ID }, NOW);
    expect(ownerOff.status === "ok" && ownerOff.view.viewer).toMatchObject({ canManage: true, canWriteVersion: false });

    process.env.OTID_OCAD_WRITE = "1";
    const ownerOn = await readMapProject(mockProjectDb("OCD", "OWNER").db, { ...PROOF, projectId: PROJECT_ID }, NOW);
    expect(ownerOn.status === "ok" && ownerOn.view.viewer).toMatchObject({ canManage: true, canWriteVersion: true });

    const editorOn = await readMapProject(mockProjectDb("OCD", "EDIT").db, { ...PROOF, projectId: PROJECT_ID }, NOW);
    expect(editorOn.status === "ok" && editorOn.view.viewer).toMatchObject({ canManage: false, canWriteVersion: false });
  });
});

describe("Etapp 4B: updateMapProject har full OCAD-paritet med OMAP för färger, symbolfärger, textsymboler och normsymboler", () => {
  const colorChange = [{ id: 1, cmyk: { c: 0.1, m: 0.8, y: 0.2, k: 0 } }];
  const symbolColorChange = [{ symbol: "521", from: 1, to: 2 }];
  const textSymbolChange = [{
    id: "10", fontFamily: "Arial", size: 3.5, color: 1, bold: false, italic: false, align: "left" as const, framing: null
  }];
  const normSymbolChange = { replace: ["521"], add: ["545"] };

  it("tillåter colors, symbolColors, textSymbols och normSymbols för OWNER på OCAD-projekt", async () => {
    const cases = [
      { request: { formatVersion: 1, colors: colorChange }, key: "colors", expected: colorChange },
      { request: { formatVersion: 1, symbolColors: symbolColorChange }, key: "symbolColors", expected: symbolColorChange },
      { request: { formatVersion: 1, textSymbols: textSymbolChange }, key: "textSymbols", expected: textSymbolChange },
      { request: { formatVersion: 1, normSymbols: normSymbolChange }, key: "normSymbols", expected: normSymbolChange }
    ];
    for (const entry of cases) {
      const { db, updates } = mockProjectDb("OCD", "OWNER");
      const result = await updateMapProject(db, { ...PROOF, projectId: PROJECT_ID, request: entry.request }, NOW);
      expect(result).toEqual({ status: "ok" });
      expect(updates).toHaveLength(1);
      expect(updates[0]![entry.key]).toEqual(entry.expected);
      expect(updates[0]!.colorsChangedAt).toEqual(NOW);
    }
  });

  it("tillåter rensning till tom lista samt namnbyte på OCAD-projekt", async () => {
    const { db, updates } = mockProjectDb("OCD", "OWNER");
    expect(await updateMapProject(db, { ...PROOF, projectId: PROJECT_ID, request: { formatVersion: 1, colors: [], symbolColors: [], textSymbols: [], normSymbols: { replace: [], add: [] } } }, NOW))
      .toEqual({ status: "ok" });
    expect(await updateMapProject(db, { ...PROOF, projectId: PROJECT_ID, request: { formatVersion: 1, name: "Högdalen 2026" } }, NOW))
      .toEqual({ status: "ok" });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ colors: null, symbolColors: null, textSymbols: null, normSymbols: null });
  });

  it("tillåter colors och symbolColors för OWNER på OMAP-projekt men ger forbidden för EDIT på OCAD", async () => {
    const omap = mockProjectDb("OMAP", "OWNER");
    expect(await updateMapProject(omap.db, { ...PROOF, projectId: PROJECT_ID, request: { formatVersion: 1, colors: colorChange, symbolColors: symbolColorChange } }, NOW))
      .toEqual({ status: "ok" });
    expect(omap.updates).toHaveLength(1);

    const ocdEditor = mockProjectDb("OCD", "EDIT");
    expect(await updateMapProject(ocdEditor.db, { ...PROOF, projectId: PROJECT_ID, request: { formatVersion: 1, colors: colorChange } }, NOW))
      .toEqual({ status: "forbidden" });
    expect(ocdEditor.updates).toHaveLength(0);
  });
});

describe("Etapp 4B: exportMapProjectChanges (format=ocd), applyProjectColors och loadProjectMap på OCAD", () => {
  function mockOcdExportDb(options: {
    format?: "OCD" | "OMAP";
    role: MapProjectRole;
    policy?: "ALLOWED" | "CUSTODIANS_ONLY";
    objects?: Record<string, unknown>[];
    colors?: { id: number; cmyk: { c: number; m: number; y: number; k: number } }[];
  }) {
    const format = options.format ?? "OCD";
    const project = {
      ...projectRow(format),
      baseSha256: OCD_SHA,
      sourceDownloadPolicy: options.policy ?? "ALLOWED",
      colors: options.colors ?? null
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
      execute: async () => ({ rows: [{ data: Buffer.from(OCD_BYTES), byte_length: OCD_BYTES.byteLength }] }),
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
    };
    return db as unknown as Database;
  }

  it("exporterar giltig kompakt .ocd med enbart ändrade/tillagda objekt och färgändringar, samt ger 403 vid spärr för icke-ägare", async () => {
    const point = OCD_MAP.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
    const ref = objectRefFor(OCD_SHA, point)!;
    const objects = [
      {
        projectId: PROJECT_ID, objectKey: baseKey(ref), ref, authorAccountId: ACCOUNT_ID, editedAt: NOW,
        state: { kind: "OBJECT", object: { ...point, at: { x: point.at.x + 3, y: point.at.y } } }
      },
      {
        projectId: PROJECT_ID, objectKey: newKey("added-1"), ref: null, authorAccountId: ACCOUNT_ID, editedAt: NOW,
        state: { kind: "OBJECT", object: { kind: "point", symbol: point.symbol, at: { x: 42, y: 17 }, angle: 0 } }
      }
    ];
    const colorEdit = [{ id: 0, cmyk: { c: 0.2, m: 0.9, y: 0.1, k: 0 } }];

    // Ägare med CUSTODIANS_ONLY får 200 binär .ocd.
    const ownerRes = await exportMapProjectChanges(mockOcdExportDb({ role: "OWNER", policy: "CUSTODIANS_ONLY", objects, colors: colorEdit }),
      { ...PROOF, projectId: PROJECT_ID, format: "ocd" }, NOW);
    expect(ownerRes.status).toBe("ok");
    if (ownerRes.status !== "ok") return;
    expect(ownerRes.fileName).toBe("hogdalen ändringar.ocd");
    expect(ownerRes.contentType).toBe("application/octet-stream");
    expect(ownerRes.body).toBeInstanceOf(Uint8Array);
    expect(ownerRes.body[0]).toBe(0xad);
    expect(ownerRes.body[1]).toBe(0x0c);
    const reread = readMapFile(ownerRes.body, ownerRes.fileName);
    expect(reread.objects).toHaveLength(2);
    expect(reread.colors.find(color => color.id === 0)?.cmyk).toEqual({ c: 0.2, m: 0.9, y: 0.1, k: 0 });

    // Icke-ägare med CUSTODIANS_ONLY får 403 (forbidden) på format=ocd men ok på geojson.
    const lockedMemberDb = mockOcdExportDb({ role: "EDIT", policy: "CUSTODIANS_ONLY", objects });
    expect(await exportMapProjectChanges(lockedMemberDb, { ...PROOF, projectId: PROJECT_ID, format: "ocd" }, NOW))
      .toEqual({ status: "forbidden" });
    expect((await exportMapProjectChanges(lockedMemberDb, { ...PROOF, projectId: PROJECT_ID, format: "geojson" }, NOW)).status)
      .toBe("ok");

    // Fel format mot grundfilens format ger invalid-request.
    expect(await exportMapProjectChanges(mockOcdExportDb({ format: "OMAP", role: "OWNER" }), { ...PROOF, projectId: PROJECT_ID, format: "ocd" }, NOW))
      .toEqual({ status: "invalid-request" });
    expect(await exportMapProjectChanges(mockOcdExportDb({ format: "OCD", role: "OWNER" }), { ...PROOF, projectId: PROJECT_ID, format: "omap" }, NOW))
      .toEqual({ status: "invalid-request" });
  });

  it("applyProjectColors och loadProjectMap fungerar på OCAD-fil med färger, symbolfärger och normsymboler", () => {
    const green = OCD_MAP.colors.find(color => color.name === "Grön")!.id;
    const blue = OCD_MAP.colors.find(color => color.name === "Blå")!.id;
    const style = {
      colors: [{ id: 0, cmyk: { c: 0.15, m: 0.85, y: 0.05, k: 0 } }],
      symbolColors: [{ symbol: "406", from: green, to: blue }],
      normSymbols: { replace: ["406"], add: ["545"] }
    };
    const styled = applyProjectColors(OCD_BYTES, { colors: style.colors, symbolColors: style.symbolColors, normSymbols: { replace: [], add: [] } });
    if (!styled.ok) throw new Error(styled.message);
    const reread = readMapFile(styled.bytes, "hogdalen.ocd");
    expect(reread.colors.find(color => color.id === 0)?.cmyk).toEqual({ c: 0.15, m: 0.85, y: 0.05, k: 0 });
    const forest = [...reread.symbols.values()].find(symbol => symbol.code.main === 406);
    expect(forest?.kind === "AREA" && forest.fill).toBe(blue);

    const loaded = loadProjectMap(OCD_BYTES, "hogdalen.ocd", OCD_SHA, [], style);
    expect(loaded.base.colors.find(color => color.id === 0)?.cmyk).toEqual({ c: 0.15, m: 0.85, y: 0.05, k: 0 });
    expect([...loaded.base.symbols.values()].some(symbol => symbol.code.main === 545)).toBe(true);
  });
});
