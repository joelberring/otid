import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { changeEntryClassAsAdmin } from "../../src/results";
import { listResultRecalculationCandidatesAsAdmin, recalculateEntryAsAdmin } from "../../src/result-recalculation";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0191 beslut 4: testerna importerar, byter klass och räknar om via produktionsvägen (samma tjänster som routerna
 * anropar, med en administratörs session och CSRF), inte via genvägar utan behörighet som bara testerna använde.
 * Svar som inte är ett lyckat utfall blir ett fel med status och innehåll, så att `rejects` i testerna fungerar som förut.
 */
type Account = Awaited<ReturnType<typeof registerTestAccount>>;
type Admin = Account["proof"] & { raceId: string };
const accounts = new WeakMap<Database, Promise<Account>>();
const admins = new WeakMap<Database, Map<string, Promise<Admin>>>();

/**
 * Ett konto per databas som får ADMIN på varje tävlings event första gången (som `raceAuth`, men utan ett nytt konto och
 * en ny lösenordshash per tävling).
 */
export function raceAdmin(db: Database, raceId: string): Promise<Admin> {
  let account = accounts.get(db);
  if (!account) {
    account = registerTestAccount(db);
    accounts.set(db, account);
    account.catch(() => accounts.delete(db));
  }
  const byRace = admins.get(db) ?? new Map<string, Promise<Admin>>();
  admins.set(db, byRace);
  let admin = byRace.get(raceId);
  if (!admin) {
    admin = account.then(async (registered) => {
      const [race] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
      if (!race) throw new ProductionPathError("Tävlingen saknas");
      await db.insert(schema.eventAdministrationGrants).values({ eventId: race.eventId, accountId: registered.accountId, role: "ADMIN",
        grantedAt: new Date() });
      return { raceId, ...registered.proof };
    });
    byRace.set(raceId, admin);
    admin.catch(() => byRace.delete(raceId));
  }
  return admin;
}

export class ProductionPathError extends Error {
  constructor(readonly status: string, detail: unknown = undefined) {
    super(`${status}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

/** Importen av en IOF XML-fil som Anmälda → Importera gör (POST imports). */
export async function importIofXml(db: Database, raceId: string, xml: string) {
  const admin = await raceAdmin(db, raceId);
  const result = await importIofXmlAsAdmin(db, { ...admin, raceId, idempotencyKey: `iof-import:${randomUUID()}`,
    xmlBytes: new TextEncoder().encode(xml) });
  if (result.status === "stored" || result.status === "duplicate") {
    return { duplicate: result.status === "duplicate", importFileId: result.response.importFileId, report: result.response.report };
  }
  // Anmälningslistan som byter brickor (ADR-0185 beslut 5) eller krockar: samma ord som tjänstens felklass.
  if (result.status === "entry-list-changes") throw new ProductionPathError("Anmälningslistan ändrar brickor och behöver bekräftas", result.changes);
  if (result.status === "conflict" && result.changes) throw new ProductionPathError("Anmälningslistan krockar med tävlingen", result.changes);
  throw new ProductionPathError(result.status, "issues" in result ? result.issues : undefined);
}

/** Byt klass som deltagarkortets "Byt klass" (POST entries/:id/class), med deltagarens nuvarande version. */
export async function changeEntryClass(db: Database, raceId: string, entryId: string, classId: string) {
  const admin = await raceAdmin(db, raceId);
  const [entry] = await db.select({ version: schema.entries.version }).from(schema.entries).where(eq(schema.entries.id, entryId));
  if (!entry) throw new ProductionPathError("not-found");
  const requestId = randomUUID();
  const result = await changeEntryClassAsAdmin(db, { ...admin, raceId, entryId, idempotencyKey: `entry-class-change:${requestId}`,
    request: { formatVersion: 1, classId, expectedEntryVersion: entry.version } });
  if (result.status !== "changed") throw new ProductionPathError(result.status);
  return result.response;
}

/**
 * Räkna om en deltagare som "Räkna om från avläsningen" (POST entries/:id/recalculate): underlaget från kandidatlistan,
 * sedan omräkningen. Ger den nya resultatrevisionen.
 */
export async function recalculateEntry(db: Database, raceId: string, entryId: string) {
  const admin = await raceAdmin(db, raceId);
  const candidates = await listResultRecalculationCandidatesAsAdmin(db, { ...admin, raceId });
  if (candidates.status !== "ok") throw new ProductionPathError(candidates.status);
  const candidate = candidates.response.entries.find(row => row.id === entryId);
  if (!candidate) throw new ProductionPathError("not-found");
  if (candidate.readiness === "NO_ACTIVE_ASSIGNMENT") throw new ProductionPathError("Deltagaren saknar aktiv bricka");
  if (candidate.readiness !== "READY" || !candidate.latestReadout || !candidate.cardAssignmentId) {
    throw new ProductionPathError("Deltagaren saknar avläsning", candidate.readiness);
  }
  const requestId = randomUUID();
  const result = await recalculateEntryAsAdmin(db, { ...admin, raceId, entryId, idempotencyKey: `result-recalculation:${requestId}`,
    request: { formatVersion: 1, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCardAssignmentId: candidate.cardAssignmentId, expectedReadoutId: candidate.latestReadout.id,
      expectedLatestResultRevision: candidate.latestResultRevision
        ? { id: candidate.latestResultRevision.id, revision: candidate.latestResultRevision.revision } : null,
      expectedEngineVersion: candidates.response.engineVersion } });
  if (result.status !== "recalculated") throw new ProductionPathError(result.status);
  const [revision] = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, result.response.resultRevisionId));
  if (!revision) throw new ProductionPathError("Resultatrevisionen saknas");
  return revision;
}
