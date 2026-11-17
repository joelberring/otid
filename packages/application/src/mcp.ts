import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  MCP_MAX_IMAGE_SIDE_PX, MCP_OBJECTS_DEFAULT_POINTS, MCP_OBJECTS_MAX_POINTS, MCP_OBJECTS_MAX_POINTS_PER_OBJECT, MCP_PROPOSAL_MAX_OPERATIONS, MCP_PROPOSAL_MAX_SIDE_M,
  MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS, MCP_TRAINING_RASTERS, mcpCreateMapProjectSchema, mcpToolInputSchemas
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { aiGate, mapProjectAllows, requireMapProjectForAccount } from "./map-project-access";
import { readGeoRaster } from "./map-project-geo-jobs";
import { decodeRgbaPng, rgbaPng } from "./map-project-job-labels";
import { createMapProjectNewForAccount } from "./map-project-new";
import { mapProjectAreaViews } from "./map-project-areas";
import { runMapJobAndWait, type MapJobKind, type MapJobOutcome } from "./map-project-jobs";
import type { RenderUnderlaySource } from "./map-project-job-run";
import { createMapProjectProposalAsAi, openProposalCount } from "./map-project-proposals";
import { listMapProjectsForAccount } from "./map-projects";
import { callMcpBaseMapTool, MCP_BASE_MAP_TOOL, type McpBaseMapOptions } from "./mcp-base-map";
import { callMcpCourseTool, MCP_COURSE_TOOL_NAMES, MCP_COURSE_TOOLS } from "./mcp-course-setting";
import { callMcpLaserTool, MCP_LASER_TOOL_NAMES, MCP_LASER_TOOLS, type McpLaserOptions } from "./mcp-laser";
import type { OauthScope } from "./oauth";
import { mcpText } from "./mcp-text";

