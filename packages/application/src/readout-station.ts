import { eq } from "drizzle-orm";
import { readoutPackageSchema, type DeviceBatch, type DeviceBatchAcknowledgement, type ReadoutPackage } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { lockRaceForSnapshot } from "./concurrency";
import { ingestDeviceBatch } from "./ingest";
import { authenticatePairingAdminSession, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { loadRaceSnapshot, sortRaceSnapshotForPackage } from "./snapshot";
import { loadRelayReadout } from "./relay-results";

/**
 * Webbläsarens avläsningsstation (steg 4, ADR-0168). Administratörens eller
 * funktionärens session räcker (ADR-0172 beslut 3); inga stationsnycklar.
 */
type Proof = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">;
type Failure = { status: "unauthorized" | "forbidden" };

export async function readReadoutPackageAsAdministrator(
  db: Database, input: Proof, now = new Date()
): Promise<Failure | { status: "ok"; response: ReadoutPackage }> {
  const auth = await authenticatePairingAdminSession(db, { ...input, capability: "RACE_FUNCTIONARY" }, now);
  if (auth.status !== "authenticated") return auth;
  const response = await db.transaction(async (tx) => {
    await lockRaceForSnapshot(tx, input.raceId);
    const raceSnapshot = sortRaceSnapshotForPackage(await loadRaceSnapshot(tx, input.raceId));
    const [event] = await tx.select({
      id: schema.events.id, name: schema.events.name, startsOn: schema.events.startsOn, timeZone: schema.events.timeZone
    }).from(schema.events).where(eq(schema.events.id, raceSnapshot.race.eventId));
    if (!event) throw new Error("Evenemanget finns inte");
    const relay = await loadRelayReadout(tx, input.raceId);
    return readoutPackageSchema.parse({
      formatVersion: 1, raceId: raceSnapshot.race.id, packageVersion: raceSnapshot.race.snapshotVersion,
      resultEngineVersion: RESULT_ENGINE_VERSION, event, raceSnapshot, ...(relay ? { relay } : {}), fetchedAt: now.toISOString()
    });
  });
  return { status: "ok", response };
}

export async function ingestReadoutsAsAdministrator(
  db: Database, input: Proof & { batch: DeviceBatch }, now = new Date()
): Promise<Failure | { status: "ok"; response: DeviceBatchAcknowledgement }> {
  const auth = await authenticatePairingAdminSession(db,
    { ...input, capability: "RACE_FUNCTIONARY", requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  return { status: "ok", response: await ingestDeviceBatch(db, input.raceId, input.batch) };
}
