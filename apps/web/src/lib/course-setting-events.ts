import type { CourseSettingLevel, CourseSettingPresence } from "@o-tid/contracts";

/**
 * Steg 66 (ADR-0181 beslut 4): banläggningens ström till öppna editorer. Efter en lyckad skrivning (ny version, notis,
 * förslag, arbetssätt) får editorerna för tävlingen ett kort besked och hämtar själva det nya. Inget räknas här och inga
 * frågor ställs: det är ett nav i processen. Det räcker, eftersom allt för inloggade går till tävlingens instans `web`
 * (ADR-0177 beslut 2 och 7; lokalt och med `pnpm dev` gör en instans allt). Avläsningen berörs inte.
 *
 * Närvaron är de öppna strömmarna (en per editor), så den är billig och försvinner när fliken stängs.
 */
export type CourseSettingEvent =
  | { readonly type: "version"; readonly version: number; readonly by: string }
  | { readonly type: "notes"; readonly by: string }
  | { readonly type: "suggestions"; readonly by: string }
  | { readonly type: "mode"; readonly by: string }
  /** Steg 67: någon bockade en kontroll som kollad (eller av). */
  | { readonly type: "inspections"; readonly by: string }
  | { readonly type: "presence"; readonly people: CourseSettingPresence };

type Listener = (event: CourseSettingEvent) => void;
type Viewer = { accountId: string; displayName: string | null; level: CourseSettingLevel };
type Hub = { listeners: Map<string, Map<number, { listener: Listener; viewer: Viewer }>>; next: number };

const global = globalThis as typeof globalThis & { oTidCourseSettingHub?: Hub };
const hub = (): Hub => global.oTidCourseSettingHub ??= { listeners: new Map(), next: 1 };

/** Högst så många öppna strömmar per tävling (fler får 503 och sidan hämtar själv). */
export const COURSE_SETTING_STREAMS_PER_RACE = 100;

/** Vilka som är inne (en rad per konto, högst nivån). */
export function presenceOf(raceId: string): CourseSettingPresence {
  const people = new Map<string, Viewer>();
  for (const { viewer } of hub().listeners.get(raceId)?.values() ?? []) if (!people.has(viewer.accountId)) people.set(viewer.accountId, viewer);
  return [...people.values()].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "sv-SE")).slice(0, 200);
}

export function publishCourseSettingEvent(raceId: string, event: CourseSettingEvent): void {
  for (const { listener } of [...(hub().listeners.get(raceId)?.values() ?? [])]) {
    try { listener(event); } catch (error) { console.error("Banläggningens ström kunde inte skicka", error); }
  }
}

/** Lyssna på tävlingen; ger undefined när det redan finns för många strömmar. */
export function subscribeCourseSetting(raceId: string, viewer: Viewer, listener: Listener): (() => void) | undefined {
  const current = hub();
  const listeners = current.listeners.get(raceId) ?? new Map<number, { listener: Listener; viewer: Viewer }>();
  if (listeners.size >= COURSE_SETTING_STREAMS_PER_RACE) return undefined;
  const id = current.next++;
  const before = presenceOf(raceId);
  listeners.set(id, { listener, viewer });
  current.listeners.set(raceId, listeners);
  // Den nya strömmen får närvaron av `createCourseSettingEventStream`; de andra får veta att någon kom eller gick.
  const announce = (previous: CourseSettingPresence, except?: number) => {
    const people = presenceOf(raceId);
    if (JSON.stringify(previous) === JSON.stringify(people)) return;
    for (const [key, { listener: other }] of [...listeners]) {
      if (key === except) continue;
      try { other({ type: "presence", people }); } catch (error) { console.error("Banläggningens ström kunde inte skicka", error); }
    }
  };
  announce(before, id);
  return () => {
    const previous = presenceOf(raceId);
    listeners.delete(id);
    if (listeners.size === 0) current.listeners.delete(raceId);
    announce(previous);
  };
}

const encoder = new TextEncoder();
/** En händelse i SSE-format. */
export function formatCourseSettingEvent(event: CourseSettingEvent): Uint8Array {
  const { type, ...data } = event;
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(type === "presence" ? event.people : data)}\n\n`);
}

/** Strömmen för en editor: först närvaron, sedan händelserna, och en kommentar var 25:e sekund. */
export function createCourseSettingEventStream(request: Request, raceId: string, viewer: Viewer): ReadableStream<Uint8Array> | undefined {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const close = (closeController: boolean) => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    if (closeController) { try { controllerRef?.close(); } catch { /* redan stängd */ } }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const send = (event: CourseSettingEvent) => {
        if (closed) return;
        if (request.signal.aborted) { close(true); return; }
        controller.enqueue(formatCourseSettingEvent(event));
      };
      unsubscribe = subscribeCourseSetting(raceId, viewer, send);
      if (!unsubscribe) { closed = true; controller.close(); return; }
      request.signal.addEventListener("abort", () => close(true), { once: true });
      send({ type: "presence", people: presenceOf(raceId) });
      heartbeat = setInterval(() => {
        if (request.signal.aborted) close(true);
        else if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 25_000);
    },
    cancel() { close(false); }
  });
  if (closed) return undefined;
  return stream;
}
