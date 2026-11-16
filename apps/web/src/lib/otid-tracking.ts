/**
 * Bryggan till O-Tids app (ADR-0227 beslut 2): den inbyggda modulen `OTidTracking`, som webbvyn når som
 * `window.Capacitor.Plugins.OTidTracking`. `apps/web` har inget Capacitor-beroende; här står bara kontraktets typer och en
 * åtkomst som ger bryggan när den finns och har de metoder som behövs. Annars gäller webbläsarens väg.
 */

/** En punkt ur journalen. `t` är positionens egen tid (GPS-tiden), `receivedAt` telefonens klocka, båda i ms. */
export interface TrackingFix {
  readonly seq: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  readonly t: number;
  readonly receivedAt: number;
}

export type TrackingStoppedBy = "user" | "deadline" | "system";
type PermissionAnswer = "granted" | "denied" | "prompt";

export interface TrackingPermission { readonly location: PermissionAnswer; readonly precise: boolean; readonly notifications: PermissionAnswer }
export interface TrackingStatus {
  readonly tracking: boolean;
  readonly sessionId: string | null;
  readonly lastSeq: number;
  readonly stopAtMs: number | null;
  readonly stoppedBy: TrackingStoppedBy | null;
}
export interface TrackingPage { readonly fixes: readonly TrackingFix[]; readonly lastSeq: number }
export interface TrackingStopped { readonly sessionId: string; readonly stoppedBy: TrackingStoppedBy }
interface ListenerHandle { remove: () => Promise<void> | void }

/** Modulens metoder. `post`, `signal` och `purge` kan saknas i en äldre app; då används webbläsarens väg för just dem. */
export interface TrackingBridge {
  requestPermission: () => Promise<TrackingPermission>;
  start: (options: { sessionId: string; stopAtMs: number; title: string; text: string }) => Promise<{ lastSeq: number }>;
  stop: (options: { sessionId: string }) => Promise<unknown>;
  status: () => Promise<TrackingStatus>;
  read: (options: { sessionId: string; afterSeq: number; limit: number }) => Promise<TrackingPage>;
  addListener: {
    (event: "fix", listener: (fix: TrackingFix) => void): Promise<ListenerHandle> | ListenerHandle;
    (event: "stopped", listener: (event: TrackingStopped) => void): Promise<ListenerHandle> | ListenerHandle;
  };
  post?: (options: { url: string; body: string }) => Promise<{ status: number; body: string }>;
  signal?: (options: { kind: "ok" }) => Promise<unknown>;
  purge?: (options: { sessionId: string }) => Promise<unknown>;
}

/** Högst så många punkter per `read` (kontraktets gräns är 2000). */
export const TRACKING_READ_LIMIT = 500;

const REQUIRED = ["requestPermission", "start", "stop", "status", "read", "addListener"] as const;
const OPTIONAL = ["post", "signal", "purge"] as const;

/** Bryggan om sidan körs i appen och modulen har spårningens metoder; annars undefined (webbläsarens väg). */
export function trackingBridge(): TrackingBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const plugin = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins?.OTidTracking as
    Record<string, unknown> | undefined;
  if (!plugin || REQUIRED.some(name => typeof plugin[name] !== "function")) return undefined;
  const bridge: Record<string, unknown> = {};
  // Metoderna bundna till modulen (Capacitors objekt kan behöva `this`).
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const method = plugin[name];
    if (typeof method === "function") bridge[name] = (method as (...args: unknown[]) => unknown).bind(plugin);
  }
  return bridge as unknown as TrackingBridge;
}

/** Lyssnaren som ett handtag att ta bort, oavsett om modulen svarar direkt eller med ett löfte. */
export function removeListener(handle: Promise<ListenerHandle> | ListenerHandle): void {
  void Promise.resolve(handle).then(item => item.remove())
    .catch((error: unknown) => console.warn("Appens lyssnare kunde inte tas bort", error));
}

const NULL_BODY = new Set([204, 205, 304]);

/**
 * POST genom appen (`post`, ADR-0227 beslut 3) till samma adress och med samma body som webbläsarens `fetch`. Svaret blir ett
 * vanligt `Response`, så kvittot hanteras på samma sätt. Avbryts efter `timeoutMs`.
 */
export async function postThroughApp(post: NonNullable<TrackingBridge["post"]>, path: string, body: string, timeoutMs: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Appens anrop tog för lång tid")), timeoutMs); });
  try {
    const answer = await Promise.race([post({ url: new URL(path, window.location.origin).href, body }), timeout]);
    if (!Number.isInteger(answer.status) || answer.status < 200 || answer.status > 599) throw new Error(`Appens anrop gav status ${answer.status}`);
    return new Response(NULL_BODY.has(answer.status) ? null : answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
  } finally { clearTimeout(timer); }
}
