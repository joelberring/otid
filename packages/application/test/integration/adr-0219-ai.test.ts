import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createMapJobCanvas } from "../../../../scripts/map-job-canvas";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { geodeticToGrid, transverseMercatorFor } from "@o-tid/map-file";
import { claimMapJob, runMapJob } from "../../src/map-project-jobs";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject, updateMapProject } from "../../src/map-projects";
import { listMapProjectProposals } from "../../src/map-project-proposals";
import { handleMcpMessage } from "../../src/mcp";
import {
  authenticateOauthAccess, decideAuthorization, describeAuthorization, exchangeOauthToken, listAiConnections, pkceChallenge, registerOauthClient,
  revokeAiConnection
} from "../../src/oauth";
import { acceptAllInvitations } from "../../src/account-arrival";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 (K2): AI-kopplingen. Registrering, godkännande med PKCE, nycklar med rotation (en återanvänd förnyelsenyckel
 * återkallar kopplingen), Konto → AI-kopplingar, och MCP-verktygen mot ett kartprojekt där kartjobben görs av samma kod som
 * utskriftsarbetaren (med den riktiga canvasen). AI lämnar bara förslag; Läsa kan inte föreslå.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_ai_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const RESOURCE = "https://otid.test/api/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_ai_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = Awaited<ReturnType<typeof registerTestAccount>>["proof"];

async function connect(proof: Proof) {
  const registered = await registerOauthClient(db, { body: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
    ip: "198.51.100.7" });
  if (registered.status !== "created") throw new Error(registered.error);
  const clientId = registered.client.client_id;
  const verifier = randomBytes(40).toString("base64url");
  const query = { client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256", scope: "kartprojekt", state: "abc", resource: RESOURCE };
  const described = await describeAuthorization(db, { ...proof, query, resource: RESOURCE });
  expect(described).toMatchObject({ status: "ok", clientName: "Claude", redirectHost: "claude.ai" });
  const decided = await decideAuthorization(db, { ...proof, query, resource: RESOURCE, approve: true });
  if (decided.status !== "redirect") throw new Error(decided.status);
  const redirect = new URL(decided.redirect);
  expect(redirect.searchParams.get("state")).toBe("abc");
  const code = redirect.searchParams.get("code")!;
  const token = await exchangeOauthToken(db, { form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId,
    code_verifier: verifier, resource: RESOURCE }, ip: "198.51.100.7", resource: RESOURCE });
  if (token.status !== "ok") throw new Error(token.error);
  return { clientId, code, verifier, token: token.response };
}

/** Kör MCP-anropet medan kartjobben görs (som utskriftsarbetaren). */
async function mcp(accountId: string, message: object) {
  let done = false;
  const call = handleMcpMessage(db, accountId, message, { pollMs: 20, timeoutMs: 20_000 }).finally(() => { done = true; });
  while (!done) {
    const job = await claimMapJob(db, "test-worker");
    if (job) await runMapJob(db, job, { worker: "test-worker", createCanvas: createMapJobCanvas });
    else await new Promise(resolve => setTimeout(resolve, 20));
  }
  return call;
}

