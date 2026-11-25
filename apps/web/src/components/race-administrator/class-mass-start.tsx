import { startDrawPreviewResponseSchema, startDrawResponseSchema, startDrawSetupResponseSchema, type StartDrawRequest } from "@o-tid/contracts";
import { formatClockTime, parseRaceClock } from "@o-tid/domain";
import type { Workspace } from "./workspace-state";

export type ClassMassStartOutcome = { kind: "SAVED"; clock: string } | { kind: "INVALID" | "CANCELLED" | "ERROR" | "BUSY" };

/**
 * Masstart direkt på klassen (ägaren 2026-11-08 och 2026-11-15: «lägga till masstart för en klass, lägga till tiden och se
 * starttiden i deltagarlistan»): en lottning med masstart för bara den här klassen, samma väg som Start → Lottning. Alla i
 * klassen får tiden, och efteranmälda får den också. Lottningen ger klassen fast starttid, så det går lika bra från fri start.
 */
export async function saveClassMassStart(ws: Workspace, classId: string, clock: string, confirm: () => Promise<boolean>): Promise<ClassMassStartOutcome> {
  if (ws.writingRef.current || ws.pending.current || !ws.requireSession()) return { kind: "BUSY" };
  const op = ws.begin(true);
  try {
    const setupResponse = await ws.request("/draw", op);
    if (!setupResponse.ok) throw new Error("Draw setup unavailable");
    const setup = startDrawSetupResponseSchema.parse(await ws.json(setupResponse, op));
    const firstStartTime = parseRaceClock(setup.raceDate, clock, setup.timeZone);
    if (!firstStartTime || Date.parse(firstStartTime) % 60_000 !== 0) return { kind: "INVALID" };
    const settings = { firstStartTime, clubSeparation: false,
      classes: [{ classId, method: "MASS" as const, intervalMinutes: 1, vacancies: { kind: "COUNT" as const, value: 0 } }] };
    const previewResponse = await ws.request("/draw-preview", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": ws.csrf() }, body: JSON.stringify({ formatVersion: 1, ...settings }) });
    if (!previewResponse.ok) throw new Error("Draw preview unavailable");
    const preview = startDrawPreviewResponseSchema.parse(await ws.json(previewResponse, op));
    if (preview.requiresConfirmation && !(await confirm())) return { kind: "CANCELLED" };
    const request: StartDrawRequest = { formatVersion: 1, requestId: crypto.randomUUID(), seed: preview.seed, ...settings,
      confirmChanges: preview.requiresConfirmation };
    const response = await ws.request("/draw", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": ws.csrf(), "idempotency-key": `start-draw:${request.requestId}` },
      body: JSON.stringify(request) });
    if (!response.ok) throw new Error("Draw not saved");
    startDrawResponseSchema.parse(await ws.json(response, op));
    // Lottningen gav klassen fast starttid: formuläret ska inte spara tillbaka fri start, och översikten läses om så att
    // nästa anmälan i klassen inte avvisas som inaktuell.
    ws.changeClassEdit({ startRule: "FIXED" });
    await ws.readCourses(op); await ws.load(op);
    return { kind: "SAVED", clock: formatClockTime(firstStartTime, setup.timeZone).slice(0, 5) };
  } catch { return ws.current(op) ? { kind: "ERROR" } : { kind: "BUSY" }; }
  finally { ws.finish(op); }
}
