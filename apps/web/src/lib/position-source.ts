/**
 * Varifrån positionerna kommer (ADR-0227): webbläsarens `navigator.geolocation.watchPosition`, eller O-Tids app, där den
 * inbyggda modulen skriver varje punkt till en journal och webben spelar upp journalen. Båda ger punkterna i samma form.
 */
import { removeListener, TRACKING_READ_LIMIT, type TrackingBridge, type TrackingFix, type TrackingPage, type TrackingStoppedBy } from "./otid-tracking";

/** En position. `t` är positionens tid, `receivedAt` när telefonen fick den. `seq` finns bara för appens punkter. */
export interface PositionFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  readonly t: number;
  readonly receivedAt: number;
  readonly seq?: number | undefined;
}

/** Webbläsarens fel (som i dag) och appens: nekad plats, ungefärlig plats, avstängd spårning, maxtiden, modulen svarar inte. */
export type PositionProblem = "denied" | "positionFailed" | "appDenied" | "appImprecise" | "trackingStopped" | "trackingDeadline" | "trackingFailed";

export interface PositionHandlers {
  /** Punkterna i tidsordning. `live` = just nu; annars uppspelade ur appens journal. */
  onFixes: (fixes: readonly PositionFix[], live: boolean) => void;
  /** Ett problem, eller undefined när appens spårning går som den ska. */
  onProblem: (problem: PositionProblem | undefined) => void;
}

export interface PositionWatch { stop: () => void }
export interface PositionSource { readonly kind: "browser" | "app"; watch: (handlers: PositionHandlers) => PositionWatch }

/** Webbläsarens väg: `watchPosition` med anroparens alternativ, en punkt i taget. */
export function browserPositionSource(options: PositionOptions): PositionSource {
  return {
    kind: "browser",
    watch: handlers => {
      const id = navigator.geolocation.watchPosition(position => handlers.onFixes([{ latitude: position.coords.latitude,
        longitude: position.coords.longitude, accuracyM: position.coords.accuracy, t: position.timestamp || Date.now(), receivedAt: Date.now() }], true),
      failure => handlers.onProblem(failure.code === failure.PERMISSION_DENIED ? "denied" : "positionFailed"), options);
      return { stop: () => navigator.geolocation.clearWatch(id) };
    }
  };
}

const validFix = (fix: TrackingFix) => Number.isInteger(fix.seq) && [fix.latitude, fix.longitude, fix.accuracyM, fix.t, fix.receivedAt].every(Number.isFinite);

