import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { mcpCourseToolInputSchemas } from "@o-tid/contracts";
import {
  checkDocument, courseControlOrder, courseLength, describeControl, isCourseLevel, suggestedCourseLevel, type CourseSettingDocument
} from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import { requireCourseSettingForAccount, type CourseSettingRequirement } from "./course-setting-access";
import { insertCourseSettingNote } from "./course-setting-notes";
import { runMapJobAndWait } from "./map-project-jobs";
type JobWaitOptions = { timeoutMs?: number; pollMs?: number };

/**
 * Ägaren 2026-11-08: AI-banläggningsassistenten. MCP-verktygen (behörigheten `banlaggning`) läser banläggningen i tävlingar
 * där kontot får lägga banor (samma prövning som sidan, `requireCourseSettingForAccount`) och lämnar notiser som banläggaren
 * tar ställning till. Inget ändras i en bana, en tävling eller ett resultat. Banorna är hemliga: verktygen svarar bara kontot
 * som har behörigheten.
 */
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };
type ToolResult = { content: Content[]; isError?: boolean };
const text = (value: unknown): Content => ({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) });
const toolError = (message: string): ToolResult => ({ content: [text(message)], isError: true });
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Notisens text börjar med det här, så att banläggaren ser att den kommer från AI-kopplingen. */
export const AI_NOTE_PREFIX = "AI-granskning: ";

const raceIdProperty = { race_id: { type: "string", description: "Tävlingens id (från list_course_settings)" } };
export const MCP_COURSE_TOOLS = [
  { name: "list_course_settings", title: "Mina banläggningar", description: "Tävlingarna där kontot får se banläggningen: id, namn, datum, behörighet och antal banor.",
    inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "course_overview", title: "Banorna i en tävling", description: "Banorna med målnivå (Grön, Vit, Gul, Orange, Röd, Violett, Blå, Svart eller förslag ur klassnamnen), klasser, längd och stigning, kontrollerna i ordning (kod, beskrivning i text, läge i kartans mm med y uppåt) och sträckorna (fågelvägen i meter, riktning i grader från norr), samt O-Tids varningar. Ange course_id för en bana. Börja här för att granska nivån.",
    inputSchema: { type: "object", properties: { ...raceIdProperty, course_id: { type: "string", description: "Bara den här banan" } }, required: ["race_id"] },
    annotations: { readOnlyHint: true } },
  { name: "render_course", title: "Bild av en bana", description: "En bild (PNG, högst 1600 px) av banan på tävlingens karta, i kartans färger med banan i lila och ett rutnät i kartans mm (samma lägen som course_overview). Ange area för ett utsnitt, t.ex. en sträcka. Titta på vägvalen och kontrollernas omgivning när du granskar nivån.",
    inputSchema: { type: "object", properties: { ...raceIdProperty, course_id: { type: "string" }, width_px: { type: "integer", minimum: 200, maximum: 1600 },
      grid: { type: "boolean", description: "Rutnätet (förval ja)" }, area: { type: "object", description: "Utsnitt i kartans mm med y uppåt",
        properties: { min_x: { type: "number" }, min_y: { type: "number" }, max_x: { type: "number" }, max_y: { type: "number" } },
        required: ["min_x", "min_y", "max_x", "max_y"] } }, required: ["race_id", "course_id"] }, annotations: { readOnlyHint: true } },
  { name: "add_course_note", title: "Lämna en notis i banläggningen", description: "Lämnar en notis (granskning eller förslag) på en bana, en kontroll, en sträcka eller en punkt. Banläggaren läser den och tar ställning; inget ändras i banorna. Skriv konkret: vad, varför och ett förslag.",
    inputSchema: { type: "object", properties: { ...raceIdProperty, text: { type: "string", maxLength: 2000 }, course_id: { type: "string" },
      control_id: { type: "string" }, leg: { type: "object", properties: { from_control_id: { type: "string" }, to_control_id: { type: "string" } },
        required: ["from_control_id", "to_control_id"] }, point_mm: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } },
      required: ["race_id", "text"] }, annotations: { readOnlyHint: false, destructiveHint: false } }
] as const;
export const MCP_COURSE_TOOL_NAMES: ReadonlySet<string> = new Set(MCP_COURSE_TOOLS.map(tool => tool.name));

