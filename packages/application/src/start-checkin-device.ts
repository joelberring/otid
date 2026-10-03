import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  startCheckinDeviceRegistrationRequestSchema,
  startCheckinDeviceRegistrationResponseSchema
} from "@o-tid/contracts";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

type CheckinCapability = "START_CHECKIN" | "FINISH_FOREST_WATCH";
type RegistrationInput = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & {
  capability: CheckinCapability;
  readBody: () => Promise<unknown>;
};

function metadata(row: typeof schema.startCheckinDevices.$inferSelect) {
  return startCheckinDeviceRegistrationResponseSchema.parse({
    formatVersion: 1, deviceId: row.id, raceId: row.raceId, actorCredentialId: row.actorCredentialId,
    capability: row.capability, label: row.label, registeredAt: row.registeredAt.toISOString()
  });
}

/** Registers a private sync identity; this does not grant result or readout authority. */
export async function registerStartCheckinDeviceAsAdmin(db: Database, input: RegistrationInput, clock: () => Date = () => new Date()) {
  const initialTime = clock();
  if (!Number.isFinite(initialTime.getTime())) throw new Error("Registreringstiden är ogiltig");
  if (input.capability !== "START_CHECKIN" && input.capability !== "FINISH_FOREST_WATCH") {
    return { status: "forbidden" as const };
  }
  const authentication = { ...input, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, initialTime);
  if (initial.status !== "authenticated") return initial;
  const parsed = startCheckinDeviceRegistrationRequestSchema.safeParse(await input.readBody());
  if (!parsed.success) return { status: "invalid-request" as const };
  const intent = parsed.data;

  return db.transaction(async (tx) => {
    const now = clock();
    const authorization = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" as const };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'start-checkin-device:' + intent.deviceId}, 0))`);
    const [existing] = await tx.select().from(schema.startCheckinDevices)
      .where(eq(schema.startCheckinDevices.id, intent.deviceId));
    if (existing) {
      if (existing.raceId !== race.id || existing.actorCredentialId !== authorization.principal.accessCredentialId ||
        existing.capability !== input.capability || existing.label !== intent.label) {
        return { status: "conflict" as const };
      }
      return { status: "registered" as const, response: metadata(existing) };
    }
    const [saved] = await tx.insert(schema.startCheckinDevices).values({
      id: intent.deviceId, raceId: race.id, actorCredentialId: authorization.principal.accessCredentialId,
      capability: input.capability, label: intent.label, registeredAt: now
    }).returning();
    if (!saved) throw new Error("Avprickningsenheten kunde inte registreras");
    await tx.insert(schema.auditEvents).values({
      raceId: race.id, entityType: "start_checkin_device", entityId: saved.id,
      action: "START_CHECKIN_DEVICE_REGISTERED", requestId: saved.id,
      actorKind: input.capability === "START_CHECKIN" ? "START_CHECKIN_ACCESS_CREDENTIAL" : "FINISH_FOREST_WATCH_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      after: { deviceId: saved.id, capability: saved.capability, label: saved.label }, createdAt: now
    });
    return { status: "registered" as const, response: metadata(saved) };
  });
}
