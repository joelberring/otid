import { publicResultUpdateEventExists, readPublicResultEventStream } from "@o-tid/application";
import type { Pool, PoolClient } from "@o-tid/database";
import { db, pool } from "./db";
import { publicRaceListsRecentlyRead, warmPublicRaceLists } from "./public-race-data";
import { coalesceNotifications, formatPublicResultEvent, NOTIFICATION_WINDOW_MS, parsePublicResultUpdateNotification } from "./public-result-event-stream-wire";

const notificationChannel = "otid_public_result_update";

type Subscriber = (eventSequence: string | null) => void;
type HubState = {
  listener: PoolClient | null;
  connecting: Promise<void> | null;
  subscribers: Map<string, Set<Subscriber>>;
};

const globalHub = globalThis as typeof globalThis & { oTidPublicResultEventHub?: HubState };

function hub(): HubState {
  return globalHub.oTidPublicResultEventHub ??= {
    listener: null,
    connecting: null,
    subscribers: new Map()
  };
}

export { formatPublicResultEvent, parsePublicResultUpdateNotification } from "./public-result-event-stream-wire";

function closeSubscribers(): void {
  const current = hub();
  for (const subscribers of current.subscribers.values()) {
    for (const subscriber of subscribers) subscriber(null);
  }
  current.subscribers.clear();
}

const deliverLatest = coalesceNotifications(NOTIFICATION_WINDOW_MS, async (raceId, eventSequence) => {
  const listening = (hub().subscribers.get(raceId)?.size ?? 0) > 0;
  // Steg 51: också en instans utan egna lyssnare räknar om en tävling den nyss visat, för med två instanser kan den väckta
  // besökarens hämtning hamna här.
  if (!listening && !publicRaceListsRecentlyRead(raceId)) return;
  if (!await publicResultUpdateEventExists(db, raceId, eventSequence)) return;
  // Listorna för den nya versionen räknas först, så att alla väckta besökare får den färdiga listan.
  try { await warmPublicRaceLists(raceId); } catch (error) { console.error("De publika listorna kunde inte räknas före väckningen", error); }
  for (const subscriber of hub().subscribers.get(raceId) ?? []) subscriber(eventSequence);
});

function deliverNotification(payloadValue: string | undefined): void {
  const parsed = parsePublicResultUpdateNotification(payloadValue);
  if (parsed) deliverLatest(parsed.raceId, parsed.eventSequence);
}

async function ensureListener(databasePool: Pool): Promise<void> {
  const current = hub();
  if (current.listener) return;
  if (current.connecting) return current.connecting;
  current.connecting = (async () => {
    const client = await databasePool.connect();
    let released = false;
    const stop = () => {
      if (hub().listener !== client) return;
      hub().listener = null;
      if (!released) { released = true; client.release(); }
      closeSubscribers();
    };
    try {
      await client.query(`LISTEN ${notificationChannel}`);
      client.on("notification", (message) => {
        if (message.channel === notificationChannel) deliverNotification(message.payload);
      });
      client.on("error", stop);
      client.on("end", stop);
      hub().listener = client;
    } catch (error) {
      if (!released) { released = true; client.release(); }
      throw error;
    }
  })().finally(() => { hub().connecting = null; });
  return current.connecting;
}

/**
 * Steg 51: instansen lyssnar på resultatströmmen så snart den visar en publik lista, inte först när en besökare öppnar
 * strömmen här. Annars räknar den instans som bara får hämtningarna (den andra bakom Caddy) aldrig om i förväg.
 */
export function ensurePublicResultListener(): void {
  void ensureListener(pool).catch((error) => console.error("Resultatströmmen kunde inte lyssna", error));
}

function subscribe(raceId: string, subscriber: Subscriber): () => void {
  const current = hub();
  const subscribers = current.subscribers.get(raceId) ?? new Set<Subscriber>();
  subscribers.add(subscriber);
  current.subscribers.set(raceId, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) current.subscribers.delete(raceId);
  };
}

export async function publicResultEventStreamStatus(raceId: string, lastEventId: string | null) {
  return readPublicResultEventStream(db, raceId, lastEventId);
}

export function createPublicResultEventStream(
  request: Request,
  raceId: string,
  lastEventId: string | null
): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let close: ((closeController?: boolean) => void) | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const onAbort = () => close?.();
      close = (closeController = true) => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener("abort", onAbort);
        if (closeController) controller.close();
      };
      const stopIfClosed = () => {
        if (closed) return true;
        if (request.signal.aborted) {
          close?.();
          return true;
        }
        return false;
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (stopIfClosed()) return;
      try {
        await ensureListener(pool);
        if (stopIfClosed()) return;
        unsubscribe = subscribe(raceId, (eventSequence) => {
          if (stopIfClosed()) return;
          if (eventSequence === null) { close?.(); return; }
          controller.enqueue(formatPublicResultEvent("refresh", eventSequence));
        });
        const state = await publicResultEventStreamStatus(raceId, lastEventId);
        if (stopIfClosed()) return;
        if (state.status === "ready" && lastEventId !== null) {
          for (const eventSequence of state.eventSequences) controller.enqueue(formatPublicResultEvent("refresh", eventSequence));
        } else {
          controller.enqueue(formatPublicResultEvent("reset"));
        }
        heartbeat = setInterval(() => {
          if (!stopIfClosed()) controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        }, 25_000);
      } catch {
        close?.();
      }
    },
    cancel() { close?.(false); }
  });
}
