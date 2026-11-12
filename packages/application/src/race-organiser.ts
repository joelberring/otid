import { eq, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Användartestet 2026-11-12 (punkt A): en träning som skapas i en klubbs sammanhang hör till klubben direkt. Gruppens klubb är
 * den klubbyta som gruppen hör till: `training_group.club_id` när den är satt, annars den enda klubbyta vars terminsplan har
 * gruppen på en rad, annars den enda klubbyta vars kartor ligger i gruppens bibliotek. Arrangörsklubben är klubbytans
 * organisation i Eventor; en klubbyta som inte är kopplad till Eventor ger ingen (arrangörsklubben är alltid en klubb i listan).
 */
export async function groupOrganisation(tx: DbExecutor, groupId: string): Promise<string | undefined> {
  const rows = (await tx.execute<{ organisation_id: string }>(sql`
    with own as (select club_id from training_group where id = ${groupId} and club_id is not null),
    planned as (select distinct club_id from club_plan_session where training_group_id = ${groupId}),
    mapped as (select distinct m.club_id from training_group_map g join club_map m on m.id = g.club_map_id where g.group_id = ${groupId}),
    chosen as (
      select club_id from own
      union all select club_id from planned where not exists (select 1 from own) and (select count(*) from planned) = 1
      union all select club_id from mapped where not exists (select 1 from own) and not exists (select 1 from planned)
        and (select count(*) from mapped) = 1)
    select s.organisation_id from chosen c join club_setting s on s.club_id = c.club_id where s.organisation_id is not null limit 1`)).rows;
  return rows[0]?.organisation_id;
}

/** Tävlingens arrangörsklubb, eller undefined. */
export async function raceOrganisation(tx: DbExecutor, raceId: string): Promise<string | undefined> {
  const [row] = await tx.select({ organisationId: schema.raceOrganisers.organisationId }).from(schema.raceOrganisers)
    .where(eq(schema.raceOrganisers.raceId, raceId));
  return row?.organisationId;
}

/** Sätter arrangörsklubben när tävlingen inte har någon (ett val som redan gjorts ändras inte). */
export async function setOrganiserIfMissing(tx: DbExecutor, input: { raceId: string; organisationId: string | undefined; accountId: string; now: Date })
  : Promise<void> {
  if (!input.organisationId) return;
  await tx.insert(schema.raceOrganisers).values({ raceId: input.raceId, organisationId: input.organisationId, setBy: input.accountId, setAt: input.now })
    .onConflictDoNothing();
}
