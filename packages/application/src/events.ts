import { createEventSchema, type CreateEventInput } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";

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