/** Punkterna efter `afterSeq` i ordning efter `seq`, utan dubbletter och utan punkter med fel form. */
export function orderFixes(afterSeq: number, fixes: readonly TrackingFix[]): TrackingFix[] {
  const bySeq = new Map<number, TrackingFix>();
  for (const fix of fixes) if (validFix(fix) && fix.seq > afterSeq && !bySeq.has(fix.seq)) bySeq.set(fix.seq, fix);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** En punkt direkt från appen: redan räknad, nästa i ordningen, eller efter en lucka (då läses journalen). */
export function liveFixArrival(lastCounted: number, seq: number): "duplicate" | "next" | "gap" {
  return seq <= lastCounted ? "duplicate" : seq === lastCounted + 1 ? "next" : "gap";
}

/**
 * Spelar upp journalen efter `afterSeq`, sida för sida, tills den är slut. `deliver` får varje sida i ordning; ger den
 * senast lämnade `seq`. En sida utan nya punkter avslutar, så en modul som svarar fel kan inte ge en oändlig loop.
 */
export async function replayJournal(read: (afterSeq: number, limit: number) => Promise<TrackingPage>, afterSeq: number,
  deliver: (fixes: readonly TrackingFix[]) => void, limit = TRACKING_READ_LIMIT): Promise<number> {
  let cursor = afterSeq;
  for (;;) {
    const page = await read(cursor, limit);
    const fixes = orderFixes(cursor, page.fixes);
    if (fixes.length === 0) return cursor;
    deliver(fixes);
    cursor = fixes[fixes.length - 1]!.seq;
    if (cursor >= page.lastSeq) return cursor;
  }
}

const toPosition = (fix: TrackingFix): PositionFix =>
  ({ latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM, t: fix.t, receivedAt: fix.receivedAt, seq: fix.seq });
const stoppedProblem = (by: TrackingStoppedBy): PositionProblem => by === "deadline" ? "trackingDeadline" : "trackingStopped";

interface AppSession {
  readonly sessionId: string;
  readonly stopAtMs: number;
  readonly title: string;
  readonly text: string;
  /** Den senaste `seq` som loppet har räknat; uppspelningen börjar efter den. */
  readonly afterSeq: number;
  /** Starta även om spårningen stoppats för loppet (löparens tryck på «Starta GPS igen»). */
  readonly forceStart: boolean;
}
export interface AppPositionWatch extends PositionWatch {
  /** Räknar ikapp journalen (före Mål). */
  catchUp: () => Promise<void>;
}
export interface AppPositionSource extends PositionSource { readonly kind: "app"; watch: (handlers: PositionHandlers) => AppPositionWatch }

/**
 * Appens väg. Startar spårningen för loppet (om den inte redan går eller har stoppats för loppet: ingen tyst omstart),
 * lyssnar på `fix` och `stopped`, och spelar upp journalen när bevakningen börjar, när sidan syns igen och när en lucka i
 * `seq` upptäcks. Att sluta bevaka stoppar inte spårningen; det gör `stop` på bryggan när loppet är slut.
 */
export function appPositionSource(bridge: TrackingBridge, session: AppSession): AppPositionSource {
  return {
    kind: "app",
    watch: handlers => {
      const { sessionId } = session;
      let cursor = session.afterSeq;
      let disposed = false;
      let catching: Promise<void> | undefined;
      let buffered: TrackingFix[] = [];
      const fail = (what: string, error: unknown) => {
        console.error(what, error);
        if (!disposed) handlers.onProblem("trackingFailed");
      };
      const deliver = (fixes: readonly TrackingFix[], live: boolean) => {
        if (disposed || fixes.length === 0) return;
        cursor = fixes[fixes.length - 1]!.seq;
        handlers.onFixes(fixes.map(toPosition), live);
      };
      const live = (fix: TrackingFix) => {
        if (disposed || !validFix(fix)) return;
        if (catching) { buffered.push(fix); return; }
        const arrival = liveFixArrival(cursor, fix.seq);
        if (arrival === "next") deliver([fix], true);
        else if (arrival === "gap") void catchUp().catch((error: unknown) => fail("Journalen i appen kunde inte läsas", error));
      };
      const catchUp = (): Promise<void> => {
        if (disposed) return Promise.resolve();
        catching ??= (async () => {
          try {
            await replayJournal((afterSeq, limit) => bridge.read({ sessionId, afterSeq, limit }), cursor, fixes => deliver(fixes, false));
          } finally {
            catching = undefined;
            const pending = buffered;
            buffered = [];
            for (const fix of pending) live(fix);
          }
        })();
        return catching;
      };
      const checkStatus = async (): Promise<"tracking" | "stopped" | "other"> => {
        const status = await bridge.status();
        if (status.sessionId !== sessionId) return "other";
        if (status.tracking) return "tracking";
        if (status.stoppedBy) { handlers.onProblem(stoppedProblem(status.stoppedBy)); return "stopped"; }
        return "other";
      };

      const handles = [
        bridge.addListener("fix", live),
        bridge.addListener("stopped", event => {
          if (disposed || event.sessionId !== sessionId) return;
          handlers.onProblem(stoppedProblem(event.stoppedBy));
          void catchUp().catch((error: unknown) => fail("Journalen i appen kunde inte läsas", error));
        })
      ];
      const visibility = () => {
        if (document.visibilityState !== "visible") return;
        void checkStatus().then(() => catchUp()).catch((error: unknown) => fail("Spårningen i appen svarar inte", error));
      };
      document.addEventListener("visibilitychange", visibility);

      void (async () => {
        const state = session.forceStart ? "other" : await checkStatus();
        if (disposed) return;
        if (state === "tracking") handlers.onProblem(undefined);
        if (state === "other") {
          const permission = await bridge.requestPermission();
          if (disposed) return;
          if (permission.location !== "granted") handlers.onProblem("appDenied");
          else {
            await bridge.start({ sessionId, stopAtMs: session.stopAtMs, title: session.title, text: session.text });
            if (disposed) return;
            handlers.onProblem(permission.precise ? undefined : "appImprecise");
          }
        }
        await catchUp();
      })().catch((error: unknown) => fail("Spårningen i appen kunde inte startas", error));

      return {
        catchUp,
        stop: () => {
          disposed = true;
          document.removeEventListener("visibilitychange", visibility);
          for (const handle of handles) removeListener(handle);
        }
      };
    }
  };
}