async function access(db: Database, accountId: string, raceId: string, required: CourseSettingRequirement): Promise<string | undefined> {
  const result = await db.transaction(tx => requireCourseSettingForAccount(tx, accountId, raceId, required));
  if (result.status === "authenticated") return undefined;
  return result.status === "forbidden" && required === "COMMENT" ? "Kontot har ingen behörighet att skriva notiser i tävlingens banläggning."
    : "Tävlingen finns inte eller kontot har ingen behörighet i dess banläggning.";
}

/** Tävlingarna där kontot kan ha behörighet (evenemangets ägare och administratörer, eller en behörighet i banläggningen). */
async function listCourseSettings(db: Database, accountId: string) {
  const candidates = await db.select({ raceId: schema.races.id, name: schema.races.name, date: schema.races.raceDate, event: schema.events.name })
    .from(schema.courseSettings)
    .innerJoin(schema.races, eq(schema.races.id, schema.courseSettings.raceId))
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(or(
      inArray(schema.races.eventId, db.select({ id: schema.eventAdministrationGrants.eventId }).from(schema.eventAdministrationGrants)
        .where(eq(schema.eventAdministrationGrants.accountId, accountId))),
      inArray(schema.races.id, db.select({ id: schema.courseSettingGrants.raceId }).from(schema.courseSettingGrants)
        .where(and(eq(schema.courseSettingGrants.accountId, accountId), sql`${schema.courseSettingGrants.level} <> 'MAP'`)))))
    .orderBy(desc(schema.races.raceDate)).limit(60);
  const races = [];
  for (const row of candidates) {
    const allowed = await db.transaction(tx => requireCourseSettingForAccount(tx, accountId, row.raceId, "COMMENT"));
    if (allowed.status !== "authenticated") continue;
    const [setting] = await db.select({ document: schema.courseSettings.document }).from(schema.courseSettings).where(eq(schema.courseSettings.raceId, row.raceId));
    const courses = ((setting?.document as { courses?: unknown[] } | undefined)?.courses ?? []).length;
    races.push({ raceId: row.raceId, race: row.name, event: row.event, date: row.date, access: allowed.principal.level, courses });
  }
  return { races };
}

/** Banorna för granskningen: nivå, klasser, längd, kontroller och sträckor, varningar. */
export function courseOverviewOf(document: CourseSettingDocument, courseId?: string) {
  const mmToM = document.event.mapScale / 1000;
  const courses = document.courses.filter(course => !courseId || course.id === courseId).sort((a, b) => a.order - b.order);
  const checks = checkDocument(document);
  return {
    mapScale: document.event.mapScale,
    coordinates: "Lägen i kartans mm med y uppåt; meter = mm × kartans skala / 1000.",
    courses: courses.map(course => {
      let order: readonly string[] = [];
      try { order = courseControlOrder(document, course.id); } catch { order = []; }
      const controls = order.flatMap(ccId => {
        const control = document.controls[document.courseControls[ccId]?.control ?? ""];
        if (!control) return [];
        let description = "";
        try { description = describeControl(document, control.id, "sv"); } catch { description = ""; }
        return [{ controlId: control.id, kind: control.kind, code: control.code ?? null, description, atMm: [round(control.at.x, 1), round(control.at.y, 1)] }];
      });
      const legs = controls.slice(1).map((control, index) => {
        const from = controls[index]!;
        const dx = control.atMm[0]! - from.atMm[0]!, dy = control.atMm[1]! - from.atMm[1]!;
        return { fromControlId: from.controlId, toControlId: control.controlId, from: from.code ?? from.kind, to: control.code ?? control.kind,
          straightMeters: Math.round(Math.hypot(dx, dy) * mmToM), bearingDegrees: Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) };
      });
      let length: { meters: number; min: number; max: number } | null = null;
      try { const value = courseLength(document, course.id); length = { meters: Math.round(value.meters), min: Math.round(value.min), max: Math.round(value.max) }; }
      catch { length = null; }
      const suggested = suggestedCourseLevel(course);
      return {
        courseId: course.id, name: course.name, kind: course.kind, classes: course.secondaryTitle ?? null,
        level: course.level && isCourseLevel(course.level) ? course.level : null, levelFromClassNames: suggested ?? null,
        printScale: course.printScale ?? document.event.mapScale, lengthMeters: length, climbMeters: course.climbMeters ?? null,
        controls, legs,
        warnings: checks.filter(check => !("course" in check) || check.course === course.id).slice(0, 100)
      };
    })
  };
}

