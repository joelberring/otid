import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { newContext, password, registerAccount, unique, warmRoute } from "./helpers";

/**
 * ADR-0219 (K2): AI-kopplingen som Claude använder den. Metadata, registrering, godkännandet i webbläsaren (den som inte är
 * inloggad loggar in och kommer tillbaka), nyckeln med PKCE och MCP på /api/mcp: verktygen listas, en bild av kartan ritas av
 * utskriftsarbetaren och ett förslag lämnas. Kopplingen syns under Mitt konto och kan tas bort; nyckeln slutar då gälla.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

test("AI-koppling: godkänn i O-Tid, MCP ser kartan och lämnar ett förslag, kopplingen tas bort", async ({ browser, baseURL, request }) => {
  test.setTimeout(300_000);
  const email = `claude.${unique()}@exempel.se`;
  const owner = await registerAccount(browser, email, "Clara Kartritare");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Skogen", "x-otid-file-name": "Skogen.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;

  // Metadata och 401 utan nyckel (så hittar Claude inloggningen).
  const resource = await (await request.get("/.well-known/oauth-protected-resource")).json() as { resource: string; authorization_servers: string[] };
  expect(resource.resource).toBe(`${baseURL}/api/mcp`);
  const server = await (await request.get("/.well-known/oauth-authorization-server")).json() as Record<string, string>;
  expect(server).toMatchObject({ authorization_endpoint: `${baseURL}/oauth/authorize`, token_endpoint: `${baseURL}/api/oauth/token` });
  const anonymous = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["www-authenticate"]).toContain("resource_metadata=");

  const registered = await request.post("/api/oauth/register", { data: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } });
  expect(registered.status(), await registered.text()).toBe(201);
  const clientId = (await registered.json() as { client_id: string }).client_id;
  const verifier = randomBytes(40).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: "S256", scope: "kartprojekt banlaggning", state: "tillstand-1", resource: resource.resource })}`;

  // Inte inloggad: logga in och kom tillbaka till godkännandet.
  const page = await (await newContext(browser)).newPage();
  let callback: string | undefined;
  await page.route("https://claude.ai/**", route => { callback = route.request().url(); return route.fulfill({ status: 200, body: "ok" }); });
  await page.goto(authorize);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL(/\/organizer$/);
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.waitForURL(/\/oauth\/authorize\?/);
  const consent = page.getByTestId("oauth-consent");
  await expect(consent).toContainText("Claude vill få åtkomst till ditt O-Tid-konto.");
  await expect(consent).toContainText("Svaret skickas till claude.ai.");
  // Ägaren 2026-11-08: båda behörigheterna står i godkännandet.
  await expect(consent).toContainText("se de kartprojekt du är medlem i");
  await expect(consent).toContainText("lämna notiser i banläggningen");
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/ai-koppling-godkann.png`, fullPage: true });
  await consent.getByRole("button", { name: "Tillåt" }).click();
  await expect.poll(() => callback, { timeout: 20_000 }).toBeTruthy();
  const back = new URL(callback!);
  expect(back.searchParams.get("state")).toBe("tillstand-1");

  const token = await request.post("/api/oauth/token", { form: { grant_type: "authorization_code", code: back.searchParams.get("code")!,
    redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: resource.resource } });
  expect(token.status(), await token.text()).toBe(200);
  const access = (await token.json() as { access_token: string }).access_token;
  const mcp = (body: object) => request.post("/api/mcp", { headers: { authorization: `Bearer ${access}`, accept: "application/json, text/event-stream" }, data: body });

  const init = await (await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "e2e", version: "1" } } })).json() as { result: { serverInfo: { name: string } } };
  expect(init.result.serverInfo.name).toBe("O-Tid");
  expect((await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).status()).toBe(202);
  const tools = await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json() as { result: { tools: { name: string }[] } };
  expect(tools.result.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(["render_view", "course_overview", "add_course_note"]));

  // En bild av kartan: kartjobbet görs av utskriftsarbetaren.
  const rendered = await (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "render_view",
    arguments: { project_id: projectId, width_px: 500 } } })).json() as { result: { content: { type: string; data?: string }[]; isError?: boolean } };
  expect(rendered.result.isError, JSON.stringify(rendered).slice(0, 300)).toBeFalsy();
  expect(rendered.result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(Buffer.from(rendered.result.content[0]!.data!, "base64").subarray(1, 4).toString()).toBe("PNG");

  // Ett förslag: en stig nära stenen. Projektet visar ett öppet förslag från AI.
  const proposed = await (await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "propose_changes", arguments: { project_id: projectId,
    note: "Stig enligt flygbilden", operations: [{ op: "add", symbol: "505", points: [[40, 55], [45, 58], [50, 60]] }] } } })).json() as
    { result: { isError?: boolean; content: { text: string }[] } };
  expect(proposed.result.isError, proposed.result.content[0]?.text).toBeFalsy();
  await page.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(page.getByTestId("map-project-proposals")).toContainText("AI · 1 ändring");
  await expect(page.getByTestId("map-project-proposals")).toContainText("Stig enligt flygbilden");

  // Mitt konto → AI-kopplingar: kopplingen syns och tas bort; nyckeln slutar gälla.
  await page.goto("/konto");
  const connections = page.getByTestId("ai-connections");
  await expect(connections).toContainText("Claude");
  await expect(page.getByTestId("mcp-address")).toHaveText(`${baseURL}/api/mcp`);
  await connections.getByRole("button", { name: "Ta bort" }).click();
  await expect(page.getByText("Kopplingen är borttagen.")).toBeVisible();
  expect((await mcp({ jsonrpc: "2.0", id: 5, method: "tools/list" })).status()).toBe(401);
});
