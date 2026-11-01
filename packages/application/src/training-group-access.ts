import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Steg 68 (ADR-0182 beslut 1): behörigheten via gruppen. En ledare i gruppen som evenemanget hör till är ADMIN på
 * evenemangets tävlingar utan att läggas till på var och en. Det enda stället som avgör det; `activeEventAdministrationGrant`
 * (och därmed `requireRaceRole`, banläggningen, förhandsvisningen och kopieringen) frågar här när kontot inte redan är
 * ägare eller administratör på evenemanget. En ledare som tas bort ur gruppen (raden tas bort) nekas från nästa anrop.
 * Medlemmar (MEMBER) får ingen roll på tävlingarna.
 *
 * Låsning som för evenemangets behörigheter: "share" för läsningar, "update" för skrivningar (en samtidig borttagning
 * väntar in anropet).
 */
export async function groupLeaderGrant(tx: DbExecutor, input: { accountId: string; eventId: string },
  lock: "none" | "share" | "update"): Promise<{ id: string; groupId: string } | undefined> {
  const [event] = await tx.select({ groupId: schema.events.trainingGroupId }).from(schema.events).where(eq(schema.events.id, input.eventId));
  if (!event?.groupId) return undefined;
  return leaderMembership(tx, { accountId: input.accountId, groupId: event.groupId }, lock);
}

/** Kontots ledarskap i gruppen (raden i `training_group_member`), eller undefined. */
export async function leaderMembership(tx: DbExecutor, input: { accountId: string; groupId: string },
  lock: "none" | "share" | "update"): Promise<{ id: string; groupId: string } | undefined> {
  const query = tx.select({ id: schema.trainingGroupMembers.id, groupId: schema.trainingGroupMembers.groupId })
    .from(schema.trainingGroupMembers)
    .where(and(eq(schema.trainingGroupMembers.groupId, input.groupId), eq(schema.trainingGroupMembers.accountId, input.accountId),
      eq(schema.trainingGroupMembers.role, "LEADER")));
  const [row] = lock === "share" ? await query.for("share") : lock === "update" ? await query.for("update") : await query;
  return row;
}

/** Kontots roll i gruppen (ledare eller medlem), eller undefined. */
export async function groupMembership(tx: DbExecutor, input: { accountId: string; groupId: string })
  : Promise<{ id: string; role: "LEADER" | "MEMBER" } | undefined> {
  const [row] = await tx.select({ id: schema.trainingGroupMembers.id, role: schema.trainingGroupMembers.role })
    .from(schema.trainingGroupMembers)
    .where(and(eq(schema.trainingGroupMembers.groupId, input.groupId), eq(schema.trainingGroupMembers.accountId, input.accountId)));
  return row;
}
