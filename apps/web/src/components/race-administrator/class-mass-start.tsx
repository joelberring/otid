import { startDrawPreviewResponseSchema, startDrawResponseSchema, startDrawSetupResponseSchema, type StartDrawPreviewResponse,
  type StartDrawRequest } from "@o-tid/contracts";
import { formatClockTime, normalizeClock, parseRaceClockNear } from "@o-tid/domain";
import { isClassRelevantDrawWarning } from "./start-draw-waves";
import type { Workspace } from "./workspace-state";

export type ClassMassStartOutcome =
  | { kind: "SAVED"; clock: string; recalculatedCount: number }
  | { kind: "INVALID" | "CANCELLED" | "ERROR" | "BUSY" };

/**
 * Masstart direkt på klassen (ägaren 2026-11-08 och 2026-11-15: «lägga till masstart för en klass, lägga till tiden och se
 * starttiden i deltagarlistan»): en lottning med masstart för bara den här klassen, samma väg som Start → Lottning. Alla i
 * klassen får tiden, och efteranmälda får den också. Lottningen ger klassen fast starttid, så det går lika bra från fri start.
 */
export async function saveClassMassStart(
  ws: Workspace,
  classId: string,
  clock: string,
  confirm: (preview: StartDrawPreviewResponse, clock: string) => Promise<boolean>
): Promise<ClassMassStartOutcome> {
  if (ws.writingRef.current || ws.pending.current || !ws.requireSession()) return { kind: "BUSY" };
  const normalized = normalizeClock(clock);
  if (!normalized || normalized.length !== 5) return { kind: "INVALID" };
  // Fas 1: förhandsvisning i egen operation så att 15 s-timern avslutas innan eventuell bekräftelsedialog visas.
  let settings: {
    firstStartTime: string; clubSeparation: false;
    classes: [{ classId: string; method: "MASS"; intervalMinutes: 1; vacancies: { kind: "COUNT"; value: 0 };
      laterStart: { kind: "CLOCK"; startTime: string } }];
  };
  let preview: StartDrawPreviewResponse;
  let actualClock: string;
  const previewOp = ws.beginRequest(true);
  try {
    const setupResponse = await ws.request("/draw", previewOp);
    if (!setupResponse.ok) throw new Error("Draw setup unavailable");
    const setup = startDrawSetupResponseSchema.parse(await ws.json(setupResponse, previewOp));
    const currentClass = setup.classes.find(row => row.id === classId);
    const firstStartTime = parseRaceClockNear(setup.raceDate, normalized, setup.timeZone, currentClass?.firstStartTime ?? setup.firstStartTime);
    if (!firstStartTime || Date.parse(firstStartTime) % 60_000 !== 0) return { kind: "INVALID" };
    settings = {
      firstStartTime,
      clubSeparation: false,
      classes: [{
        classId,
        method: "MASS",
        intervalMinutes: 1,
        vacancies: { kind: "COUNT", value: 0 },
        laterStart: { kind: "CLOCK", startTime: firstStartTime }
      }]
    };
    const previewResponse = await ws.request("/draw-preview", previewOp, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": ws.csrf() }, body: JSON.stringify({ formatVersion: 1, ...settings }) });
    if (!previewResponse.ok) throw new Error("Draw preview unavailable");
    preview = startDrawPreviewResponseSchema.parse(await ws.json(previewResponse, previewOp));
    const actualStartTime = preview.classes.find(row => row.classId === classId)?.firstStartTime ?? firstStartTime;
    actualClock = formatClockTime(actualStartTime, preview.timeZone).slice(0, 5);
  } catch { return ws.current(previewOp) ? { kind: "ERROR" } : { kind: "BUSY" }; }
  finally { ws.finish(previewOp); }
  // Fas 2: eventuell bekräftelse utan aktiv avbrottstimer.
  const hasRelevantWarning = preview.warnings.some(isClassRelevantDrawWarning);
  if ((preview.requiresConfirmation || hasRelevantWarning) && !(await confirm(preview, actualClock))) {
    return { kind: "CANCELLED" };
  }
  // Fas 3: spara i egen skrivoperation (`begin(true)` markerar andra stegs underlag som inaktuella).
  if (ws.writingRef.current || ws.pending.current || !ws.requireSession()) return { kind: "BUSY" };
  const saveOp = ws.begin(true);
  try {
    const request: StartDrawRequest = { formatVersion: 1, requestId: crypto.randomUUID(), seed: preview.seed, ...settings,
      confirmChanges: preview.requiresConfirmation };
    const response = await ws.request("/draw", saveOp, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": ws.csrf(), "idempotency-key": `start-draw:${request.requestId}` },
      body: JSON.stringify(request) });
    if (!response.ok) throw new Error("Draw not saved");
    const receipt = startDrawResponseSchema.parse(await ws.json(response, saveOp));
    // Lottningen gav klassen fast starttid: formuläret ska inte spara tillbaka fri start, och översikten läses om så att
    // nästa anmälan i klassen inte avvisas som inaktuell.
    ws.changeClassEdit({ startRule: "FIXED" });
    await ws.readCourses(saveOp); await ws.load(saveOp);
    return { kind: "SAVED", clock: actualClock, recalculatedCount: receipt.recalculatedCount };
  } catch { return ws.current(saveOp) ? { kind: "ERROR" } : { kind: "BUSY" }; }
  finally { ws.finish(saveOp); }
}
