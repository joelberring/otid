import { afterEach, describe, expect, it, vi } from "vitest";
import { schema, type Database } from "@o-tid/database";
import type { MapProjectRole } from "@o-tid/contracts";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-26T14:00:00Z");

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
import { ocadWriteEnabled } from "../src/map-project-output";
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

describe("Etapp 3B: updateMapProject spärrar färg- och symboländringar på OCAD-projekt i Steg 1", () => {
  const colorChange = [{ id: 1, cmyk: { c: 0.1, m: 0.8, y: 0.2, k: 0 } }];
  const symbolColorChange = [{ symbol: "521", from: 1, to: 2 }];
  const textSymbolChange = [{
    id: "10", fontFamily: "Arial", size: 3.5, color: 1, bold: false, italic: false, align: "left" as const, framing: null
  }];
  const normSymbolChange = { replace: ["521"], add: [] };

  it("avvisar colors, symbolColors, textSymbols och normSymbols på OCAD med tydligt svenskt felmeddelande utan DB-skrivning", async () => {
    const cases = [
      { request: { formatVersion: 1, colors: colorChange }, snippet: "Färgtabellen" },
      { request: { formatVersion: 1, symbolColors: symbolColorChange }, snippet: "Symbolernas färger" },
      { request: { formatVersion: 1, textSymbols: textSymbolChange }, snippet: "Textsymboler" },
      { request: { formatVersion: 1, normSymbols: normSymbolChange }, snippet: "Normsymboler" }
    ];
    for (const entry of cases) {
      const { db, updates } = mockProjectDb("OCD", "OWNER");
      const result = await updateMapProject(db, { ...PROOF, projectId: PROJECT_ID, request: entry.request }, NOW);
      expect(result.status).toBe("invalid-request");
      expect("message" in result ? result.message : "").toContain(entry.snippet);
      expect(updates).toHaveLength(0);
    }
  });

  it("tillåter rensning till tom lista (colors: [] / symbolColors: []) samt namnbyte på OCAD-projekt", async () => {
    const { db, updates } = mockProjectDb("OCD", "OWNER");
    expect(await updateMapProject(db, { ...PROOF, projectId: PROJECT_ID, request: { formatVersion: 1, colors: [], symbolColors: [] } }, NOW))
      .toEqual({ status: "ok" });
    expect(await updateMapProject(db, { ...PROOF, projectId: PROJECT_ID, request: { formatVersion: 1, name: "Högdalen 2026" } }, NOW))
      .toEqual({ status: "ok" });
    expect(updates).toHaveLength(2);
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