/**
 * ADR-0219 (K2): MCP-servern (Streamable HTTP utan sessioner; svaren är JSON). Verktygen ser och läser kartprojekten som
 * kontot är medlem i och lämnar förslag; inget ändras direkt i en karta. Det tunga (grundfilen, bilder, kontroller) görs som
 * kartjobb i utskriftsarbetaren.
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

type JsonRpcId = string | number | null;
export type McpResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" | "image/webp" };
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
  { name: "create_map_project", title: "Ny tom karta", description: "Skapar ett nytt eget kartprojekt med en tom karta över en rektangel: mittpunkt i SWEREF 99 TM (center_e, center_n), bredd och höjd i meter, skala 10000 (förval) eller 15000 för en skogskarta (ISOM 2017-2), 4000 eller 3000 för en sprintkarta (ISSprOM 2019-2; grundkartan får då sprintnormens symboler och OpenStreetMaps belagda vägar som ytor med antagen bredd). Kontot blir ägare. Laserkörningen startas med start_laser_job och grundkartan läggs in med apply_base_map.",
    inputSchema: { type: "object", properties: { name: { type: "string", maxLength: 120 }, center_e: { type: "number" }, center_n: { type: "number" },
      width_m: { type: "number", minimum: 100, maximum: 15000 }, height_m: { type: "number", minimum: 100, maximum: 15000 }, scale: { type: "integer", enum: [10000, 15000, 4000, 3000] } },
      required: ["name", "center_e", "center_n", "width_m", "height_m"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "map_overview", title: "Översikt över en karta", description: "Kartans skala, utbredning i mm och meter, georeferens, symbolerna som används (nummer, namn, antal), delområden och öppna förslag. Börja här.",
    inputSchema: { type: "object", properties: { ...projectId }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "render_view", title: "Bild av kartan", description: `En bild (PNG, högst ${MCP_MAX_IMAGE_SIDE_PX} px) av kartan med projektets ändringar, i kartans färger, med ett rutnät i kartans mm. Markera objekt med deras nycklar och dölj symboler för att se under dem.`,
    inputSchema: { type: "object", properties: { ...projectId, ...area, width_px: { type: "integer", minimum: 200, maximum: MCP_MAX_IMAGE_SIDE_PX },
      grid: { type: "boolean", description: "Rutnätet (förval ja)" }, highlight: { type: "array", items: { type: "string" }, maxItems: 200, description: "Objektnycklar att markera" },
      hide_symbols: { type: "array", items: { type: "string" }, maxItems: 100, description: "Symbolnummer att dölja, t.ex. 406" },
      underlays: { type: "array", items: { type: "string" }, maxItems: 4, description: "Underlag att rita under kartan, med en del av namnet (t.ex. «ortofoto», «– IR», «skuggning»); svaret och ett fel listar projektets underlag. Det sista ritas överst." },
      map_opacity: { type: "number", minimum: 0, maximum: 1, description: "Kartans täckning över underlagen (förval 0,5; 0 = bara underlagen)" } }, required: ["project_id"] },
    annotations: { readOnlyHint: true } },
  { name: "render_compare", title: "Jämför grundfilen och ändringarna", description: "Grundfilen (vänster) och kartan med projektets ändringar (höger) i samma skala och med samma rutnät. Ortofoto kommer med underlagen senare.",
    inputSchema: { type: "object", properties: { ...projectId, ...area, width_px: { type: "integer", minimum: 200, maximum: MCP_MAX_IMAGE_SIDE_PX / 2 } }, required: ["project_id"] },
    annotations: { readOnlyHint: true } },
  { name: "training_labels", title: "Kartan som klassraster", description: "Träningsdata: kartan som klassraster (PNG) i kartans plana koordinater (t.ex. SWEREF 99 TM), norr upp, en cell per `cell` meter (förval 2). R = marken (1 ödemark 403, 2 ödemark med träd 404, 3 öppen 401, 4 öppen med träd 402, 5–7 grönt 406/408/410, 8 berg i dagen 214, 9 odlat, 10 stenig mark, 11 tomtmark 520, 12 hårdgjort 501, 13 byggnad, 14 vatten, 15 opasserbar vegetation 411). G = linjer i låga fyra bitar (1–3 kurvor 101–103, 4 opasserbar brant, 5 brant, 6 vattendrag och dike, 7 smal sankmark, 8 väg och stig, 9 jordbrant, 10 passerbar mur och staket, 11 opasserbar mur och staket, 12 opasserbar häck) plus bit 16 sankmark 307–308, 32 otydlig sankmark 310, 64 och 128 undervegetation 407 och 409. B = punkter (1 punkthöjd, 2 avlång punkthöjd, 3 grop, 4 sten, 5 stor sten, 6 stengrupp, 7 stenig mark, 8 liten sankmark, 9 träd, 10 liten otydlig sankmark). Högst 2000 celler per sida.",
    inputSchema: { type: "object", properties: { ...projectId, min_e: { type: "number" }, min_n: { type: "number" }, max_e: { type: "number" }, max_n: { type: "number" },
      cell: { type: "number", minimum: 0.5, maximum: 10 } }, required: ["project_id", "min_e", "min_n", "max_e", "max_n"] }, annotations: { readOnlyHint: true } },
  { name: "training_raster", title: "Laserkörningens raster", description: "Träningsdata: ett raster (PNG; relief och skuggning är WebP från nyare körningar) ur projektets senaste klara laserkörning (eller job_id) med världsfilen som text. hojd = markens höjd i cm + 10 000 som 24 bitar (R·65536 + G·256 + B), fuktdjup = höjden över fuktstråket i steg om 2 cm (R) och lutningen i steg om 0,1° (B), vegetationsklasser = Karttapullautins klass (R), relief och skuggning = bilder. Ur punktmolnet (2 m): lasveg = vegetationens höjd i steg om 0,2 m (R), markträffarnas andel (G) och andelen 1–3 m (B); lasmark = andelen 0,3–1 m (R), markträffarnas intensitet / 64 (G) och spridning i cm (B); laskron = andelen över 3 m (R) och antal punkter (G).",
    inputSchema: { type: "object", properties: { ...projectId, name: { type: "string", enum: [...MCP_TRAINING_RASTERS] }, job_id: { type: "string" },
      min_e: { type: "number", description: "Utsnitt i SWEREF 99 TM (alla fyra), bara för PNG-rastren; högst 2 000 bildpunkter per sida" }, min_n: { type: "number" },
      max_e: { type: "number" }, max_n: { type: "number" } }, required: ["project_id", "name"] },
    annotations: { readOnlyHint: true } },
  { name: "list_objects", title: "Objekten i kartan", description: `Objekten (i ett område, med vissa symbolnummer och/eller vissa nycklar): nyckel, symbol, slag, omslutande ruta och geometri i kartans mm. Geometrin är glesad till högst ${MCP_OBJECTS_DEFAULT_POINTS} punkter per objekt (vertices säger hur många den har); be om hela med max_points (högst ${MCP_OBJECTS_MAX_POINTS_PER_OBJECT}) bara för de objekt som ska formas om, helst utpekade med keys. Ett svar har högst ${MCP_OBJECTS_MAX_POINTS} punkter; truncated och nextOffset säger att mer finns. brief: true utelämnar namn, ruta och ändrad-märke. För att klippa en yta mot andra ytor behövs ingen geometri alls: använd subtract i propose_changes. Nyckeln används i propose_changes och render_view.`,
    inputSchema: { type: "object", properties: { ...projectId, ...area, symbols: { type: "array", items: { type: "string" }, maxItems: 50 },
      keys: { type: "array", items: { type: "string" }, maxItems: 100, description: "Bara de här objekten (nycklar ur ett tidigare svar)" },
      max_points: { type: "integer", minimum: 2, maximum: MCP_OBJECTS_MAX_POINTS_PER_OBJECT, description: `Punkter per objekt (förval ${MCP_OBJECTS_DEFAULT_POINTS})` },
      brief: { type: "boolean", description: "Kortare svar: bara nyckel, symbol, slag och geometri" },
      limit: { type: "integer", minimum: 1, maximum: 500 }, offset: { type: "integer", minimum: 0 } }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "norm_check", title: "Normkontroll", description: "Den grundläggande kontrollen (tomma objekt, dubbletter, okända symboler) och normkontrollen efter ISOM 2017-2 eller ISSprOM 2019-2 (kartans skala): kurvavstånd, korta linjer, små och tunna ytor, små knollar, passager och öppningar, med regel, mått, gräns och plats i kartans mm.",
    inputSchema: { type: "object", properties: { ...projectId, ...area }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "generalize", title: "Generalisering", description: `Räknar fram generaliseringen i ett område: förenkla täta linjer och ytor (simplify_mm, förval 0,1 mm), ta bort det som är mindre än normen (remove_small), foga ihop linjer med samma symbol vars ändar möts (join_lines) och ta bort ytor inuti en likadan yta (remove_inside); allt är på om inget anges. Med propose: true lämnas ändringarna som ett förslag (högst ${MCP_PROPOSAL_MAX_OPERATIONS}; välj annars ett mindre område) som en ägare godkänner.`,
    inputSchema: { type: "object", properties: { ...projectId, ...area, simplify_mm: { type: "number", minimum: 0, maximum: 0.5 },
      remove_small: { type: "boolean" }, join_lines: { type: "boolean" }, remove_inside: { type: "boolean" }, propose: { type: "boolean" },
      note: { type: "string", maxLength: 500 } }, required: ["project_id"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "clear_built", title: "Städa tomtmark och annat bebyggt", description: `Städar det som redan ligger i kartan ur tomtmark (520), hårdgjord yta (501), byggnader (521) och skärmtak (522), med samma regel som när grundkartan läses in: punkthöjder, gropar, sten, berghäll, sankmark, diken och vegetation tas bort där, och ytor klipps mot kanten (en yta kan bli flera); kurvor, branter, vatten, vägar, stigar och hus står kvar. Behövs när tomter ritats eller hämtats efter att grundkartan lades in: berghäll, sankmark och prickraster ritas annars över olivgrönt. Utan propose räknas bara ändringarna fram (summary och de 300 första). Med propose: true lämnas de som ett förslag (högst ${MCP_PROPOSAL_MAX_OPERATIONS} ändringar; välj annars ett mindre område med area) som en ägare godkänner, eller införs direkt i läget AUTONOMOUS.`,
    inputSchema: { type: "object", properties: { ...projectId, ...area, propose: { type: "boolean" }, note: { type: "string", maxLength: 500 } }, required: ["project_id"] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "propose_changes", title: "Föreslå ändringar", description: `Lämnar ett förslag som en ägare i O-Tid godkänner eller avvisar. Har ägaren satt projektet till självständigt AI-arbete (aiMode AUTONOMOUS i map_overview) införs ändringarna direkt. Högst ${MCP_PROPOSAL_MAX_OPERATIONS} operationer inom ${MCP_PROPOSAL_MAX_SIDE_M} × ${MCP_PROPOSAL_MAX_SIDE_M} m; i läget AUTONOMOUS, när kontot självt får ändra kartan, inom ${MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS} × ${MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS} m. Operationer: add (symbol och points; en punkt för punktsymboler, minst tre för ytor; en yta med hål anges med rings, yttre ringen först), move (key, dx, dy i mm), reshape (key och nya points eller rings, raka sträckor), change_symbol (key och symbol), delete (key) och subtract (key och by: nycklar till andra ytor; ytan klipps mot dem på servern utan att koordinater skickas, flera delar blir flera objekt och en helt täckt yta tas bort). Välj subtract, move, change_symbol och delete före reshape när det går: de kräver ingen geometri. Skriv en kort motivering i note.`,
    inputSchema: { type: "object", properties: { ...projectId, note: { type: "string", maxLength: 500, description: "Motivering som visas för den som granskar" },
      operations: { type: "array", minItems: 1, maxItems: MCP_PROPOSAL_MAX_OPERATIONS, items: { type: "object", properties: {
        op: { type: "string", enum: ["add", "move", "reshape", "change_symbol", "delete", "subtract"] }, key: { type: "string" }, symbol: { type: "string" },
        points, rings: { type: "array", items: points, description: "En yta med hål: yttre ringen först, sedan hålen" },
        by: { type: "array", items: { type: "string" }, maxItems: 50, description: "subtract: nycklar till ytorna som klipper" },
        dx: { type: "number" }, dy: { type: "number" }, angle: { type: "number" } }, required: ["op"] } } },
      required: ["project_id", "note", "operations"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  ...MCP_LASER_TOOLS,
  MCP_BASE_MAP_TOOL
] as const;

const inputs = mcpToolInputSchemas;

const text = (value: unknown): Content => ({ type: "text", text: mcpText(value) });
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

/** Det testerna byter ut: Lantmäteriet (laserverktygen), OpenStreetMap och hyggena (apply_base_map), klockan och tiden för inläggningen. */
export type McpToolOptions = Pick<McpLaserOptions, "runtime" | "now"> & Pick<McpBaseMapOptions, "sources" | "budgetMs">;

