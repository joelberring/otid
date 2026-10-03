import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_SEQUENCE_PATTERN = /^[1-9][0-9]*$/;
const MAX_EVENT_SEQUENCE = 9_223_372_036_854_775_807n;

export type PublicResultEventStreamRead =
  | { status: "not-found" }
  | { status: "invalid-cursor" }
  | { status: "reset" }
  | { status: "ready"; eventSequences: string[] };

/**
 * Reads only the bounded technical marker journal. The caller still fetches
 * the result snapshot through publicResults; no row data is exposed here.
 */
export async function readPublicResultEventStream(
  db: Database,
  raceId: string,
  afterEventSequence: string | null
): Promise<PublicResultEventStreamRead> {
  if (!UUID_PATTERN.test(raceId)) return { status: "not-found" };

  let cursor: bigint | null = null;
  if (afterEventSequence !== null) {
    if (!EVENT_SEQUENCE_PATTERN.test(afterEventSequence) || afterEventSequence.length > 19) return { status: "invalid-cursor" };
    cursor = BigInt(afterEventSequence);
    if (cursor > MAX_EVENT_SEQUENCE) return { status: "invalid-cursor" };
  }

  const [race] = await db.select({ id: schema.races.id })
    .from(schema.races).where(eq(schema.races.id, raceId)).limit(1);
  if (!race) return { status: "not-found" };
  const events = await db.select({ eventSequence: schema.publicResultUpdateEvents.eventSequence })
    .from(schema.publicResultUpdateEvents)
    .where(eq(schema.publicResultUpdateEvents.raceId, raceId))
    .orderBy(asc(schema.publicResultUpdateEvents.eventSequence));
  if (cursor === null) return { status: "ready", eventSequences: [] };
  const first = events.at(0)?.eventSequence;
  const last = events.at(-1)?.eventSequence;
  if (first === undefined || last === undefined || cursor < first - 1n || cursor > last) {
    return { status: "reset" };
  }
  return {
    status: "ready",
    eventSequences: events.filter((event) => event.eventSequence > cursor)
      .map((event) => event.eventSequence.toString())
  };
}

/** Confirms that a PostgreSQL NOTIFY payload still names a durable marker. */
export async function publicResultUpdateEventExists(
  db: Database,
  raceId: string,
  eventSequence: string
): Promise<boolean> {
  if (!UUID_PATTERN.test(raceId) || !EVENT_SEQUENCE_PATTERN.test(eventSequence) || eventSequence.length > 19) return false;
  const sequence = BigInt(eventSequence);
  if (sequence > MAX_EVENT_SEQUENCE) return false;
  const [event] = await db.select({ eventSequence: schema.publicResultUpdateEvents.eventSequence })
    .from(schema.publicResultUpdateEvents)
    .where(and(
      eq(schema.publicResultUpdateEvents.raceId, raceId),
      eq(schema.publicResultUpdateEvents.eventSequence, sequence)
    )).limit(1);
  return event !== undefined;
}
