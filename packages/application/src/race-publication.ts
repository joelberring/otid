import { eq } from "drizzle-orm";
import { racePublicationResponseSchema, type RacePublicationResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

/**
 * Publicera tävlingen (ADR-0172 beslut 4). En ny tävling syns inte publikt förrän admin publicerar den;
 * admin kan också sluta publicera. Startlistan och resultaten följer sedan sina egna regler (startlistan har
 * en egen publicering, resultaten syns när löparna läses av). Bara administratörer; varje ändring loggas.
 * Att publicera en redan publicerad tävling ändrar inget (samma tidpunkt står kvar).
 */
type Authentication = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">;
export type RacePublicationResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "saved"; response: RacePublicationResponse };

export async function setRacePublicationAsAdministrator(db: Database, input: Authentication & { published: boolean },
  now = new Date()): Promise<RacePublicationResult> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability: "MANAGE_RACE", requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    const [race] = await tx.select({ publishedAt: schema.races.publishedAt, shortCode: schema.races.shortCode,
      hiddenBySuperadmin: schema.races.hiddenBySuperadmin }).from(schema.races).where(eq(schema.races.id, raceId));
    if (!race) return { status: "not-found" } as const;
    const publishedAt = input.published ? race.publishedAt ?? now : null;
    if ((publishedAt?.getTime() ?? null) !== (race.publishedAt?.getTime() ?? null)) {
      await tx.update(schema.races).set({ publishedAt }).where(eq(schema.races.id, raceId));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId,
        action: input.published ? "RACE_PUBLISHED_BY_ADMIN" : "RACE_UNPUBLISHED_BY_ADMIN",
        actorKind: auth.principal.account ? "USER_ACCOUNT" : "RACE_ADMIN_ACCESS_CREDENTIAL",
        actorId: auth.principal.account?.accountId ?? auth.principal.accessCredentialId,
        before: { publishedAt: race.publishedAt?.toISOString() ?? null },
        after: { publishedAt: publishedAt?.toISOString() ?? null }, createdAt: now });
    }
    return { status: "saved", response: racePublicationResponseSchema.parse({ formatVersion: 1, raceId,
      publication: { shortCode: race.shortCode, publishedAt: publishedAt?.toISOString() ?? null,
        hiddenBySuperadmin: race.hiddenBySuperadmin } }) } as const;
  });
}