export async function callMcpCourseTool(db: Database, accountId: string, name: string, args: unknown, now = new Date(), wait: JobWaitOptions = {})
  : Promise<ToolResult> {
  if (name === "list_course_settings") return { content: [text(await listCourseSettings(db, accountId))] };
  const schemaFor = mcpCourseToolInputSchemas[name as keyof typeof mcpCourseToolInputSchemas];
  if (!schemaFor) return toolError(`Okänt verktyg ${name}`);
  const parsed = schemaFor.safeParse(args ?? {});
  if (!parsed.success) return toolError(`Ogiltiga argument: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "(argumenten)"}: ${issue.message}`).join("; ")}`);
  const input = parsed.data as { race_id: string; course_id?: string; text?: string; control_id?: string; width_px?: number; grid?: boolean;
    area?: { min_x: number; min_y: number; max_x: number; max_y: number };
    leg?: { from_control_id: string; to_control_id: string }; point_mm?: [number, number] };
  const denied = await access(db, accountId, input.race_id, "COMMENT");
  if (denied) return toolError(denied);
  const [row] = await db.select({ document: schema.courseSettings.document }).from(schema.courseSettings).where(eq(schema.courseSettings.raceId, input.race_id));
  if (!row) return toolError("Tävlingen har ingen banläggning än.");
  const document = row.document as unknown as CourseSettingDocument;
  if (name === "course_overview") {
    if (input.course_id && !document.courses.some(course => course.id === input.course_id)) return toolError("Banan finns inte.");
    return { content: [text(courseOverviewOf(document, input.course_id))] };
  }
  if (name === "render_course") {
    if (!document.courses.some(course => course.id === input.course_id)) return toolError("Banan finns inte.");
    const area = input.area ? { minX: input.area.min_x, minY: input.area.min_y, maxX: input.area.max_x, maxY: input.area.max_y } : undefined;
    const outcome = await runMapJobAndWait(db, { accountId, raceId: input.race_id, kind: "COURSE_RENDER", request: { document: document as unknown as Record<string, unknown>,
      course: input.course_id, ...(input.width_px ? { widthPx: input.width_px } : {}), grid: input.grid !== false, ...(area ? { area } : {}) } }, wait);
    if (outcome.status === "throttled") return toolError("För många anrop just nu (högst 30 kartjobb per minut och två samtidigt). Vänta en stund.");
    if (outcome.status === "timeout") return toolError("Bilden tog för lång tid. Försök med ett mindre utsnitt.");
    if (outcome.status === "failed") return toolError(`Bilden kunde inte ritas: ${outcome.error}`);
    if (!outcome.image) return toolError("Bilden saknas");
    return { content: [{ type: "image", data: Buffer.from(outcome.image).toString("base64"), mimeType: "image/png" }, text(outcome.result)] };
  }
  // add_course_note
  const target = input.control_id ? { kind: "CONTROL" as const, control: input.control_id }
    : input.leg ? { kind: "LEG" as const, from: input.leg.from_control_id, to: input.leg.to_control_id }
      : input.point_mm ? { kind: "POINT" as const, at: { x: input.point_mm[0], y: input.point_mm[1] } }
        : input.course_id ? { kind: "COURSE" as const, course: input.course_id } : undefined;
  if (!target) return toolError("Ange course_id, control_id, leg eller point_mm.");
  const request = { formatVersion: 1 as const, requestId: randomUUID(), target, at: null, course: target.kind === "COURSE" ? target.course : input.course_id ?? null,
    text: `${AI_NOTE_PREFIX}${input.text!}`.slice(0, 2000), photo: null, kind: "COURSE_SETTING" as const };
  const created = await db.transaction(async tx => {
    const again = await requireCourseSettingForAccount(tx, accountId, input.race_id, "COMMENT", now);
    if (again.status !== "authenticated") return { status: "forbidden" as const };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-setting:" + input.race_id}, 0))`);
    return insertCourseSettingNote(tx, input.race_id, accountId, request, undefined, now);
  });
  if (created.status === "forbidden") return toolError("Ingen behörighet.");
  if (created.status === "conflict") return toolError("Banan, kontrollen eller sträckan finns inte i banläggningen (se course_overview).");
  return { content: [text({ noteId: created.note.id, message: "Notisen ligger i banläggningen och syns för banläggaren under Notiser." })] };
}