/** Ett verktygsanrop för kontot. */
export async function callMcpTool(db: Database, accountId: string, name: string, args: unknown, wait: JobWait = {},
  laser: McpToolOptions = {}): Promise<ToolResult> {
  if (name === "list_map_projects") {
    const list = await db.transaction(tx => listMapProjectsForAccount(tx, accountId));
    return { content: [text({ projects: list.projects.map(project => ({ projectId: project.projectId, name: project.name, role: project.role,
      status: project.status, club: project.club?.name ?? null, baseFile: project.base.fileName, format: project.base.format,
      changedObjects: project.changedObjects })) })] };
  }
  if (name === "create_map_project") {
    const parsed = mcpCreateMapProjectSchema.safeParse(args ?? {});
    if (!parsed.success) return toolError(`Ogiltiga argument: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "(argumenten)"}: ${issue.message}`).join("; ")}`);
    const { name: title, center_e: e, center_n: n, width_m: w, height_m: h, scale } = parsed.data;
    const ring = [[e - w / 2, n - h / 2], [e + w / 2, n - h / 2], [e + w / 2, n + h / 2], [e - w / 2, n + h / 2]];
    const sprintScale = scale === 4000 || scale === 3000;
    const created = await createMapProjectNewForAccount(db, { accountId, request: { formatVersion: 1, requestId: randomUUID(), name: title,
      symbolSet: sprintScale ? "ISSPROM2019-2" : "ISOM2017-2", scale: scale ?? 10000, area: { crs: "SWEREF99TM", rings: [ring] } } });
    if (created.status !== "created") return toolError(created.status === "quota" ? "Kontots lagringsutrymme räcker inte för en ny karta."
      : created.status === "area-too-large" ? "Området är för stort." : `Kartan skapades inte (${created.status}; mittpunkten ska ligga i Sverige, i SWEREF 99 TM).`);
    return { content: [text({ projectId: created.projectId, message: `Ett nytt eget kartprojekt med en tom karta (${sprintScale ? "ISSprOM 2019-2" : "ISOM 2017-2"}). Laserkörningen startas med start_laser_job (kontot behöver sparade uppgifter till Lantmäteriet) och grundkartan läggs in med apply_base_map när körningen är klar. AI-läget är förslag tills ägaren ändrar det.` })] };
  }
  const schemaFor = inputs[name as keyof typeof inputs];
  if (!schemaFor) return toolError(`Okänt verktyg ${name}`);
  const parsed = schemaFor.safeParse(args ?? {});
  if (!parsed.success) return toolError(`Ogiltiga argument: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "(argumenten)"}: ${issue.message}`).join("; ")}`);
  const input = parsed.data as { project_id: string } & Record<string, unknown>;
  const denied = await access(db, accountId, input.project_id, name === "propose_changes" || ((name === "generalize" || name === "clear_built") && input.propose === true) ? "propose" : "view");
  if (denied) return toolError(denied);
  if (MCP_LASER_TOOL_NAMES.has(name)) return callMcpLaserTool(db, accountId, name, input, { runtime: laser.runtime, now: laser.now, wait });
  if (name === MCP_BASE_MAP_TOOL.name) return callMcpBaseMapTool(db, accountId, input, { now: laser.now, sources: laser.sources, budgetMs: laser.budgetMs, wait });
  switch (name) {
    case "map_overview": {
      const outcome = await job(db, accountId, input.project_id, "OVERVIEW", {}, wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      const extra = await db.transaction(async tx => ({ areas: (await mapProjectAreaViews(tx, input.project_id)).map(row => ({ name: row.name,
        status: row.status, assignee: row.assignee?.name ?? null, revisedOn: row.revisedOn })), openProposals: await openProposalCount(tx, input.project_id),
        // Vad AI-kopplingen får göra här: READ (bara läsa), PROPOSE (förslag som en ägare godkänner) eller AUTONOMOUS (ändringarna införs direkt).
        aiMode: (await tx.select({ aiMode: schema.mapProjects.aiMode }).from(schema.mapProjects).where(eq(schema.mapProjects.id, input.project_id)))[0]?.aiMode ?? "PROPOSE" }));
      return { content: [text({ ...(outcome.result as object), ...extra })] };
    }
    case "render_view":
    case "render_compare": {
      // Ägaren 2026-11-17: underlagen pekas ut med en del av namnet; kartjobbet läser bilderna med innehållsnyckeln.
      let underlays: RenderUnderlaySource[] | undefined;
      if (name === "render_view" && Array.isArray(input.underlays) && input.underlays.length) {
        const rows = await db.select({ name: schema.mapProjectLayers.name, sha256: schema.mapProjectLayers.contentSha256, width: schema.mapProjectLayers.width,
          height: schema.mapProjectLayers.height, crs: schema.mapProjectLayers.crs, transform: schema.mapProjectLayers.transform, sort: schema.mapProjectLayers.sort,
          createdAt: schema.mapProjectLayers.createdAt }).from(schema.mapProjectLayers).where(eq(schema.mapProjectLayers.projectId, input.project_id));
        rows.sort((a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime());
        underlays = [];
        for (const wanted of input.underlays as string[]) {
          // Det senast tillagda underlaget som namnet passar, utan dubbletter.
          const hit = [...rows].reverse().find(row => row.name.toLowerCase().includes(wanted.toLowerCase()) && !underlays!.some(found => found.sha256 === row.sha256));
          if (hit) underlays.push({ name: hit.name, sha256: hit.sha256, width: hit.width, height: hit.height, crs: hit.crs, transform: hit.transform });
        }
        if (!underlays.length) return toolError(rows.length ? `Inget underlag passar. Projektets underlag: ${rows.map(row => `«${row.name}»`).join(", ")}.`
          : "Projektet har inga underlag. Ortofoton hämtas i O-Tid under Underlag (Ortofoto från Lantmäteriet); laserkörningens bilder läggs till där också.");
      }
      const request = { area: input.area, widthPx: input.width_px, grid: input.grid, highlight: input.highlight, hideSymbols: input.hide_symbols,
        ...(underlays ? { underlays, mapOpacity: input.map_opacity } : {}) };
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
      const box = [input.min_e, input.min_n, input.max_e, input.max_n];
      if (box.some(value => typeof value === "number")) {
        if (!box.every(value => typeof value === "number")) return toolError("Utsnittet behöver min_e, min_n, max_e och max_n.");
        const cut = cropRaster(raster, box as [number, number, number, number]);
        if ("error" in cut) return toolError(cut.error);
        return { content: [{ type: "image", data: Buffer.from(cut.png).toString("base64"), mimeType: "image/png" }, text({ jobId: raster.jobId, name: input.name, worldFile: cut.world })] };
      }
      return { content: [{ type: "image", data: raster.png.toString("base64"), mimeType: raster.mediaType }, text({ jobId: raster.jobId, name: input.name, worldFile: raster.world })] };
    }
    case "list_objects": {
      const outcome = await job(db, accountId, input.project_id, "OBJECTS", strip({ area: input.area, symbols: input.symbols, limit: input.limit, offset: input.offset,
        keys: input.keys, maxPoints: input.max_points, brief: input.brief }), wait);
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
      if (created.status !== "created") return toolError(refusal(created.status));
      return { content: [text({ summary: result.summary, proposalId: created.proposal.proposalId, changes: created.proposal.edits.length, ...outcomeOf(created) })] };
    }
    case "clear_built": {
      const outcome = await job(db, accountId, input.project_id, "GENERALIZE", strip({ area: input.area, propose: input.propose, clearBuilt: true }), wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      const result = outcome.result as { summary: unknown; changes: unknown[]; edits?: unknown[]; errors?: string[] };
      if (result.errors) return toolError(`Förslaget lämnades inte:\n- ${result.errors.join("\n- ")}`);
      if (!input.propose || !result.edits || result.edits.length === 0) return { content: [text({ summary: result.summary, changes: result.changes })] };
      const created = await createMapProjectProposalAsAi(db, { accountId, projectId: input.project_id, request: { formatVersion: 1,
        requestId: randomUUID(), note: typeof input.note === "string" && input.note ? input.note.slice(0, 500) : "Städat i tomtmark och annat bebyggt (AI)", edits: result.edits } });
      if (created.status !== "created") return toolError(refusal(created.status));
      return { content: [text({ summary: result.summary, proposalId: created.proposal.proposalId, changes: created.proposal.edits.length, ...outcomeOf(created) })] };
    }
    case "propose_changes": {
      // I läget självständigt, när kontot självt får ändra kartan, får ett anrop täcka mer (ägaren 2026-11-16).
      const gate = await db.transaction(tx => aiGate(accountId, input.project_id, new Date())(tx, "propose", false));
      const direct = gate.status === "ok" && gate.project.aiMode === "AUTONOMOUS" && mapProjectAllows(gate.role, gate.project, "edit");
      const outcome = await job(db, accountId, input.project_id, "PROPOSE", { operations: input.operations,
        maxSideM: direct ? MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS : MCP_PROPOSAL_MAX_SIDE_M }, wait);
      if (outcome.status !== "done") return jobFailure(outcome);
      const result = outcome.result as { edits?: unknown[]; errors?: string[] };
      if (result.errors) return toolError(`Förslaget lämnades inte:\n- ${result.errors.join("\n- ")}`);
      const created = await createMapProjectProposalAsAi(db, { accountId, projectId: input.project_id, request: { formatVersion: 1,
        requestId: randomUUID(), note: typeof input.note === "string" ? input.note.slice(0, 500) : "", edits: result.edits } });
      if (created.status !== "created") return toolError(refusal(created.status));
      return { content: [text({ proposalId: created.proposal.proposalId, changes: created.proposal.edits.length, ...outcomeOf(created) })] };
    }
    default: return toolError(`Okänt verktyg ${name}`);
  }
}

const refusal = (status: string) => status === "forbidden" ? "Ägaren har satt AI-kopplingen till att bara läsa i det här projektet (eller kontot får inte föreslå)."
  : `Förslaget lämnades inte (${status}).`;

/** Vad som hände med förslaget: infört direkt (självständigt läge) eller väntar på en ägare. */
function outcomeOf(created: { applied?: number; conflicts?: number }): Record<string, unknown> {
  if (created.applied === undefined) return { message: "Förslaget ligger i projektet och väntar på att en ägare godkänner eller avvisar det." };
  return { applied: created.applied, conflicts: created.conflicts ?? 0,
    message: "Projektet är satt till självständigt AI-arbete: ändringarna är införda i kartan och står i historiken som ett godkänt AI-förslag." };
}

function strip(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/**
 * Ett JSON-RPC-meddelande från klienten. Notiser (utan id) ger null (HTTP 202). Okända metoder ger felet -32601.
 */
export async function handleMcpMessage(db: Database, accountId: string, message: unknown, wait: JobWait = {},
  scopes: readonly OauthScope[] = ["kartprojekt"], laser: McpToolOptions = {}): Promise<McpResponse | null> {
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
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: "O-Tid", version: "1.3.0" },
        instructions: [maps ? "Kartprojekt (orienteringskartor i Mapper-format): koordinater är kartans mm med y uppåt. Börja med list_map_projects och map_overview, titta med render_view, läs objekt med list_objects. Ändringar lämnas med propose_changes; projektets ägare bestämmer AI-läget (aiMode i map_overview): PROPOSE = förslag som en människa godkänner (förval), AUTONOMOUS = ändringarna införs direkt och står i historiken, READ = bara läsa. create_map_project skapar en ny tom karta. Laserunderlag: start_laser_job köar en laserkörning för kartan eller en etapp (ändrar inte kartan; inte i läget READ), list_laser_jobs visar läget och filerna, read_laser_output läser kurvor, branter, kullar, vatten och vegetation i kartans mm som underlag för propose_changes, och apply_base_map lägger in hela grundkartan ur en klar körning (laserjobbets filer, OpenStreetMap och hyggen, som «Hämta grundkartan» i O-Tid): som förslag i läget PROPOSE, direkt i AUTONOMOUS, inte i READ; anropa igen med samma argument tills remaining är 0." : "",
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
      return ok(await callMcpTool(db, accountId, name, params?.arguments, wait, laser));
    }
    default: return { jsonrpc: "2.0", id, error: { code: -32601, message: `Okänd metod ${method}` } };
  }
}

/** Ett utsnitt (SWEREF 99 TM) av ett PNG-raster med världsfil, med den nya världsfilen (ägaren 2026-11-17). */
export function cropRaster(raster: { png: Uint8Array; mediaType: string; world: string | null }, [minE, minN, maxE, maxN]: [number, number, number, number])
  : { png: Uint8Array; world: string } | { error: string } {
  if (raster.mediaType !== "image/png" || !raster.world) return { error: "Utsnitt går bara för PNG-rastren med världsfil (inte relief och skuggning)." };
  const values = raster.world.trim().split(/\s+/).map(Number);
  const [size, , , negative, left, top] = values;
  if (values.length < 6 || !(size! > 0) || Math.abs(size! + negative!) > 1e-9) return { error: "Rastrets världsfil har ett okänt format." };
  const image = decodeRgbaPng(raster.png);
  if (!image) return { error: "Rastret gick inte att läsa." };
  const x0 = Math.max(0, Math.floor((minE - left! + size! / 2) / size!)), x1 = Math.min(image.width, Math.ceil((maxE - left! + size! / 2) / size!));
  const y0 = Math.max(0, Math.floor((top! - maxN + size! / 2) / size!)), y1 = Math.min(image.height, Math.ceil((top! - minN + size! / 2) / size!));
  if (x1 - x0 < 1 || y1 - y0 < 1) return { error: "Utsnittet ligger utanför rastret." };
  if (x1 - x0 > 2000 || y1 - y0 > 2000) return { error: `Utsnittet är för stort (${x1 - x0} × ${y1 - y0} bildpunkter, högst 2 000 per sida).` };
  const out = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
  for (let row = y0; row < y1; row += 1) out.set(image.data.subarray((row * image.width + x0) * 4, (row * image.width + x1) * 4), (row - y0) * (x1 - x0) * 4);
  return { png: rgbaPng(x1 - x0, y1 - y0, out), world: [size, 0, 0, -size!, left! + x0 * size!, top! - y0 * size!].join("\n") };
}
