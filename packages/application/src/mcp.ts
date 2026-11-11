import { randomUUID } from "node:crypto";
import { MCP_MAX_IMAGE_SIDE_PX, MCP_PROPOSAL_MAX_OPERATIONS, MCP_PROPOSAL_MAX_SIDE_M, MCP_TRAINING_RASTERS, mcpToolInputSchemas } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { requireMapProjectForAccount } from "./map-project-access";
import { readGeoRaster } from "./map-project-geo-jobs";
import { mapProjectAreaViews } from "./map-project-areas";
import { runMapJobAndWait, type MapJobKind, type MapJobOutcome } from "./map-project-jobs";
import { createMapProjectProposalAsAi, openProposalCount } from "./map-project-proposals";
import { listMapProjectsForAccount } from "./map-projects";
import { callMcpCourseTool, MCP_COURSE_TOOL_NAMES, MCP_COURSE_TOOLS } from "./mcp-course-setting";
import type { OauthScope } from "./oauth";

/**
 * ADR-0219 (K2): MCP-servern (Streamable HTTP utan sessioner; svaren är JSON). Verktygen ser och läser kartprojekten som
 * kontot är medlem i och lämnar förslag; inget ändras direkt i en karta. Det tunga (grundfilen, bilder, kontroller) görs som
 * kartjobb i utskriftsarbetaren.
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

type JsonRpcId = string | number | null;
export type McpResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };
type ToolResult = { content: Content[]; isError?: boolean };

const projectId = { project_id: { type: "string", description: "Kartprojektets id (från list_map_projects)" } };
const area = { area: { type: "object", description: "Område i kartans mm med y uppåt (som Mapper). Utelämnat = hela kartan.",
  properties: { min_x: { type: "number" }, min_y: { type: "number" }, max_x: { type: "number" }, max_y: { type: "number" } },
  required: ["min_x", "min_y", "max_x", "max_y"] } };
const points = { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
  description: "Punkter [x, y] i kartans mm med y uppåt" };

export const MCP_TOOLS = [
  { name: "list_map_projects", title: "Mina kartprojekt", description: "Kartprojekten som kontot är medlem i: id, namn, roll, grundfil och antal ändringar.",
    inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "map_overview", title: "Översikt över en karta", description: "Kartans skala, utbredning i mm och meter, georeferens, symbolerna som används (nummer, namn, antal), delområden och öppna förslag. Börja här.",
    inputSchema: { type: "object", properties: { ...projectId }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "render_view", title: "Bild av kartan", description: `En bild (PNG, högst ${MCP_MAX_IMAGE_SIDE_PX} px) av kartan med projektets ändringar, i kartans färger, med ett rutnät i kartans mm. Markera objekt med deras nycklar och dölj symboler för att se under dem.`,
    inputSchema: { type: "object", properties: { ...projectId, ...area, width_px: { type: "integer", minimum: 200, maximum: MCP_MAX_IMAGE_SIDE_PX },
      grid: { type: "boolean", description: "Rutnätet (förval ja)" }, highlight: { type: "array", items: { type: "string" }, maxItems: 200, description: "Objektnycklar att markera" },
      hide_symbols: { type: "array", items: { type: "string" }, maxItems: 100, description: "Symbolnummer att dölja, t.ex. 406" } }, required: ["project_id"] },
    annotations: { readOnlyHint: true } },
  { name: "render_compare", title: "Jämför grundfilen och ändringarna", description: "Grundfilen (vänster) och kartan med projektets ändringar (höger) i samma skala och med samma rutnät. Ortofoto kommer med underlagen senare.",
    inputSchema: { type: "object", properties: { ...projectId, ...area, width_px: { type: "integer", minimum: 200, maximum: MCP_MAX_IMAGE_SIDE_PX / 2 } }, required: ["project_id"] },
    annotations: { readOnlyHint: true } },
  { name: "training_labels", title: "Kartan som klassraster", description: "Träningsdata: kartan som klassraster (PNG) i kartans plana koordinater (t.ex. SWEREF 99 TM), norr upp, en cell per `cell` meter (förval 2). R = marken (1 ödemark 403, 2 ödemark med träd 404, 3 öppen 401, 4 öppen med träd 402, 5–7 grönt 406/408/410, 8 berg i dagen 214, 9 odlat, 10 stenig mark, 11 tomtmark 520, 12 hårdgjort 501, 13 byggnad, 14 vatten). G = linjer i låga fyra bitar (1–3 kurvor 101–103, 4 opasserbar brant, 5 brant, 6 vattendrag och dike, 7 smal sankmark, 8 väg och stig, 9 jordbrant) plus bit 16 sankmark 307–308, 32 otydlig sankmark 310, 64 och 128 undervegetation 407 och 409. B = punkter (1 punkthöjd, 2 avlång punkthöjd, 3 grop, 4 sten, 5 stor sten, 6 stengrupp, 7 stenig mark, 8 liten sankmark, 9 träd, 10 liten otydlig sankmark). Högst 2000 celler per sida.",
    inputSchema: { type: "object", properties: { ...projectId, min_e: { type: "number" }, min_n: { type: "number" }, max_e: { type: "number" }, max_n: { type: "number" },
      cell: { type: "number", minimum: 0.5, maximum: 10 } }, required: ["project_id", "min_e", "min_n", "max_e", "max_n"] }, annotations: { readOnlyHint: true } },
  { name: "training_raster", title: "Laserkörningens raster", description: "Träningsdata: ett raster (PNG) ur projektets senaste klara laserkörning (eller job_id) med världsfilen som text. hojd = markens höjd i cm + 10 000 som 24 bitar (R·65536 + G·256 + B), fuktdjup = höjden över fuktstråket i steg om 2 cm (R) och lutningen i steg om 0,1° (B), vegetationsklasser = Karttapullautins klass (R), relief och skuggning = bilder. Ur punktmolnet (2 m): lasveg = vegetationens höjd i steg om 0,2 m (R), markträffarnas andel (G) och andelen 1–3 m (B); lasmark = andelen 0,3–1 m (R), markträffarnas intensitet / 64 (G) och spridning i cm (B); laskron = andelen över 3 m (R) och antal punkter (G).",
    inputSchema: { type: "object", properties: { ...projectId, name: { type: "string", enum: [...MCP_TRAINING_RASTERS] }, job_id: { type: "string" } }, required: ["project_id", "name"] },
    annotations: { readOnlyHint: true } },
  { name: "list_objects", title: "Objekten i kartan", description: "Objekten (i ett område och/eller med vissa symbolnummer): nyckel, symbol, slag, omslutande ruta och förenklad geometri i kartans mm. Nyckeln används i propose_changes och render_view.",
    inputSchema: { type: "object", properties: { ...projectId, ...area, symbols: { type: "array", items: { type: "string" }, maxItems: 50 },
      limit: { type: "integer", minimum: 1, maximum: 500 }, offset: { type: "integer", minimum: 0 } }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "norm_check", title: "Normkontroll", description: "Den grundläggande kontrollen (tomma objekt, dubbletter, okända symboler) och normkontrollen efter ISOM 2017-2 eller ISSprOM 2019-2 (kartans skala): kurvavstånd, korta linjer, små och tunna ytor, små knollar, passager och öppningar, med regel, mått, gräns och plats i kartans mm.",
    inputSchema: { type: "object", properties: { ...projectId, ...area }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "generalize", title: "Generalisering", description: `Räknar fram generaliseringen i ett område: förenkla täta linjer och ytor (simplify_mm, förval 0,1 mm), ta bort det som är mindre än normen (remove_small), foga ihop linjer med samma symbol vars ändar möts (join_lines) och ta bort ytor inuti en likadan yta (remove_inside); allt är på om inget anges. Med propose: true lämnas ändringarna som ett förslag (högst ${MCP_PROPOSAL_MAX_OPERATIONS}; välj annars ett mindre område) som en ägare godkänner.`,
    inputSchema: { type: "object", properties: { ...projectId, ...area, simplify_mm: { type: "number", minimum: 0, maximum: 0.5 },
      remove_small: { type: "boolean" }, join_lines: { type: "boolean" }, remove_inside: { type: "boolean" }, propose: { type: "boolean" },
      note: { type: "string", maxLength: 500 } }, required: ["project_id"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "propose_changes", title: "Föreslå ändringar", description: `Lämnar ett förslag som en ägare i O-Tid godkänner eller avvisar; kartan ändras aldrig direkt. Högst ${MCP_PROPOSAL_MAX_OPERATIONS} operationer inom ${MCP_PROPOSAL_MAX_SIDE_M} × ${MCP_PROPOSAL_MAX_SIDE_M} m. Operationer: add (symbol och punkter; en punkt för punktsymboler, minst tre för ytor), move (key, dx, dy i mm), reshape (key och nya punkter, raka sträckor), change_symbol (key och symbol) och delete (key). Skriv en kort motivering i note.`,
    inputSchema: { type: "object", properties: { ...projectId, note: { type: "string", maxLength: 500, description: "Motivering som visas för den som granskar" },
      operations: { type: "array", minItems: 1, maxItems: MCP_PROPOSAL_MAX_OPERATIONS, items: { type: "object", properties: {
        op: { type: "string", enum: ["add", "move", "reshape", "change_symbol", "delete"] }, key: { type: "string" }, symbol: { type: "string" },
        points, dx: { type: "number" }, dy: { type: "number" }, angle: { type: "number" } }, required: ["op"] } } },
      required: ["project_id", "note", "operations"] }, annotations: { readOnlyHint: false, destructiveHint: false } }
] as const;

const inputs = mcpToolInputSchemas;

const text = (value: unknown): Content => ({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) });
const toolError = (message: string): ToolResult => ({ content: [text(message)], isError: true });

function jobFailure(outcome: Exclude<MapJobOutcome, { status: "done" }>): ToolResult {
  if (outcome.status === "throttled") return toolError("För många anrop just nu (högst 30 kartjobb per minut och två samtidigt). Vänta en stund.");
  if (outcome.status === "timeout") return toolError("Kartjobbet tog för lång tid. Försök med ett mindre område.");
  return toolError(`Kartjobbet misslyckades: ${outcome.error}`);
}

/** Prövar att kontot får se (eller föreslå i) projektet. */
async function access(db: Database, accountId: string, project: string, need: "view" | "propose"): Promise<string | undefined> {
  const result = await db.transaction(tx => requireMapProjectForAccount(tx, accountId, project, new Date(), need, false));
  if (result.status === "ok") return undefined;
  if (result.status === "forbidden") return need === "propose" ? "Kontot kan inte föreslå i projektet (rollen Läsa eller projektet är avslutat)." : "Ingen behörighet.";
  return "Projektet finns inte eller kontot är inte medlem.";
}

