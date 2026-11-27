import { randomUUID } from "node:crypto";
import {
  GEO_JOB_DEFAULTS, GEO_JOB_ENGINES, GEO_JOB_MAX_TILES, MCP_LASER_OUTPUT_MAX_BYTES, MCP_LASER_OUTPUT_MAX_OBJECTS, MCP_LASER_OUTPUT_MAX_POINTS,
  MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT, newestLaserTiles, type GeoClip, type GeoJobView
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { clipWgs84 } from "@o-tid/map-revision/base-map";
import { aiGate } from "./map-project-access";
import { mapProjectAreaViews } from "./map-project-areas";
import { createGeoJobAsAi, findGeoVectorOutput, listGeoJobsForAccount } from "./map-project-geo-jobs";
import { runMapJobAndWait, type MapJobOutcome } from "./map-project-jobs";
import { lantmaterietRuntimeFromEnvironment } from "./map-project-lantmateriet";
import { laserRuntimeFromEnvironment, searchMapProjectLaserAsAi, type LaserRuntime } from "./map-project-laser";
import { mcpText } from "./mcp-text";

/**
 * Ägaren 2026-11-13 (etapp 1 av «AI:n tar fram ett kartblad själv»): AI-kopplingens verktyg för laserkörningar. Jobben
 * listas, startas på samma väg som laserpanelen i webben (sökningen hos Lantmäteriet med kontots uppgifter, samma klippruta,
 * förval, strypning och kvot) och resultatens vektorfiler läses i kartans mm. Det som behöver kartans georeferens görs som
 * kartjobb i utskriftsarbetaren (`map-project-job-laser.ts`). En körning ändrar inte kartan; den skapar bara underlag.
 */
type Content = { type: "text"; text: string };
type ToolResult = { content: Content[]; isError?: boolean };
const text = (value: unknown): Content => ({ type: "text", text: mcpText(value) });
const toolError = (message: string): ToolResult => ({ content: [text(message)], isError: true });

const projectId = { project_id: { type: "string", description: "Kartprojektets id (från list_map_projects)" } };
export const MCP_LASER_TOOLS = [
  { name: "list_laser_jobs", title: "Laserkörningarna i ett kartprojekt", description: "Projektets laserkörningar (geo-jobb), nyast först: id, namn, motor (engine: otidgeo eller pullautin), status (QUEUED, RUNNING, DONE, FAILED, CANCELLED), förloppet medan jobbet körs, starttid (startedAt), försök (attempts), geo-arbetarens version, etappen (areaId, null = hela kartan), klipprutan i SWEREF 99 TM, inställningar (settings, cliffs, moisture, vegetation, extras, mergedStages), sammanfattning (summary med bl.a. stegtider i ms och topp-RAM) och resultatfilerna med storlek. Också etapperna (delområdena) med id, om rå laserdata finns (rawLaserAvailable) och geo-serverns läge. En körning tar ofta några minuter; fråga igen i stället för att vänta.",
    inputSchema: { type: "object", properties: { ...projectId }, required: ["project_id"] }, annotations: { readOnlyHint: true } },
  { name: "start_laser_job", title: "Starta en laserkörning", description: `Köar en laserkörning (O-Tids egen motor otidgeo som förval, eller bildmotorfri Karttapullautin via engine: pullautin, plus O-Tids rastersteg på Lantmäteriets laserdata) för hela kartområdet, en etapp (area_id från list_laser_jobs), en egen provruta i SWEREF 99 TM (clip, 20–12 000 m per sida) eller som omkörning av ett tidigare jobb (rerun_of, utan ny Lantmäteriet-sökning; kan kombineras med clip för en mindre provruta). Laserrutorna söks med kontots egna uppgifter till Lantmäteriet, den nyaste skanningen per ruta väljs och laserdatan klipps till området. Förvalen är O-Tids (motor otidgeo, ekvidistans ${GEO_JOB_DEFAULTS.contourInterval} m, formline 2, fuktighet och vegetation med, och på en sprintkarta belagd yta ur laserns intensitet, settings paved); engine, contour_interval, settings (inkl. formline 0–3, smooth_m, taubin, min_loop_area, min_clearance, formline_gap, formline_max_slope, veg_smooth, overview), cliffs, moisture och vegetation ändrar dem, och raw_laser packar klippta LAZ-filer i 7 dygn när rawLaserAvailable är sant. En körning ändrar inte kartan, den skapar bara underlag, och tillåts därför när projektets AI-läge är PROPOSE eller AUTONOMOUS men inte READ; kontot ska ha rollen Föreslå eller högre i ett öppet projekt. Gränser: högst ${GEO_JOB_MAX_TILES} laserrutor och 12 km i sida per körning (dela annars i etapper), två körningar samtidigt per konto, kontots månadskvot av rutor och 30 sökningar i timmen. Resultatet läses med list_laser_jobs, read_laser_output och training_raster.`,
    inputSchema: { type: "object", properties: { ...projectId, area_id: { type: "string", description: "Etappens id; utelämnat = hela kartområdet (kan inte kombineras med clip eller rerun_of)" },
      clip: { type: "object", description: "Egen klippruta i SWEREF 99 TM (meter, 20–12 000 m per sida), t.ex. en snabb 1×1 km provruta utan delområde",
        properties: { min_x: { type: "number" }, min_y: { type: "number" }, max_x: { type: "number" }, max_y: { type: "number" } }, required: ["min_x", "min_y", "max_x", "max_y"] },
      rerun_of: { type: "string", description: "Jobb-id (från list_laser_jobs) att köra om med nya inställningar utan ny sökning hos Lantmäteriet; kan kombineras med clip" },
      name: { type: "string", maxLength: 80, description: "Körningens namn (förval: Karttapullautin och området)" },
      engine: { type: "string", enum: [...GEO_JOB_ENGINES], description: "Motor för kurvor, formlinjer och vegetation: otidgeo (förval — O-Tids egen motor, snabb, skarvfri, med 2 m översiktsbild) eller pullautin (Karttapullautin utan bildmotor, klassiska kurvor). Utelämnas engine vid rerun_of ärvs föregående jobbs motor." },
      contour_interval: { type: "number", minimum: 1, maximum: 10, description: `Ekvidistans i meter (förval ${GEO_JOB_DEFAULTS.contourInterval}, sprintkartor 2,5)` },
      settings: { type: "object", additionalProperties: { type: "number" }, description: "Motorns och geo-arbetarens inställningar (t.ex. formline 0–3, smooth_m, taubin, min_loop_area, min_clearance, curviness, formline_gap, formline_max_slope, veg_smooth, overview, greenscale, openshare, topweight, undergrowth, knollshare, smoothing, knolls), samma namn och gränser som i O-Tid" },
      cliffs: { type: "object", description: "Branternas trösklar i markrastret (meter fall över ±3 m); utelämnat = förvalet",
        properties: { min_drop: { type: "number", minimum: 0.5, maximum: 5 }, impassable_drop: { type: "number", minimum: 1, maximum: 10 },
          impassable_length: { type: "number", minimum: 5, maximum: 60 }, tags: { type: "boolean" }, raw_ticks: { type: "boolean" } },
        required: ["min_drop", "impassable_drop"] },
      moisture: { type: "object", description: `Fuktighetens trösklar (förval channel_ha ${GEO_JOB_DEFAULTS.channelHa}, wet_meters ${GEO_JOB_DEFAULTS.wetMeters}, moist_meters 1,6 × wet_meters)`,
        properties: { channel_ha: { type: "number", minimum: 0.25, maximum: 10 }, wet_meters: { type: "number", minimum: 0.1, maximum: 3 },
          moist_meters: { type: "number", minimum: 0.2, maximum: 5 } }, required: ["channel_ha", "wet_meters"] },
      vegetation: { type: "object", description: `Vegetationens minsta yta i m² (förval ${GEO_JOB_DEFAULTS.minAreaM2})`,
        properties: { min_area_m2: { type: "integer", minimum: 50, maximum: 5000 } }, required: ["min_area_m2"] },
      raw_laser: { type: "boolean", description: "Spara även rå laserdata i 7 dygn (bara när rawLaserAvailable är sant i list_laser_jobs)" } },
      required: ["project_id"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "read_laser_output", title: "Läs en vektorfil ur en laserkörning", description: `Objekten i en vektorfil (DXF eller GeoJSON) ur projektets senaste klara laserkörning som har filen (eller job_id), omräknade till kartans mm med y uppåt (samma som list_objects och propose_changes). file är filens namn ur list_laser_jobs, t.ex. kurvor.dxf, formlinjer.dxf, brantlinjer.geojson, kullar.geojson, vatten.geojson, vegetation.dxf, fukt.dxf, diken.dxf, berg.dxf eller belagt.dxf (belagd yta ur laserns intensitet, sprintkartor); utan ändelse tas GeoJSON före DXF. Varje objekt har lager, slag (point, line, area), punkter ([x, y]; at för punkter, points för linjer, rings för ytor), höjd (elevation, kurvor) och egenskaper (properties, t.ex. kullarnas rise, share, foot och wet eller branternas drop3, drop6 och length). Ange area för ett utsnitt och layers för vissa lager; svaret räknar också objekten per lager. Högst ${MCP_LASER_OUTPUT_MAX_OBJECTS} objekt (limit, förval 100), ${MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT} punkter per objekt (max_points, förval 50; längre linjer glesas jämnt och vertices säger hur många de hade) och ${MCP_LASER_OUTPUT_MAX_POINTS} punkter per svar; truncated och nextOffset säger att mer finns (fortsätt med offset). Filer över ${Math.round(MCP_LASER_OUTPUT_MAX_BYTES / (1024 * 1024))} MB läses inte.`,
    inputSchema: { type: "object", properties: { ...projectId, file: { type: "string", description: "Filens namn, t.ex. kurvor.dxf eller kullar" }, job_id: { type: "string" },
      area: { type: "object", description: "Område i kartans mm med y uppåt. Utelämnat = hela filen.",
        properties: { min_x: { type: "number" }, min_y: { type: "number" }, max_x: { type: "number" }, max_y: { type: "number" } }, required: ["min_x", "min_y", "max_x", "max_y"] },
      layers: { type: "array", items: { type: "string" }, maxItems: 50 }, limit: { type: "integer", minimum: 1, maximum: MCP_LASER_OUTPUT_MAX_OBJECTS },
      offset: { type: "integer", minimum: 0 }, max_points: { type: "integer", minimum: 2, maximum: MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT } },
      required: ["project_id", "file"] }, annotations: { readOnlyHint: true } }
] as const;
export const MCP_LASER_TOOL_NAMES: ReadonlySet<string> = new Set(MCP_LASER_TOOLS.map(tool => tool.name));

export interface McpLaserOptions { wait?: { timeoutMs?: number; pollMs?: number } | undefined; runtime?: LaserRuntime | undefined; now?: Date | undefined }

function jobFailure(outcome: Exclude<MapJobOutcome, { status: "done" }>): ToolResult {
  if (outcome.status === "throttled") return toolError("För många anrop just nu (högst 30 kartjobb per minut och två samtidigt). Vänta en stund.");
  if (outcome.status === "timeout") return toolError("Kartjobbet tog för lång tid. Försök igen, eller med ett mindre område eller en mindre fil.");
  return toolError(`Kartjobbet misslyckades: ${outcome.error}`);
}

/** Varför körningen inte startades, i ord som säger vad som behöver göras. */
function refusal(result: { status: string; detail?: string }): string {
  switch (result.status) {
    case "forbidden": return "Laserkörningen startades inte: ägaren har satt AI-kopplingen till att bara läsa i det här projektet (aiMode READ), eller så har kontot inte rollen Föreslå eller högre i ett öppet projekt.";
    case "not-found": return "Projektet finns inte eller kontot är inte medlem.";
    case "no-credential":
      if (result.detail === "NO_MASTER_KEY") return "Kontots uppgifter till Lantmäteriet är sparade men servern saknar nyckeln som öppnar dem (OTID_EVENTOR_MASTER_KEY). Det rättas på servern, inte i kontot.";
      if (result.detail === "KEY_CHANGED") return "Kontots uppgifter till Lantmäteriet är sparade med en äldre servernyckel och går inte att öppna. Spara dem igen i O-Tid under Mitt konto → Kartkällor.";
      if (result.detail === "UNREADABLE") return "Kontots uppgifter till Lantmäteriet är sparade men gick inte att läsa (dekrypteringen misslyckades). Spara dem igen i O-Tid under Mitt konto → Kartkällor; se serverloggen om det återkommer.";
      return "Kontot har inga sparade uppgifter till Lantmäteriet. Ägaren sparar dem i O-Tid under Mitt konto → Kartkällor.";
    case "rejected": return "Lantmäteriet godkände inte kontots uppgifter (eller kontot saknar laserdata i sin beställning).";
    case "too-large": return "Området är för stort för en laserkörning. Dela kartan i etapper och kör en etapp i taget (area_id).";
    case "throttled": return "För många sökningar hos Lantmäteriet (högst 30 i timmen per konto). Vänta en stund.";
    case "busy": return "Kontot har redan två laserkörningar som väntar eller pågår. Vänta tills en är klar (list_laser_jobs).";
    case "quota": return "Kontots månadskvot av laserrutor räcker inte för körningen.";
    case "unavailable": return `Lantmäteriet svarade inte som väntat (${result.detail ?? "okänt fel"}). Försök igen senare.`;
    case "invalid-request": return "Körningen avvisades: en inställning är okänd eller utanför sina gränser, eller så är klipprutan för stor (högst 12 km i sida).";
    default: return `Laserkörningen startades inte (${result.status}).`;
  }
}

const jobView = (job: GeoJobView, workerVersion: number | null) => ({ jobId: job.jobId, name: job.name, kind: job.kind,
  ...(job.engine ? { engine: job.engine } : {}), status: job.status, progress: job.progress,
  error: job.error, workerVersion, areaId: job.areaId, clip: job.clip, tiles: job.tiles, scannedAt: job.scannedAt, settings: job.settings,
  cliffs: job.cliffs, moisture: job.moisture, vegetation: job.vegetation, extras: job.extras,
  ...(job.skippedSteps.length ? { skippedSteps: job.skippedSteps } : {}),
  ...(job.mergedStages !== undefined ? { mergedStages: job.mergedStages } : {}),
  createdAt: job.createdAt, startedAt: job.startedAt ?? null, finishedAt: job.finishedAt, attempts: job.attempts ?? 0,
  summary: job.summary ?? null,
  ...(job.rawLaserRequested ? { rawLaserRequested: true } : {}), ...(job.rawLaser ? { rawLaser: job.rawLaser } : {}),
  outputs: job.outputs.map(output => ({ name: output.name, bytes: output.byteSize })) });

/** Ett av laserverktygen; argumenten är redan prövade mot verktygets schema och kontot får se projektet. */
export async function callMcpLaserTool(db: Database, accountId: string, name: string, input: { project_id: string } & Record<string, unknown>,
  options: McpLaserOptions = {}): Promise<ToolResult> {
  const project = input.project_id, now = options.now ?? new Date();
  const runtime = options.runtime ?? laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(process.env));
  const job = (kind: "LASER_AREA" | "LASER_OUTPUT", request: Record<string, unknown>) => runMapJobAndWait(db, { accountId, projectId: project, kind, request }, options.wait ?? {});
  if (name === "list_laser_jobs") {
    const listed = await listGeoJobsForAccount(db, { accountId, projectId: project }, runtime.environment, now);
    if (listed.status !== "ok") return toolError(refusal(listed));
    const areas = await db.transaction(tx => mapProjectAreaViews(tx, project));
    return { content: [text({ server: listed.list.server, rawLaserAvailable: listed.list.rawLaserAvailable ?? false,
      areas: areas.map(area => ({ areaId: area.areaId, name: area.name, status: area.status })),
      jobs: listed.list.jobs.map(view => jobView(view, listed.workerVersions.get(view.jobId) ?? null)) })] };
  }
  if (name === "start_laser_job") {
    // Prövas först, så att varken kartjobb eller sökning hos Lantmäteriet görs för ett projekt där AI:n bara får läsa.
    const allowed = await db.transaction(tx => aiGate(accountId, project, now)(tx, "propose", false));
    if (allowed.status !== "ok") return toolError(refusal(allowed));
    const customClip = input.clip as GeoClip | undefined;
    const rerunOf = typeof input.rerun_of === "string" ? input.rerun_of : undefined;
    const engine = input.engine === "otidgeo" || input.engine === "pullautin" ? input.engine : undefined;
    const cliffs = input.cliffs as GeoJobView["cliffs"] | undefined;
    const moisture = (input.moisture as GeoJobView["moisture"] | undefined)
      ?? { channelHa: GEO_JOB_DEFAULTS.channelHa, wetMeters: GEO_JOB_DEFAULTS.wetMeters, moistMeters: Math.round(GEO_JOB_DEFAULTS.wetMeters * 160) / 100 };
    const vegetation = (input.vegetation as GeoJobView["vegetation"] | undefined) ?? { minAreaM2: GEO_JOB_DEFAULTS.minAreaM2 };
    const rawLaser = input.raw_laser === true ? true : undefined;
    let requestBody: Record<string, unknown>;
    if (rerunOf) {
      // Omkörning av tidigare jobb (ev. med en mindre provruta i clip): rutor, motor (om ej angiven) och extras ärvs utan ny sökning hos Lantmäteriet.
      requestBody = {
        formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", ...(engine ? { engine } : {}),
        name: (typeof input.name === "string" ? input.name : customClip ? "Karttapullautin provruta" : "Karttapullautin omkörning").slice(0, 80),
        settings: { contour_interval: typeof input.contour_interval === "number" ? input.contour_interval : GEO_JOB_DEFAULTS.contourInterval,
          formline: GEO_JOB_DEFAULTS.formline, ...(input.settings as Record<string, number> | undefined) },
        rerunOf, ...(customClip ? { clip: customClip } : {}), ...(cliffs ? { cliffs } : {}), moisture, vegetation, ...(rawLaser ? { rawLaser: true } : {})
      };
    } else {
      const stage = typeof input.area_id === "string" ? (await db.transaction(tx => mapProjectAreaViews(tx, project))).find(area => area.areaId === input.area_id) : undefined;
      if (typeof input.area_id === "string" && !stage) return toolError("Etappen finns inte i projektet (list_laser_jobs visar etapperna).");
      let searchWgs84: unknown, clip: GeoClip | null | undefined, sprint = false;
      if (customClip) {
        const box = clipWgs84(customClip);
        if (!box || !Object.values(box).every(Number.isFinite)) return toolError("Klipprutan (SWEREF 99 TM) gick inte att räkna om till WGS 84.");
        searchWgs84 = box; clip = customClip;
      } else {
        const outcome = await job("LASER_AREA", stage ? { stage: stage.polygon } : {});
        if (outcome.status !== "done") return jobFailure(outcome);
        const boxes = outcome.result as { problem?: string; wgs84?: unknown; clip?: GeoClip | null; sprint?: boolean };
        if (boxes.problem) return toolError(boxes.problem);
        searchWgs84 = boxes.wgs84; clip = boxes.clip; sprint = boxes.sprint === true;
      }
      const found = await searchMapProjectLaserAsAi(db, { accountId, projectId: project, request: { formatVersion: 1, box: searchWgs84 } }, runtime, now);
      if (found.status !== "ok") return toolError(refusal(found));
      const tiles = newestLaserTiles(found.items).map(item => ({ id: item.id, href: item.href, bbox: item.bbox, epsg: item.epsg, datetime: item.datetime }));
      if (tiles.length === 0) return toolError("Lantmäteriet har inga laserrutor för området.");
      if (tiles.length > GEO_JOB_MAX_TILES) return toolError(`Området täcker ${tiles.length} laserrutor; en körning tar högst ${GEO_JOB_MAX_TILES}. Dela kartan i etapper och kör en etapp i taget (area_id eller clip).`);
      requestBody = {
        formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", engine: engine ?? "otidgeo",
        name: (typeof input.name === "string" ? input.name : customClip ? "Karttapullautin provruta" : `Karttapullautin ${stage?.name ?? "hela kartan"}`).slice(0, 80),
        settings: { contour_interval: typeof input.contour_interval === "number" ? input.contour_interval : sprint ? 2.5 : GEO_JOB_DEFAULTS.contourInterval,
          formline: GEO_JOB_DEFAULTS.formline,
          // Sprintkartor får belagd yta ur laserns intensitet (belagt.dxf) som förval; settings går före.
          ...(sprint ? { paved: 1 } : {}), ...(input.settings as Record<string, number> | undefined) },
        tiles, ...(clip ? { clip } : {}), ...(stage ? { areaId: stage.areaId } : {}),
        ...(clip && found.extras.length ? { extras: found.extras } : {}),
        ...(cliffs ? { cliffs } : {}), moisture, vegetation, ...(rawLaser ? { rawLaser: true } : {})
      };
    }
    const created = await createGeoJobAsAi(db, { accountId, projectId: project, request: requestBody }, runtime, now);
    if (created.status !== "created") {
      if (created.status === "not-found" && rerunOf) return toolError("Körningen i rerun_of finns inte i projektet eller saknar laserrutor (list_laser_jobs visar jobben).");
      return toolError(refusal(created));
    }
    if (created.split) {
      return { content: [text({ ...jobView(created.job, null), stages: created.split.total, message: `Området är för stort för en körning och har delats i ${created.split.total} etapper, som ligger i kön och körs efter varandra (den här är den första). Följ dem med list_laser_jobs. Kartan ändras inte av körningarna.` })] };
    }
    return { content: [text({ ...jobView(created.job, null), message: "Laserkörningen är köad. Geo-servern startas vid behov och en körning tar ofta 10–60 minuter; följ den med list_laser_jobs. Kartan ändras inte av körningen." })] };
  }
  if (name === "read_laser_output") {
    const file = await findGeoVectorOutput(db, project, String(input.file), typeof input.job_id === "string" ? input.job_id : undefined);
    if (!file) return toolError("Ingen klar laserkörning i projektet har den vektorfilen. list_laser_jobs visar jobben och deras filer (raster läses med training_raster).");
    if (file.byteSize > MCP_LASER_OUTPUT_MAX_BYTES) {
      return toolError(`Filen ${file.name} är för stor att läsa här (${Math.round(file.byteSize / 1e6)} MB, högst ${Math.round(MCP_LASER_OUTPUT_MAX_BYTES / 1e6)} MB). Kör laserjobbet för en etapp i taget.`);
    }
    const outcome = await job("LASER_OUTPUT", { file: { name: file.name, sha256: file.sha256, laser: file.laser },
      ...Object.fromEntries(Object.entries({ area: input.area, layers: input.layers, limit: input.limit, offset: input.offset, maxPoints: input.max_points })
        .filter(([, value]) => value !== undefined)) });
    if (outcome.status !== "done") return jobFailure(outcome);
    const result = outcome.result as { problem?: string };
    return result.problem ? toolError(result.problem) : { content: [text({ jobId: file.jobId, ...result })] };
  }
  return toolError(`Okänt verktyg ${name}`);
}