const call = (id: number, name: string, args: object = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const textOf = (response: unknown) => JSON.parse(((response as { result: { content: { type: string; text: string }[] } }).result.content
  .find(content => content.type === "text"))!.text) as Record<string, unknown>;

describe("ADR-0219 K2: AI-kopplingen", () => {
  it("OAuth: registrering, godkännande med PKCE, rotation, återanvänd förnyelsenyckel och återkallelse", async () => {
    const owner = await registerTestAccount(db);
    expect((await registerOauthClient(db, { body: { redirect_uris: ["http://evil.example/cb"] }, ip: "198.51.100.8" })).status).toBe("error");
    const { clientId, code, verifier, token } = await connect(owner.proof);
    expect(token).toMatchObject({ token_type: "Bearer", scope: "kartprojekt", expires_in: 3600 });
    expect(await authenticateOauthAccess(db, token.access_token)).toMatchObject({ accountId: owner.accountId, clientName: "Claude" });
    // Koden går inte att använda två gånger; fel verifierare godtas inte.
    expect((await exchangeOauthToken(db, { form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier },
      ip: "198.51.100.7", resource: RESOURCE })).status).toBe("error");
    // Förnyelse byter båda nycklarna; den gamla åtkomstnyckeln slutar gälla.
    const refreshed = await exchangeOauthToken(db, { form: { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: clientId },
      ip: "198.51.100.7", resource: RESOURCE });
    if (refreshed.status !== "ok") throw new Error(refreshed.error);
    expect(await authenticateOauthAccess(db, token.access_token)).toBeUndefined();
    expect(await authenticateOauthAccess(db, refreshed.response.access_token)).toBeDefined();
    // Den gamla förnyelsenyckeln igen: någon har en kopia, och kopplingen återkallas.
    expect((await exchangeOauthToken(db, { form: { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: clientId },
      ip: "198.51.100.7", resource: RESOURCE })).status).toBe("error");
    expect(await authenticateOauthAccess(db, refreshed.response.access_token)).toBeUndefined();
    // Konto → AI-kopplingar: en ny koppling syns och kan tas bort.
    const second = await connect(owner.proof);
    const listed = await listAiConnections(db, owner.proof);
    if (listed.status !== "ok") throw new Error(listed.status);
    const active = listed.connections.find(row => !row.revokedAt)!;
    expect((await revokeAiConnection(db, { ...owner.proof, grantId: active.grantId })).status).toBe("revoked");
    expect(await authenticateOauthAccess(db, second.token.access_token)).toBeUndefined();
    // Neka: felet skickas tillbaka med state.
    const other = await registerOauthClient(db, { body: { redirect_uris: [REDIRECT] }, ip: "198.51.100.9" });
    if (other.status !== "created") throw new Error("ingen klient");
    const denied = await decideAuthorization(db, { ...owner.proof, resource: RESOURCE, approve: false, query: { client_id: other.client.client_id,
      redirect_uri: REDIRECT, response_type: "code", code_challenge: pkceChallenge(randomBytes(40).toString("base64url")), code_challenge_method: "S256", state: "x" } });
    expect(denied.status === "redirect" && new URL(denied.redirect).searchParams.get("error")).toBe("access_denied");
  });

  it("ett spärrat konto har ingen AI-koppling (översynen A2)", async () => {
    const owner = await registerTestAccount(db);
    const { clientId, token } = await connect(owner.proof);
    expect(await authenticateOauthAccess(db, token.access_token)).toBeDefined();
    await db.update(schema.userAccounts).set({ blockedAt: new Date() }).where(eq(schema.userAccounts.id, owner.accountId));
    expect(await authenticateOauthAccess(db, token.access_token)).toBeUndefined();
    expect((await exchangeOauthToken(db, { form: { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: clientId },
      ip: "198.51.100.7", resource: RESOURCE })).status).toBe("error");
  });

  it("MCP: verktygen ser kartprojektet, ritar bilder och lämnar bara förslag", async () => {
    const owner = await registerTestAccount(db);
    const reader = await registerTestAccount(db);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Skogen",
      fileName: "Skogen.omap" }, file: mapBytes });
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email,
      role: "READ" } }, new Date(), async () => undefined)).status).toBe("invited");
    await db.transaction(tx => acceptAllInvitations(tx, reader.accountId, new Date()));

    const init = await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "O-Tid" } } });
    expect(await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const tools = await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((tools?.result as { tools: { name: string }[] }).tools.map(tool => tool.name)).toEqual(["list_map_projects", "create_map_project", "map_overview", "render_view",
      "render_compare", "training_labels", "training_raster", "list_objects", "norm_check", "generalize", "propose_changes", "list_laser_jobs", "start_laser_job", "read_laser_output"]);

    const projects = textOf(await mcp(owner.accountId, call(3, "list_map_projects")));
    expect(projects.projects).toMatchObject([{ projectId, name: "Skogen", role: "OWNER" }]);
    const overview = textOf(await mcp(owner.accountId, call(4, "map_overview", { project_id: projectId })));
    expect(overview).toMatchObject({ scale: 10000, objects: 11, georeference: { crs: "EPSG:3006" } });
    expect((overview.symbols as { code: string }[]).map(symbol => symbol.code)).toContain("206");

    const image = await mcp(owner.accountId, call(5, "render_view", { project_id: projectId, width_px: 600 }));
    const content = (image?.result as { content: { type: string; data?: string; mimeType?: string }[] }).content;
    expect(content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(content[0]!.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    const compare = await mcp(owner.accountId, call(6, "render_compare", { project_id: projectId, area: { min_x: 0, min_y: 0, max_x: 120, max_y: 100 } }));
    expect((compare?.result as { content: { type: string }[] }).content[0]!.type).toBe("image");

    // Träningsdata (ägaren 2026-11-11): kartan som klassraster i SWEREF 99 TM kring kartans mitt, och laserns raster (saknas här).
    const centre = (overview.georeference as { centerWgs84: { latitude: number; longitude: number } }).centerWgs84;
    const grid = geodeticToGrid(transverseMercatorFor(3006)!, centre.latitude, centre.longitude);
    const labels = await mcp(owner.accountId, call(61, "training_labels", { project_id: projectId, min_e: grid.easting - 600, min_n: grid.northing - 600,
      max_e: grid.easting + 600, max_n: grid.northing + 600, cell: 2 }));
    const labelContent = (labels?.result as { content: { type: string; data?: string; text?: string }[] }).content;
    expect(Buffer.from(labelContent[0]!.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    const labelMeta = JSON.parse(labelContent[1]!.text!) as { width: number; height: number; counts: Record<string, number> };
    expect(labelMeta).toMatchObject({ width: 600, height: 600, cell: 2, crs: "EPSG:3006" });
    expect(Object.keys(labelMeta.counts).length).toBeGreaterThan(0);
    const tooLarge = await mcp(owner.accountId, call(62, "training_labels", { project_id: projectId, min_e: 0, min_n: 0, max_e: 100_000, max_n: 100_000 }));
    expect((tooLarge?.result as { isError?: boolean }).isError).toBe(true);
    const noRaster = await mcp(owner.accountId, call(63, "training_raster", { project_id: projectId, name: "hojd" }));
    expect((noRaster?.result as { isError?: boolean }).isError).toBe(true);

    const objects = textOf(await mcp(owner.accountId, call(7, "list_objects", { project_id: projectId, symbols: ["206"] })));
    expect(objects.total).toBe(3);
    const stone = (objects.objects as { key: string; at: number[] }[])[0]!;
    const check = textOf(await mcp(owner.accountId, call(8, "norm_check", { project_id: projectId })));
    expect(check.total).toBeGreaterThanOrEqual(0);
    // K6 del 2: normkontrollen efter ISOM (kartan är i 1:10 000) och generaliseringen, först utan förslag.
    expect(check.norm).toMatchObject({ standard: "ISOM", scale: 10000 });
    const general = textOf(await mcp(owner.accountId, call(81, "generalize", { project_id: projectId })));
    expect(general.summary).toMatchObject({ joined: { lines: expect.any(Number) as unknown } });
    expect(general.proposalId).toBeUndefined();
    const readerGeneralize = await mcp(reader.accountId, call(82, "generalize", { project_id: projectId, propose: true }));
    expect((readerGeneralize?.result as { isError?: boolean }).isError).toBe(true);

    // Förslag: flytta stenen och lägg till en stig. Kartan ändras inte; förslaget har källan AI.
    const proposedRaw = await mcp(owner.accountId, call(9, "propose_changes", { project_id: projectId, note: "Stenen ligger 2 m fel enligt lasern",
      operations: [{ op: "move", key: stone.key, dx: 2, dy: 0 }, { op: "add", symbol: "505", points: [[40, 55], [45, 58], [50, 60]] }] }));
    const proposed = textOf(proposedRaw);
    expect(proposed).toMatchObject({ changes: 2 });
    const list = await listMapProjectProposals(db, { ...owner.proof, projectId });
    expect(list.status === "ok" && list.list.proposals).toMatchObject([{ source: "AI", status: "OPEN", note: "Stenen ligger 2 m fel enligt lasern" }]);
    const view = await readMapProject(db, { ...owner.proof, projectId });
    expect(view.status === "ok" && view.view.changedObjects).toBe(0);
    // Fel i förslaget: okänd symbol och ett för stort område ger ett fel utan förslag.
    const bad = await mcp(owner.accountId, call(10, "propose_changes", { project_id: projectId, note: "x",
      operations: [{ op: "add", symbol: "999.9", points: [[0, 0]] }, { op: "add", symbol: "505", points: [[0, 0], [100, 0]] }] }));
    expect((bad?.result as { isError?: boolean }).isError).toBe(true);
    // Läsa kan inte föreslå; den som inte är medlem ser inget.
    const readerTry = await mcp(reader.accountId, call(11, "propose_changes", { project_id: projectId, note: "x", operations: [{ op: "delete", key: stone.key }] }));
    expect((readerTry?.result as { isError?: boolean }).isError).toBe(true);
    const stranger = await registerTestAccount(db);
    const strangerTry = await mcp(stranger.accountId, call(12, "map_overview", { project_id: projectId }));
    expect((strangerTry?.result as { isError?: boolean }).isError).toBe(true);

    // AI-läget (ägaren 2026-11-12): bara läsa avvisar förslag; självständigt inför ändringarna direkt som ett godkänt AI-förslag.
    expect(textOf(await mcp(owner.accountId, call(20, "map_overview", { project_id: projectId }))).aiMode).toBe("PROPOSE");
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "READ" } })).status).toBe("ok");
    const readOnly = await mcp(owner.accountId, call(21, "propose_changes", { project_id: projectId, note: "x", operations: [{ op: "move", key: stone.key, dx: 1, dy: 0 }] }));
    expect((readOnly?.result as { isError?: boolean }).isError).toBe(true);
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "AUTONOMOUS" } })).status).toBe("ok");
    const direct = textOf(await mcp(owner.accountId, call(22, "propose_changes", { project_id: projectId, note: "En stig till",
      operations: [{ op: "add", symbol: "505", points: [[60, 55], [65, 58]] }] })));
    expect(direct).toMatchObject({ changes: 1, applied: 1, conflicts: 0 });
    const after = await readMapProject(db, { ...owner.proof, projectId });
    expect(after.status === "ok" && after.view.changedObjects).toBe(1);
    expect(after.status === "ok" && after.view.aiMode).toBe("AUTONOMOUS");
    const decidedList = await listMapProjectProposals(db, { ...owner.proof, projectId });
    expect(decidedList.status === "ok" && decidedList.list.proposals.find(row => row.note === "En stig till")).toMatchObject({ source: "AI", status: "ACCEPTED" });
    // Ny tom karta: kontot blir ägare, AI-läget är förslag.
    const made = textOf(await mcp(owner.accountId, call(23, "create_map_project", { name: "Provblad", center_e: 674000, center_n: 6575000, width_m: 800, height_m: 600 })));
    expect(typeof made.projectId).toBe("string");
    expect(textOf(await mcp(owner.accountId, call(24, "map_overview", { project_id: made.projectId as string }))).aiMode).toBe("PROPOSE");

    // Kontot tas bort: kopplingarna och kartjobben följer med.
    await connect(stranger.proof);
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, stranger.accountId, new Date()));
    expect(await db.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.accountId, stranger.accountId))).toEqual([]);
    expect(await db.select().from(schema.mapProjectJobs).where(eq(schema.mapProjectJobs.accountId, stranger.accountId))).toEqual([]);
  }, 60_000);
});