async function job(db: Database, accountId: string, project: string, kind: MapJobKind, request: Record<string, unknown>, wait: JobWait): Promise<MapJobOutcome> {
  return runMapJobAndWait(db, { accountId, projectId: project, kind, request }, wait);
}

export interface JobWait { timeoutMs?: number; pollMs?: number }

/** Ett verktygsanrop för kontot. */
export async function callMcpTool(db: Database, accountId: string, name: string, args: unknown, wait: JobWait = {}): Promise<ToolResult> {
  if (name === "list_map_projects") {
    const list = await db.transaction(tx => listMapProjectsForAccount(tx, accountId));
    return { content: [text({ projects: list.projects.map(project => ({ projectId: project.projectId, name: project.name, role: project.role,
      status: project.status, club: project.club?.name ?? null, baseFile: project.base.fileName, format: project.base.format,
      changedObjects: project.changedObjects })) })] };
  }
  const schemaFor = inputs[name as keyof typeof inputs];
  if (!schemaFor) return toolError(`Okänt verktyg ${name}`);
  const parsed = schemaFor.safeParse(args ?? {});
  if (!parsed.success) return toolError(`Ogiltiga argument: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "(argumenten)"}: ${issue.message}`).join("; ")}`);
  const input = parsed.data as { project_id: string } & Record<string, unknown>;
  const denied = await access(db, accountId, input.project_id, name === "propose_changes" || (name === "generalize" && input.propose === true) ? "propose" : "view");
  if (denied) return toolError(denied);
  switch (name) {
    case "map_overview": {
      const outcome = await job(db, accountId, input.project_id, "OVERVIEW", {}, wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      const extra = await db.transaction(async tx => ({ areas: (await mapProjectAreaViews(tx, input.project_id)).map(row => ({ name: row.name,
        status: row.status, assignee: row.assignee?.name ?? null, revisedOn: row.revisedOn })), openProposals: await openProposalCount(tx, input.project_id) }));
      return { content: [text({ ...(outcome.result as object), ...extra })] };
    }
    case "render_view":
    case "render_compare": {
      const request = { area: input.area, widthPx: input.width_px, grid: input.grid, highlight: input.highlight, hideSymbols: input.hide_symbols };
      const outcome = await job(db, accountId, input.project_id, name === "render_view" ? "RENDER" : "COMPARE", strip(request), wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      if (!outcome.image) return toolError("Bilden saknas");
      return { content: [{ type: "image", data: Buffer.from(outcome.image).toString("base64"), mimeType: "image/png" }, text(outcome.result)] };
    }
    case "training_labels": {
      const outcome = await job(db, accountId, input.project_id, "RENDER", { labels: { minE: input.min_e, minN: input.min_n, maxE: input.max_e, maxN: input.max_n,
        ...(typeof input.cell === "number" ? { cell: input.cell } : {}) } }, wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      if (!outcome.image) return toolError("Bilden saknas");
      return { content: [{ type: "image", data: Buffer.from(outcome.image).toString("base64"), mimeType: "image/png" }, text(outcome.result)] };
    }
    case "training_raster": {
      const raster = await readGeoRaster(db, input.project_id, String(input.name), typeof input.job_id === "string" ? input.job_id : undefined);
      if (!raster) return toolError("Projektet har ingen klar laserkörning med det rastret (hojd finns från geo-arbetarens version 11).");
      return { content: [{ type: "image", data: raster.png.toString("base64"), mimeType: "image/png" }, text({ jobId: raster.jobId, name: input.name, worldFile: raster.world })] };
    }
    case "list_objects": {
      const outcome = await job(db, accountId, input.project_id, "OBJECTS", strip({ area: input.area, symbols: input.symbols, limit: input.limit, offset: input.offset }), wait);
      return outcome.status === "done" ? { content: [text(outcome.result)] } : jobFailure(outcome);
    }
    case "norm_check": {
      const outcome = await job(db, accountId, input.project_id, "CHECK", strip({ area: input.area }), wait);
      return outcome.status === "done" ? { content: [text(outcome.result)] } : jobFailure(outcome);
    }
    case "generalize": {
      const outcome = await job(db, accountId, input.project_id, "GENERALIZE", strip({ area: input.area, simplifyMm: input.simplify_mm,
        removeSmall: input.remove_small, joinLines: input.join_lines, removeInside: input.remove_inside, propose: input.propose }), wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      const result = outcome.result as { summary: unknown; changes: unknown[]; edits?: unknown[]; errors?: string[] };
      if (result.errors) return toolError(`Förslaget lämnades inte:\n- ${result.errors.join("\n- ")}`);
      if (!input.propose || !result.edits || result.edits.length === 0) return { content: [text({ summary: result.summary, changes: result.changes })] };
      const created = await createMapProjectProposalAsAi(db, { accountId, projectId: input.project_id, request: { formatVersion: 1,
        requestId: randomUUID(), note: typeof input.note === "string" && input.note ? input.note.slice(0, 500) : "Generalisering (AI)", edits: result.edits } });
      if (created.status !== "created") return toolError(`Förslaget lämnades inte (${created.status}).`);
      return { content: [text({ summary: result.summary, proposalId: created.proposal.proposalId, changes: created.proposal.edits.length,
        message: "Förslaget ligger i projektet och väntar på att en ägare godkänner eller avvisar det." })] };
    }
    case "propose_changes": {
      const outcome = await job(db, accountId, input.project_id, "PROPOSE", { operations: input.operations }, wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      const result = outcome.result as { edits?: unknown[]; errors?: string[] };
      if (result.errors) return toolError(`Förslaget lämnades inte:\n- ${result.errors.join("\n- ")}`);
      const created = await createMapProjectProposalAsAi(db, { accountId, projectId: input.project_id, request: { formatVersion: 1,
        requestId: randomUUID(), note: typeof input.note === "string" ? input.note.slice(0, 500) : "", edits: result.edits } });
      if (created.status !== "created") return toolError(`Förslaget lämnades inte (${created.status}).`);
      return { content: [text({ proposalId: created.proposal.proposalId, changes: created.proposal.edits.length,
        message: "Förslaget ligger i projektet och väntar på att en ägare godkänner eller avvisar det." })] };
    }
    default: return toolError(`Okänt verktyg ${name}`);
  }
}

function strip(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/**
 * Ett JSON-RPC-meddelande från klienten. Notiser (utan id) ger null (HTTP 202). Okända metoder ger felet -32601.
 */
export async function handleMcpMessage(db: Database, accountId: string, message: unknown, wait: JobWait = {},
  scopes: readonly OauthScope[] = ["kartprojekt"]): Promise<McpResponse | null> {
  const maps = scopes.includes("kartprojekt"), courses = scopes.includes("banlaggning");
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Ogiltig begäran (ett JSON-RPC-meddelande i taget)" } };
  }
  const { id, method, params } = message as { id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> };
  if (typeof method !== "string") return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Metod saknas" } };
  if (id === undefined) return null;
  const ok = (result: unknown): McpResponse => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({ protocolVersion: (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: "O-Tid", version: "1.1.0" },
        instructions: [maps ? "Kartprojekt (orienteringskartor i Mapper-format): koordinater är kartans mm med y uppåt. Börja med list_map_projects och map_overview, titta med render_view, läs objekt med list_objects. Ändringar lämnas bara som förslag (propose_changes) som en människa godkänner." : "",
          courses ? "Banläggning: list_course_settings och course_overview visar banorna med målnivå, kontroller och sträckor. Granska nivån sträcka för sträcka (svensk orienterings nivåtrappa Grön–Svart: vägval, avstånd mellan ledstänger, kontrollernas svårighet) och lämna bara notiser (add_course_note) som banläggaren tar ställning till. Rör aldrig resultat eller tävlingen." : ""]
          .filter(Boolean).join(" ") });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: [...(maps ? MCP_TOOLS : []), ...(courses ? MCP_COURSE_TOOLS : [])] });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      if (MCP_COURSE_TOOL_NAMES.has(name)) {
        return ok(courses ? await callMcpCourseTool(db, accountId, name, params?.arguments, new Date(), wait)
          : { content: [{ type: "text", text: "Kopplingen har inte behörigheten banlaggning. Ta bort kopplingen under Mitt konto → AI-kopplingar och koppla igen." }], isError: true });
      }
      if (!maps) return ok({ content: [{ type: "text", text: "Kopplingen har inte behörigheten kartprojekt." }], isError: true });
      return ok(await callMcpTool(db, accountId, name, params?.arguments, wait));
    }
    default: return { jsonrpc: "2.0", id, error: { code: -32601, message: `Okänd metod ${method}` } };
  }
}
