import { createHash } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { MCP_BASE_MAP_MAX_BYTES, MCP_BASE_MAP_MAX_OBJECTS, type GeoJobView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { baseMapOutputs, clipWgs84, type BaseMapSummary } from "@o-tid/map-revision/base-map";
import { aiGate, mapProjectAllows } from "./map-project-access";
import { mapProjectAreaViews } from "./map-project-areas";
import { clearCutRuntimeFromEnvironment, fetchMapProjectClearCutsAsAi, type ClearCutRuntime } from "./map-project-clear-cuts";
import { geoDepthOutputs, geoRockOutputs, geoVectorOutputs, listGeoJobsForAccount } from "./map-project-geo-jobs";
import type { BaseMapJobRequest } from "./map-project-job-base-map";
import { mapJobResultHead, mapJobResultPart, queueMapJob, reusableProjectJob, waitForMapJobState } from "./map-project-jobs";
import { createMapProjectProposalAsAi } from "./map-project-proposals";
import { fetchMapProjectOsmAsAi, mapSourceRuntimeFromEnvironment, type MapSourceRuntime } from "./map-project-sources";

/**
 * Ägaren 2026-11-13 (etapp 2 av «AI:n tar fram ett kartblad själv»): AI-kopplingens verktyg apply_base_map lägger in
 * grundkartan ur ett klart laserjobb, med samma sammansättning, förval och klippning som «Hämta grundkartan» och «Lägg in N
 * objekt i kartan» i webben. Det tunga (filerna tolkas, sätts ihop och räknas om till kartans objekt) görs som kartjobbet
 * BASE_MAP i utskriftsarbetaren; OpenStreetMap och hyggena hämtas här (med kontots gräns per timme) och följer med jobbet.
 * Objekten läggs in som AI-förslag i omgångar om högst 200 (samma väg som propose_changes): öppna förslag i läget PROPOSE,
 * införda direkt i AUTONOMOUS när kontot självt får ändra kartan, och nekat i READ.
 *
 * Ett anrop väntar bara en kort stund: tar sammansättningen eller inläggningen längre svarar verktyget med läget, och samma
 * anrop igen fortsätter där det var (kartjobbet hittas på laserjobbet och valen, och varje omgång har ett fast `requestId`,
 * så inget läggs in två gånger). Kartjobbets resultat finns kvar en timme.
 */
type Content = { type: "text"; text: string };
type ToolResult = { content: Content[]; isError?: boolean };
const text = (value: unknown): Content => ({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) });
const toolError = (message: string): ToolResult => ({ content: [text(message)], isError: true });

/** Så länge lägger ett anrop in omgångar; resten tas i nästa anrop. */
const APPLY_BUDGET_MS = 20_000;
const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

export const MCP_BASE_MAP_TOOL = { name: "apply_base_map", title: "Lägg in grundkartan ur en laserkörning",
  description: `Sätter ihop grundkartan ur en klar laserkörning (projektets senaste, eller job_id från list_laser_jobs) och lägger in den i kartan, på samma sätt och med samma förval som «Hämta grundkartan» och «Lägg in objekt i kartan» i O-Tid: kurvor och formlinjer (fogade över skarvarna, klippta mot vattnet), branter, små kullar och gropar, vatten med strandlinje, sankmark, vegetation, marktäcke, byggnader och tomtmark ur laserjobbets filer, vägar, stigar, ledningar och staket ur OpenStreetMap och Skogsstyrelsens hyggen efter ålder. Lagren får symbolerna som O-Tid föreslår ur lagernamnen; objekten klipps mot kartans område och, för en etapps laserjobb, mot etappen, hålls utanför det som redan är ritat som tomtmark, asfalt eller hus och generaliseras efter normen. knolls och cliffs (1–10, 5 = förvalen) väljer mängden små kullar och branter bland dem jobbet sparat (kullar.geojson, brantlinjer.geojson); utelämnade används jobbets egna. Har körningen bergbilden (berg.png) hittas berg i dagen (214) ur laserns ojämnhet, öppenheten och närheten till vatten med förvalet nivå 3 av 10 i stället för laserfilens berg (rock i svaret säger antal ytor och hektar); stenar och kullar står kvar. Har körningen fuktdjupet (körd med fuktigheten) tas hjälpkurvor och små slutna kurvor bort där marken är flack (under 1° medellutning; flatContours i svaret säger hur mycket), som förvalet för «Lugna kurvor på flack mark» i O-Tid. Objekten lämnas som AI-förslag i omgångar om högst 200: i läget PROPOSE väntar de på att en ägare godkänner dem (Godkänn alla i O-Tid), i AUTONOMOUS införs de direkt när kontot självt får ändra kartan, och i READ nekas anropet. Går OpenStreetMap eller hyggena inte att hämta läggs grundkartan in ändå och missing säger vad som saknas. Sammansättningen kan ta några minuter: svarar verktyget att arbetet pågår eller att omgångar återstår (remaining), anropa igen med samma argument tills remaining är 0; inget läggs in två gånger. Gränser: laserjobbets filer högst ${megabytes(MCP_BASE_MAP_MAX_BYTES)} MB tillsammans och högst ${MCP_BASE_MAP_MAX_OBJECTS} objekt per laserjobb (dela annars kartan i etapper och lägg in en etapp i taget). Ett laserjobb som redan lagts in läggs inte in igen utan again: true. Svaret räknar objekten per symbol och lager och säger vad som hoppades över.`,
  inputSchema: { type: "object", properties: { project_id: { type: "string", description: "Kartprojektets id (från list_map_projects)" },
    job_id: { type: "string", description: "Laserkörningens id; utelämnat = projektets senaste klara körning med en grundkarta" },
    knolls: { type: "integer", minimum: 1, maximum: 10, description: "Mängden små kullar (punkthöjder), 5 = förvalen" },
    cliffs: { type: "integer", minimum: 1, maximum: 10, description: "Mängden branter, 5 = förvalen" },
    again: { type: "boolean", description: "Lägg in ett laserjobb som redan lagts in en gång till" } },
    required: ["project_id"] }, annotations: { readOnlyHint: false, destructiveHint: false } } as const;

