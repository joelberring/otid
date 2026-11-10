import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { accountEmailVerified } from "./email-verification";
import { clubMembership, clubRoleAtLeast } from "./club-access";

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

/**
 * ADR-0186: ledare och medlemmar läggs till med e-postadressen av någon annan, så rollen gäller först när kontots adress är
 * bekräftad. Den som skapade gruppen (lade till sig själv) är ledare ändå.
 */
async function counts(tx: DbExecutor, accountId: string, row: { addedBy: string } | undefined): Promise<boolean> {
  return row !== undefined && (row.addedBy === accountId || await accountEmailVerified(tx, accountId));
}

/** Kontots ledarskap i gruppen (raden i `training_group_member`), eller undefined. */
export async function leaderMembership(tx: DbExecutor, input: { accountId: string; groupId: string },
  lock: "none" | "share" | "update"): Promise<{ id: string; groupId: string } | undefined> {
  const query = tx.select({ id: schema.trainingGroupMembers.id, groupId: schema.trainingGroupMembers.groupId,
    addedBy: schema.trainingGroupMembers.addedBy })
    .from(schema.trainingGroupMembers)
    .where(and(eq(schema.trainingGroupMembers.groupId, input.groupId), eq(schema.trainingGroupMembers.accountId, input.accountId),
      eq(schema.trainingGroupMembers.role, "LEADER")));
  const [row] = lock === "share" ? await query.for("share") : lock === "update" ? await query.for("update") : await query;
  return row && await counts(tx, input.accountId, row) ? { id: row.id, groupId: row.groupId } : undefined;
}

/** Kontots roll i gruppen (ledare eller medlem), eller undefined. */
export async function groupMembership(tx: DbExecutor, input: { accountId: string; groupId: string })
  : Promise<{ id: string; role: "LEADER" | "MEMBER" } | undefined> {
  const [row] = await tx.select({ id: schema.trainingGroupMembers.id, role: schema.trainingGroupMembers.role,
    addedBy: schema.trainingGroupMembers.addedBy })
    .from(schema.trainingGroupMembers)
    .where(and(eq(schema.trainingGroupMembers.groupId, input.groupId), eq(schema.trainingGroupMembers.accountId, input.accountId)));
  return row && await counts(tx, input.accountId, row) ? { id: row.id, role: row.role } : undefined;
}

/**
 * Ägaren 2026-11-10 (ADR-0221 tillägg): terminsplanen är klubbens gemensamma arbetsyta. En träning som är kopplad till en
 * vecka i en klubbs plan (`club_plan_session.race_id`) har klubbens ledare, administratörer och ägare som administratörer,
 * utan egen rad på evenemanget, som gruppens ledare ovan. Rätten följer klubbrollen: den som inte längre är ledare nekas
 * från nästa anrop. Svarar med klubbmedlemskapets id.
 */
export async function planLeaderGrant(tx: DbExecutor, input: { accountId: string; eventId: string },
  lock: "none" | "share" | "update"): Promise<{ id: string; clubId: string } | undefined> {
  const linked = await tx.selectDistinct({ clubId: schema.clubPlanSessions.clubId }).from(schema.clubPlanSessions)
    .innerJoin(schema.races, eq(schema.races.id, schema.clubPlanSessions.raceId))
    .where(eq(schema.races.eventId, input.eventId));
  for (const { clubId } of linked) {
    const member = await clubMembership(tx, { accountId: input.accountId, clubId }, lock);
    if (member && clubRoleAtLeast(member.role, "LEADER")) return { id: member.id, clubId };
  }
  return undefined;
}
