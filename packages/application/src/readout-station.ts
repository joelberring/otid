import { asc, eq } from "drizzle-orm";
import { readoutPackageSchema, type DeviceBatch, type DeviceBatchAcknowledgement, type ReadoutPackage } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { lockRaceForSnapshot } from "./concurrency";
import { ingestDeviceBatch } from "./ingest";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { loadRaceSnapshot, sortRaceSnapshotForPackage } from "./snapshot";
import { loadRelayReadout } from "./relay-results";
import { loadReadOutEntryIds, loadRunnerLookup } from "./runner-database";
import { loadPartyPackage } from "./party";

/**
 * Webbläsarens avläsningsstation (steg 4, ADR-0168). Administratörens eller
 * funktionärens session räcker (ADR-0172 beslut 3); inga stationsnycklar.
 */
type Proof = RaceSessionProof;
type Failure = { status: "unauthorized" | "forbidden" };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function readReadoutPackageAsAdmin(
  db: Database, input: Proof, now = new Date()
): Promise<Failure | { status: "ok"; response: ReadoutPackage }> {
  const auth = await requireRaceRole(db, { ...input, role: "FUNCTIONARY" }, now);
  if (auth.status !== "authenticated") return auth;
  const response = await db.transaction(async (tx) => {
    await lockRaceForSnapshot(tx, input.raceId);
    const raceSnapshot = sortRaceSnapshotForPackage(await loadRaceSnapshot(tx, input.raceId));
    const [event] = await tx.select({
      id: schema.events.id, name: schema.events.name, startsOn: schema.events.startsOn, timeZone: schema.events.timeZone
    }).from(schema.events).where(eq(schema.events.id, raceSnapshot.race.eventId));
    if (!event) throw new Error("Evenemanget finns inte");
    const relay = await loadRelayReadout(tx, input.raceId);
    const publicLinks = await loadPublicLinks(tx, input.raceId);
    // Löpardatabasen (PLAN.md steg 29): klubbens löpare för förslag vid okänd bricka, även offline.
    const runnerLookup = await loadRunnerLookup(tx, input.raceId);
    const readOutEntryIds = await loadReadOutEntryIds(tx, input.raceId);
    // Fest (PLAN.md steg 40): festens start och varorna, så att bardisken räknar köpen även utan nät.
    const party = await loadPartyPackage(tx, input.raceId);
    return readoutPackageSchema.parse({
      formatVersion: 1, raceId: raceSnapshot.race.id, packageVersion: raceSnapshot.race.snapshotVersion,
      resultEngineVersion: RESULT_ENGINE_VERSION, event, raceSnapshot, ...(relay ? { relay } : {}), publicLinks,
      ...(runnerLookup ? { runnerLookup } : {}), readOutEntryIds, ...(party ? { party } : {}), fetchedAt: now.toISOString()
    });
  });
  return { status: "ok", response };
}

/**
 * Kvittots QR-kod (PLAN.md steg 21) skapas i webbläsaren, även utan nät: tävlingssidans korta kod och deltagarnas
 * publika resultat-id (samma id som i de publika resultatlänkarna) följer med paketet.
 */
async function loadPublicLinks(tx: Transaction, raceId: string) {
  const [race] = await tx.select({ shortCode: schema.races.shortCode, publishedAt: schema.races.publishedAt,
    hidden: schema.races.hiddenBySuperadmin }).from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Loppet finns inte");
  const participants = await tx.select({ entryId: schema.entries.id, publicResultId: schema.entries.publicResultId })
    .from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
  return { shortCode: race.shortCode, published: race.publishedAt !== null && !race.hidden, participants };
}

export async function ingestReadoutsAsAdmin(
  db: Database, input: Proof & { batch: DeviceBatch }, now = new Date()
): Promise<Failure | { status: "ok"; response: DeviceBatchAcknowledgement }> {
  const auth = await requireRaceRole(db, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  return { status: "ok", response: await ingestDeviceBatch(db, input.raceId, input.batch) };
}