export interface McpBaseMapOptions { wait?: { timeoutMs?: number; pollMs?: number } | undefined; now?: Date | undefined; budgetMs?: number | undefined;
  sources?: { osm?: MapSourceRuntime | undefined; clearCuts?: ClearCutRuntime | undefined } | undefined }

/** Ett fast UUID (version 4 till formen) ur en text: omgångens `requestId`, samma vid varje anrop. */
function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Märket sist i förslagens anteckning som säger vilket laserjobb de kom ur. */
const marker = (jobId: string) => `[${jobId}]`;

const sourceProblem = (result: { status: string; detail?: string }) => result.status === "throttled" ? "gränsen för hämtningar per timme är nådd"
  : result.status === "too-large" ? "området är för stort" : result.status === "unavailable" ? `tjänsten svarade inte (${result.detail ?? "okänt fel"})` : result.status;

/** Verktyget apply_base_map; argumenten är redan prövade mot verktygets schema och kontot får se projektet. */
export async function callMcpBaseMapTool(db: Database, accountId: string, input: { project_id: string } & Record<string, unknown>,
  options: McpBaseMapOptions = {}): Promise<ToolResult> {
  const projectId = input.project_id, now = options.now ?? new Date();
  const allowed = await db.transaction(tx => aiGate(accountId, projectId, now)(tx, "propose", false));
  if (allowed.status !== "ok") {
    return toolError(allowed.status === "forbidden" ? "Grundkartan lades inte in: ägaren har satt AI-kopplingen till att bara läsa i det här projektet (aiMode READ), eller så har kontot inte rollen Föreslå eller högre i ett öppet projekt."
      : "Projektet finns inte eller kontot är inte medlem.");
  }
  const direct = allowed.project.aiMode === "AUTONOMOUS" && mapProjectAllows(allowed.role, allowed.project, "edit");

  // Laserjobbet: det utpekade, annars det senaste klara som har en grundkarta.
  const listed = await listGeoJobsForAccount(db, { accountId, projectId }, process.env, now);
  if (listed.status !== "ok") return toolError("Projektet finns inte eller kontot är inte medlem.");
  const hasBaseMap = (job: GeoJobView) => job.kind === "PULLAUTIN" && job.status === "DONE" && baseMapOutputs(job.outputs.map(output => output.name)).length > 1;
  const wanted = typeof input.job_id === "string" ? input.job_id : undefined;
  const job = listed.list.jobs.find(row => wanted ? row.jobId === wanted : hasBaseMap(row));
  if (!job) return toolError(wanted ? "Laserkörningen finns inte i projektet (list_laser_jobs visar jobben)." : "Projektet har ingen klar laserkörning med en grundkarta. Starta en med start_laser_job och vänta tills den är klar (list_laser_jobs).");
  if (!hasBaseMap(job)) return toolError(`Laserkörningen ${job.name} är inte klar eller saknar grundkartans filer (status ${job.status}).`);
  const levels = { knolls: typeof input.knolls === "number" ? input.knolls : undefined, cliffs: typeof input.cliffs === "number" ? input.cliffs : undefined };
  const hash = createHash("sha256").update(JSON.stringify([job.jobId, levels.knolls ?? null, levels.cliffs ?? null])).digest("hex");

  let mapJobId = await reusableProjectJob(db, { accountId, projectId, kind: "BASE_MAP", hash });
  if (!mapJobId) {
    // Ägaren ska inte få samma grundkarta två gånger för att AI:n frågade igen efter att kartjobbets resultat rensats.
    if (input.again !== true) {
      const [prior] = await db.select({ id: schema.mapProjectProposals.id }).from(schema.mapProjectProposals)
        .where(and(eq(schema.mapProjectProposals.projectId, projectId), eq(schema.mapProjectProposals.source, "AI"),
          inArray(schema.mapProjectProposals.status, ["OPEN", "ACCEPTED"]), like(schema.mapProjectProposals.note, `%${marker(job.jobId)}`))).limit(1);
      if (prior) return toolError(`Grundkartan ur laserkörningen ${job.name} är redan inlagd i projektet (eller ligger som förslag). Ange again: true för att lägga in den en gång till; avbröts en tidigare inläggning för mer än en timme sedan kan delar av den redan finnas i kartan.`);
    }
    const files = await geoVectorOutputs(db, job.jobId);
    const named = (name: string) => files.find(file => file.name === name);
    const parts = baseMapOutputs(files.map(file => file.name)).map(name => named(name)!);
    const knolls = levels.knolls !== undefined ? named("kullar.geojson") : undefined, cliffs = levels.cliffs !== undefined ? named("brantlinjer.geojson") : undefined;
    if (levels.knolls !== undefined && !knolls) return toolError("Laserkörningen har inga sparade kullar (kullar.geojson) att välja bland; utelämna knolls.");
    if (levels.cliffs !== undefined && !cliffs) return toolError("Laserkörningen har inga sparade branter (brantlinjer.geojson) att välja bland; utelämna cliffs.");
    const bytes = [...parts, ...(knolls ? [knolls] : []), ...(cliffs ? [cliffs] : [])].reduce((sum, file) => sum + file.byteSize, 0);
    if (bytes > MCP_BASE_MAP_MAX_BYTES) {
      return toolError(`Laserkörningens filer är för stora att sätta ihop här (${megabytes(bytes)} MB, högst ${megabytes(MCP_BASE_MAP_MAX_BYTES)} MB). Dela kartan i etapper och kör laserjobbet och apply_base_map en etapp i taget.`);
    }
    const stage = job.areaId ? (await db.transaction(tx => mapProjectAreaViews(tx, projectId))).find(area => area.areaId === job.areaId)?.polygon : undefined;
    // OpenStreetMap och hyggena för jobbets ruta, som i webben; går en hämtning inte läggs grundkartan in utan den.
    const box = job.clip ? clipWgs84(job.clip) : undefined;
    const missing: string[] = [];
    let osm: BaseMapJobRequest["osm"], cuts: BaseMapJobRequest["cuts"];
    if (box) {
      const request = { formatVersion: 1, box };
      const fetchedOsm = await fetchMapProjectOsmAsAi(db, { accountId, projectId, request }, options.sources?.osm ?? mapSourceRuntimeFromEnvironment(process.env), now);
      if (fetchedOsm.status === "ok") osm = fetchedOsm.data; else missing.push(`osm: ${sourceProblem(fetchedOsm)}`);
      const fetchedCuts = await fetchMapProjectClearCutsAsAi(db, { accountId, projectId, request }, options.sources?.clearCuts ?? clearCutRuntimeFromEnvironment(process.env), now);
      if (fetchedCuts.status === "ok") cuts = fetchedCuts.cuts.map(cut => ({ rings: cut.rings, date: cut.date })); else missing.push(`clear_cuts: ${sourceProblem(fetchedCuts)}`);
    } else missing.push("osm: laserkörningen har ingen klippruta", "clear_cuts: laserkörningen har ingen klippruta");
    // «Lugna kurvor på flack mark»: jobbets fuktdjup följer med när det finns, och förvalet gäller som i webben.
    const depth = await geoDepthOutputs(db, job.jobId);
    // Berg i dagen: har jobbet bergbilden används regeln med förvalet i stället för berg.dxf:s berg, som i webben.
    const rock = await geoRockOutputs(db, job.jobId);
    const request: BaseMapJobRequest = { hash, files: parts.map(file => ({ name: file.name, sha256: file.sha256 })),
      ...(knolls ? { knolls: { level: levels.knolls!, sha256: knolls.sha256 } } : {}), ...(cliffs ? { cliffs: { level: levels.cliffs!, sha256: cliffs.sha256 } } : {}),
      ...(osm ? { osm } : {}), ...(cuts ? { cuts } : {}), scannedAt: job.scannedAt, ...(depth ? { depth } : {}), ...(rock ? { rock } : {}), ...(stage ? { stage } : {}), missing };
    mapJobId = await queueMapJob(db, { accountId, projectId, kind: "BASE_MAP", request: request as unknown as Record<string, unknown> }, now);
    if (!mapJobId) return toolError("För många anrop just nu (högst 30 kartjobb per minut och två samtidigt). Vänta en stund.");
  }
  const state = await waitForMapJobState(db, mapJobId, options.wait ?? {});
  if (state.status === "failed") return toolError(`Grundkartan gick inte att sätta ihop: ${state.error}`);
  if (state.status === "timeout") {
    return { content: [text({ jobId: job.jobId, status: "ASSEMBLING", message: "Grundkartan sätts ihop (det kan ta några minuter för ett stort område). Inget är inlagt än; anropa apply_base_map igen med samma argument om en stund." })] };
  }
  // Resultatet kan vara tiotals MB: sammanfattningen läses för sig och omgångarna en i taget.
  const loaded = await mapJobResultHead(db, mapJobId);
  if (!loaded) return toolError("Kartjobbets resultat finns inte kvar. Anropa apply_base_map igen.");
  const head = loaded.head as { problem?: string; summary?: BaseMapSummary; missing?: string[] };
  if (head.problem || !head.summary) return toolError(head.problem ?? "Kartjobbets resultat gick inte att läsa.");
  const result = { summary: head.summary, missing: head.missing ?? [], parts: { length: loaded.parts } };

  // Inläggningen: en omgång per förslag med ett fast requestId, så att ett nytt anrop fortsätter där det förra slutade.
  const requestIds = Array.from({ length: result.parts.length }, (_, index) => stableUuid(`${mapJobId}:${index}`));
  const done = new Set<string>();
  for (let from = 0; from < requestIds.length; from += 500) {
    const rows = await db.select({ requestId: schema.mapProjectProposals.requestId }).from(schema.mapProjectProposals)
      .where(inArray(schema.mapProjectProposals.requestId, requestIds.slice(from, from + 500)));
    for (const row of rows) done.add(row.requestId);
  }
  const started = Date.now(), budget = options.budgetMs ?? APPLY_BUDGET_MS;
  let created = 0, applied = 0, conflicts = 0, failure: string | undefined;
  for (let index = 0; index < result.parts.length; index += 1) {
    if (done.has(requestIds[index]!)) continue;
    // Minst en omgång per anrop, så att upprepade anrop alltid kommer framåt.
    if (created > 0 && Date.now() - started > budget) break;
    const edits = await mapJobResultPart(db, mapJobId, index);
    if (!Array.isArray(edits)) { failure = "kartjobbets resultat finns inte kvar"; break; }
    const proposal = await createMapProjectProposalAsAi(db, { accountId, projectId, request: { formatVersion: 1, requestId: requestIds[index]!,
      note: `Grundkartan ur laserkörningen ${job.name.slice(0, 80)} (del ${index + 1} av ${result.parts.length}) ${marker(job.jobId)}`, edits } }, now);
    if (proposal.status !== "created") {
      failure = proposal.status === "forbidden" ? "ägaren har satt AI-kopplingen till att bara läsa, eller kontot får inte längre föreslå" : proposal.status === "conflict" ? "projektet är avslutat" : proposal.status;
      break;
    }
    done.add(requestIds[index]!);
    created += 1; applied += proposal.applied ?? 0; conflicts += proposal.conflicts ?? 0;
  }
  const remaining = result.parts.length - done.size;
  const summary: BaseMapSummary = result.summary;
  const message = failure ? `Inläggningen avbröts (${failure}). ${done.size} av ${result.parts.length} omgångar är inlagda.`
    : remaining > 0 ? `${done.size} av ${result.parts.length} omgångar är inlagda. Anropa apply_base_map igen med samma argument för att fortsätta (inget läggs in två gånger).`
    : direct ? "Grundkartan är inlagd i kartan. Projektet är satt till självständigt AI-arbete: objekten står i historiken som godkända AI-förslag."
    : `Grundkartan ligger som ${result.parts.length} förslag i projektet och väntar på att en ägare godkänner dem (Godkänn alla i O-Tid).`;
  return { content: [text({ jobId: job.jobId, status: failure ? "INTERRUPTED" : remaining > 0 ? "APPLYING" : direct ? "APPLIED" : "PROPOSED",
    mode: direct ? "AUTONOMOUS" : "PROPOSE", parts: result.parts.length, done: done.size, remaining, ...(direct ? { appliedNow: applied, conflictsNow: conflicts } : {}),
    objects: summary.objects, symbols: summary.symbols, layers: summary.layers, skipped: summary.skipped, clipped: summary.clipped, joined: summary.joined,
    simplified: summary.simplified, ...(summary.clearCuts ? { clearCuts: summary.clearCuts } : {}), ...(summary.knolls ? { knolls: summary.knolls } : {}),
    ...(summary.cliffs ? { cliffs: summary.cliffs } : {}), ...(summary.rock ? { rock: summary.rock } : {}), ...(summary.flatContours ? { flatContours: summary.flatContours } : {}), missing: result.missing, message })], ...(failure ? { isError: true } : {}) };
}
