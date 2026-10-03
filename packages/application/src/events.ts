import { createEventSchema, type CreateEventInput } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { desc, eq } from "drizzle-orm";

export async function createEvent(db: Database, input: CreateEventInput) {
  const value = createEventSchema.parse(input);
  return db.transaction(async (tx) => {
    const [event] = await tx.insert(schema.events).values({
      name: value.name,
      startsOn: value.raceDate,
      timeZone: value.timeZone
    }).returning();
    if (!event) throw new Error("Kunde inte skapa evenemang");
    const [race] = await tx.insert(schema.races).values({
      eventId: event.id,
      name: value.raceName,
      raceDate: value.raceDate
    }).returning();
    if (!race) throw new Error("Kunde inte skapa lopp");
    return { event, race };
  });
}

export async function listEvents(db: Database) {
  return db.select({
    eventId: schema.events.id,
    eventName: schema.events.name,
    raceId: schema.races.id,
    raceName: schema.races.name,
    raceDate: schema.races.raceDate
  }).from(schema.races)
    .innerJoin(schema.events, eq(schema.races.eventId, schema.events.id))
    .orderBy(desc(schema.races.raceDate));
}
