import { publicResultUpdateEventExists, readPublicResultEventStream } from "@o-tid/application";
import type { Pool, PoolClient } from "@o-tid/database";
import { db, pool } from "./db";
import { formatPublicResultEvent, parsePublicResultUpdateNotification } from "./public-result-event-stream-wire";
import { writerAdmissionClosed } from "./writer-stop-admission";

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

async function deliverNotification(payloadValue: string | undefined): Promise<void> {
  const parsed = parsePublicResultUpdateNotification(payloadValue);
  if (!parsed || !await publicResultUpdateEventExists(db, parsed.raceId, parsed.eventSequence)) return;
  for (const subscriber of hub().subscribers.get(parsed.raceId) ?? []) subscriber(parsed.eventSequence);
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
        if (message.channel === notificationChannel) void deliverNotification(message.payload);
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
        if (request.signal.aborted || writerAdmissionClosed(
          process.env.OTID_WRITER_STOP_PROFILE, process.env.OTID_WRITER_STOP_FILE)) {
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
