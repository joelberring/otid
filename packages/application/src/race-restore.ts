import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  BACKUP_MANIFEST_PATH, BACKUP_PEOPLE_PATH, BACKUP_TABLE_NAME, RACE_BACKUP_FORMAT, RACE_BACKUP_FORMAT_VERSION, RACE_BACKUP_MAX_BINARY_BYTES,
  RACE_BACKUP_MAX_BYTES, RACE_BACKUP_MAX_DATA_FILE_BYTES, RACE_BACKUP_MAX_ENTRIES, RACE_BACKUP_MAX_MANIFEST_BYTES,
  RACE_BACKUP_MAX_TOTAL_BYTES, RACE_EXPORT_V1_FORMAT, backupBinaryPath, backupDataPath, backupRowSchema, raceBackupHeaderSchema,
  raceBackupManifestSchema, raceBackupPeopleSchema, raceBackupPreviewSchema, raceRestoreOptionsSchema, raceRestoreResponseSchema,
  type RaceBackupManifest, type RaceBackupPerson, type RaceBackupPreview, type RaceBackupProblem, type RaceRestoreResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { RACE_BACKUP_TABLES, RACE_RESTORE_CLEARED, type BackupTable } from "./race-backup-tables";
import { loadBackupCatalog, quoteIdentifier, remapDeep, type BackupTableCatalog } from "./race-backup-catalog";
import { ZipError, ZipReader } from "./race-backup-zip";
import { sha256Hex } from "./serialization";
import { authenticateUserAccountSessionForMutation, type UserAccountSessionProof } from "./user-account";
import type { DbExecutor } from "./snapshot";
import { accountMapQuotaBytes, mapStorageQuota, mapStorageUsage, storeInlineMapContentForRace, type MapStorageQuota } from "./map-content";
import { deliverPrepared, prepareIfMail, type InvitationMailer, type PreparedInvitationMail } from "./invitation-links";
import type { RaceInvitationRole } from "@o-tid/contracts";

/**
 * "Återställ tävling från säkerhetskopia" (ADR-0187). Filen läses och kontrolleras strikt (zip-arkivets gränser, formatversion,
 * sha256 per fil, zod per rad efter databasens katalog) och blir en NY tävling: alla id byts (också inuti JSON och text),
 * ingen befintlig tävling skrivs över. Avläsningar, resultatrevisioner och fastställanden läses in som de är, så resultaten och
 * sträcktiderna blir desamma (integrationstestet `aterstallning`). Den som återställer blir ägare och den enda med behörighet;
 * med `people: "link"` får adresserna i kopian vanliga inbjudningar med sina roller (ADR-0188 beslut 6, mejl med spärrarna i
 * ADR-0206), som blir behörigheter när någon loggar in med adressen. Varken förhandsvisningen eller svaret säger vilka adresser
 * som har konto här, och inget annat konto får behörighet direkt: filen är inte signerad, så en hemmagjord kopia skulle annars
 * fråga ut servern och ge konton behörighet i tävlingen. En person "Från klubben" har ingen adress i kopian och bjuds aldrig
 * in. Den nya tävlingen är opublicerad och
 * radiohämtningen är avstängd tills arrangören slår på den. Bara inloggade konton (samma krav som för att skapa en tävling).
 */
type Row = Record<string, unknown>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type BackupFailure = { status: "invalid"; problem: RaceBackupProblem };
const problem = (error: RaceBackupProblem["error"], detail?: string): BackupFailure =>
  ({ status: "invalid", problem: { formatVersion: 1, error, ...(detail === undefined ? {} : { detail: detail.slice(0, 300) }) } });

class BackupRejected extends Error {
  constructor(readonly failure: BackupFailure) { super(failure.problem.error); }
}

const ENTRY_NAME = /^(manifest\.json|personer\.json|data\/[a-z][a-z0-9_]{0,62}\.json|filer\/[a-f0-9]{64})$/;
const TABLES = new Map(RACE_BACKUP_TABLES.map(table => [table.name, table]));
const decoder = new TextDecoder("utf-8", { fatal: true });

/** En öppnad och kontrollerad säkerhetskopia. Tabellerna packas upp och kontrolleras när de läses. */
export interface OpenedBackup {
  manifest: RaceBackupManifest;
  people: RaceBackupPerson[];
  sha256: string;
  bytes: number;
  table(name: string): Row[];
  file(sha256: string): Uint8Array;
}

function parseJson(data: Uint8Array, what: string): unknown {
  try { return JSON.parse(decoder.decode(data)) as unknown; } catch { throw new BackupRejected(problem("INVALID_CONTENT", what)); }
}

/** Öppnar arkivet och kontrollerar manifestet, personerna och att varje fil finns med rätt kontrollsumma. */
export function openRaceBackup(bytes: Uint8Array): OpenedBackup | BackupFailure {
  try { return openOrThrow(bytes); }
  catch (error) { if (error instanceof BackupRejected) return error.failure; throw error; }
}

function openOrThrow(bytes: Uint8Array): OpenedBackup {
  if (bytes.byteLength > RACE_BACKUP_MAX_BYTES) throw new BackupRejected(problem("TOO_LARGE"));
  // Den gamla exporten (formatVersion 1) var en JSON-fil.
  if (bytes[0] === 0x7b) {
    const head = new TextDecoder().decode(bytes.subarray(0, 512));
    if (head.includes(`"${RACE_EXPORT_V1_FORMAT}"`)) throw new BackupRejected(problem("OLD_EXPORT", /"formatVersion":\s*(\d+)/.exec(head)?.[1] ?? "1"));
    throw new BackupRejected(problem("NOT_A_BACKUP"));
  }
  let zip: ZipReader;
  try {
    zip = new ZipReader(bytes, { maxEntries: RACE_BACKUP_MAX_ENTRIES, maxTotalBytes: RACE_BACKUP_MAX_TOTAL_BYTES, name: ENTRY_NAME,
      maxEntryBytes: name => name === BACKUP_MANIFEST_PATH ? RACE_BACKUP_MAX_MANIFEST_BYTES
        : name.startsWith("filer/") ? RACE_BACKUP_MAX_BINARY_BYTES : RACE_BACKUP_MAX_DATA_FILE_BYTES });
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    if (/stor/.test(error.message)) throw new BackupRejected(problem("TOO_LARGE", error.message));
    if (/inte ett zip/.test(error.message)) throw new BackupRejected(problem("NOT_A_BACKUP"));
    throw new BackupRejected(problem("BROKEN_ARCHIVE", error.message));
  }
  const extract = (name: string): Uint8Array => {
    try {
      const data = zip.extract(name);
      if (!data) throw new BackupRejected(problem("CHECKSUM_MISMATCH", `${name} saknas`));
      return data;
    } catch (error) {
      if (error instanceof ZipError) throw new BackupRejected(problem("BROKEN_ARCHIVE", error.message));
      throw error;
    }
  };
  if (!zip.entries.has(BACKUP_MANIFEST_PATH)) throw new BackupRejected(problem("NOT_A_BACKUP"));
  const rawManifest = parseJson(extract(BACKUP_MANIFEST_PATH), BACKUP_MANIFEST_PATH);
  const header = raceBackupHeaderSchema.safeParse(rawManifest);
  if (!header.success || header.data.format !== RACE_BACKUP_FORMAT) throw new BackupRejected(problem("NOT_A_BACKUP"));
  if (header.data.formatVersion !== RACE_BACKUP_FORMAT_VERSION) {
    throw new BackupRejected(problem("UNKNOWN_FORMAT_VERSION", String(header.data.formatVersion)));
  }
  const parsedManifest = raceBackupManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) throw new BackupRejected(problem("INVALID_CONTENT", BACKUP_MANIFEST_PATH));
  const manifest = parsedManifest.data;

  // Varje fil i arkivet står i manifestet med storlek och sha256, och varje fil i manifestet finns i arkivet.
  const expected = new Map<string, { sha256: string; bytes: number }>([[BACKUP_PEOPLE_PATH, manifest.people],
    ...manifest.tables.map(table => [backupDataPath(table.name), table] as const),
    ...manifest.files.map(file => [backupBinaryPath(file.sha256), file] as const)]);
  if (expected.size !== 1 + manifest.tables.length + manifest.files.length) throw new BackupRejected(problem("INVALID_CONTENT", "manifest.json"));
  for (const table of manifest.tables) {
    if (!BACKUP_TABLE_NAME.test(table.name) || !TABLES.has(table.name)) throw new BackupRejected(problem("UNKNOWN_CONTENT", table.name));
  }
  for (const name of zip.entries.keys()) {
    if (name !== BACKUP_MANIFEST_PATH && !expected.has(name)) throw new BackupRejected(problem("UNKNOWN_CONTENT", name));
  }
  for (const [name, entry] of expected) {
    const found = zip.entries.get(name);
    if (!found || found.size !== entry.bytes) throw new BackupRejected(problem("CHECKSUM_MISMATCH", name));
  }
  for (const required of ["event", "race"]) {
    if (manifest.tables.find(table => table.name === required)?.rows !== 1) throw new BackupRejected(problem("INVALID_CONTENT", required));
  }
  const checked = (name: string): Uint8Array => {
    const data = extract(name);
    if (sha256Hex(data) !== expected.get(name)!.sha256) throw new BackupRejected(problem("CHECKSUM_MISMATCH", name));
    return data;
  };
  const people = raceBackupPeopleSchema.safeParse(parseJson(checked(BACKUP_PEOPLE_PATH), BACKUP_PEOPLE_PATH));
  if (!people.success || new Set(people.data.map(person => person.ref)).size !== people.data.length ||
      new Set(people.data.map(person => person.email)).size !== people.data.length) {
    throw new BackupRejected(problem("INVALID_CONTENT", BACKUP_PEOPLE_PATH));
  }
  return {
    manifest, people: people.data, sha256: sha256Hex(bytes), bytes: bytes.byteLength,
    table: name => {
      const entry = manifest.tables.find(table => table.name === name);
      if (!entry) return [];
      const rows = parseJson(checked(backupDataPath(name)), backupDataPath(name));
      if (!Array.isArray(rows) || rows.length !== entry.rows || rows.some(row => row === null || typeof row !== "object" || Array.isArray(row))) {
        throw new BackupRejected(problem("INVALID_CONTENT", name));
      }
      return rows as Row[];
    },
    file: sha => checked(backupBinaryPath(sha))
  };
}

/** Kontrollerar raderna mot katalogen: okända kolumner (en nyare version av O-Tid) och fel typ avvisas. */
function validRows(backup: OpenedBackup, table: BackupTable, catalog: BackupTableCatalog): Row[] {
  const rows = backup.table(table.name);
  const known = new Set(catalog.columns.map(column => column.name));
  const omit = new Set(table.omit ?? []);
  const rowSchema = backupRowSchema(catalog.columns.filter(column => !omit.has(column.name)));
  const files = new Set(backup.manifest.files.map(file => file.sha256));
  const binary = catalog.columns.filter(column => column.type === "bytea");
  return rows.map(row => {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) throw new BackupRejected(problem("UNKNOWN_CONTENT", `${table.name}.${key}`));
      if (omit.has(key)) throw new BackupRejected(problem("INVALID_CONTENT", `${table.name}.${key}`));
    }
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      const column = parsed.error.issues[0]?.path[0];
      throw new BackupRejected(problem("INVALID_CONTENT", `${table.name}${typeof column === "string" ? `.${column}` : ""}`));
    }
    for (const column of binary) {
      const value = row[column.name] as { fil: string } | null | undefined;
      if (value && !files.has(value.fil)) throw new BackupRejected(problem("CHECKSUM_MISMATCH", `${table.name}.${column.name}`));
    }
    return row;
  });
}

interface Checked { backup: OpenedBackup; catalog: Map<string, BackupTableCatalog>; ids: Set<string> }

/** Hela kontrollen utan att något sparas: varje tabell läses och prövas. Samlar alla id för återställningen. */
async function checkBackup(tx: DbExecutor, bytes: Uint8Array): Promise<Checked> {
  const backup = openRaceBackup(bytes);
  if ("status" in backup) throw new BackupRejected(backup);
  const catalog = await loadBackupCatalog(tx, RACE_BACKUP_TABLES.map(table => table.name));
  const ids = new Set<string>(backup.people.map(person => person.ref));
  for (const table of RACE_BACKUP_TABLES) {
    const uuidColumns = catalog.get(table.name)!.columns.filter(column => column.type === "uuid").map(column => column.name);
    for (const row of validRows(backup, table, catalog.get(table.name)!)) {
      for (const column of uuidColumns) if (typeof row[column] === "string") ids.add(row[column]);
    }
  }
  return { backup, catalog, ids };
}

const ROLE_NAMES = { OWNER: "ADMIN", ADMIN: "ADMIN", FUNCTIONARY: "FUNCTIONARY" } as const;

function personRole(person: RaceBackupPerson): string {
  return [person.eventRole ? ROLE_NAMES[person.eventRole] : null, person.courseSettingLevel ? `COURSE_${person.courseSettingLevel}` : null]
    .filter(Boolean).join(",");
}

/**
 * Inbjudningarna en person i kopian får: rollen på tävlingen och nivån i banläggningen. En administratör har redan
 * banläggningen, så den får bara en.
 */
function personInvitationRoles(person: RaceBackupPerson): RaceInvitationRole[] {
  const event = person.eventRole ? ROLE_NAMES[person.eventRole] : null;
  const course = person.courseSettingLevel && event !== "ADMIN" ? `COURSE_${person.courseSettingLevel}` as const : null;
  return [event, course].filter(role => role !== null);
}

export type RaceBackupPreviewResult = { status: "unauthorized" | "forbidden" } | BackupFailure | { status: "ok"; preview: RaceBackupPreview };

/** Förhandsvisningen: hela kontrollen och vad den nya tävlingen får, utan att något sparas. */
export async function previewRaceBackup(db: Database, input: UserAccountSessionProof & { bytes: Uint8Array }, now = new Date()):
  Promise<RaceBackupPreviewResult> {
  const auth = await db.transaction(tx => authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now));
  if (auth.status !== "authenticated") return auth;
  try {
    const { backup } = await checkBackup(db, input.bytes);
    const table = (name: string) => backup.manifest.tables.find(entry => entry.name === name)?.rows ?? 0;
    return { status: "ok", preview: raceBackupPreviewSchema.parse({ formatVersion: 1, backupFormatVersion: backup.manifest.formatVersion,
      createdAt: backup.manifest.createdAt, race: backup.manifest.race, counts: backup.manifest.counts,
      staleResults: backup.manifest.staleResults, sha256: backup.sha256, bytes: backup.bytes,
      people: backup.people.map(person => ({ email: person.email, role: personRole(person) })),
      eventorLinked: table("race_eventor_link") > 0, radioLinked: table("race_radio_link") > 0, map: table("race_map") > 0 }) };
  } catch (error) {
    if (error instanceof BackupRejected) return error.failure;
    throw error;
  }
}

export type RaceRestoreResult = { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" } | BackupFailure |
  { status: "restored"; response: RaceRestoreResponse };

/** Rader i en tabell i en sådan ordning att en rad som en annan rad i samma tabell pekar på kommer först. */
function selfOrdered(rows: Row[], column: string, key: string): Row[] {
  const placed = new Set<unknown>();
  const result: Row[] = [];
  let pending = rows;
  while (pending.length > 0) {
    const next: Row[] = [];
    for (const row of pending) {
      const target = row[column];
      if (target === null || target === undefined || target === row[key] || placed.has(target) ||
          !rows.some(other => other[key] === target)) { result.push(row); placed.add(row[key]); }
      else next.push(row);
    }
    if (next.length === pending.length) throw new BackupRejected(problem("INVALID_CONTENT", column));
    pending = next;
  }
  return result;
}

const CHUNK_BYTES = 4 * 1024 * 1024;

async function insertRows(tx: Transaction, backup: OpenedBackup, table: string, catalog: BackupTableCatalog, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const known = new Set(catalog.columns.map(column => column.name));
  const present = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(name => known.has(name));
  const binary = new Set(catalog.columns.filter(column => column.type === "bytea").map(column => column.name));
  const plain = present.filter(name => !binary.has(name));
  const target = quoteIdentifier(table);
  if (present.some(name => binary.has(name))) {
    // Raderna med binärdata en och en, med filen som parameter.
    const bytea = present.filter(name => binary.has(name));
    for (const row of rows) {
      const json = JSON.stringify(Object.fromEntries(plain.map(name => [name, row[name] ?? null])));
      const values = bytea.map(name => {
        const value = row[name] as { fil: string } | null | undefined;
        return value ? sql`${Buffer.from(backup.file(value.fil))}::bytea` : sql`null::bytea`;
      });
      await tx.execute(sql.join([
        sql.raw(`insert into ${target} (${[...plain, ...bytea].map(quoteIdentifier).join(", ")}) select ${plain.map(name => `r.${quoteIdentifier(name)}`)
          .join(", ")}${plain.length > 0 ? ", " : ""}`), sql.join(values, sql.raw(", ")),
        sql.raw(` from jsonb_populate_record(null::${target}, `), sql`${json}::jsonb`, sql.raw(") r")]));
    }
    return;
  }
  const columns = plain.map(quoteIdentifier).join(", ");
  let chunk: string[] = [], size = 0;
  const flush = async () => {
    if (chunk.length === 0) return;
    await tx.execute(sql.join([sql.raw(`insert into ${target} (${columns}) select ${columns} from jsonb_populate_recordset(null::${target}, `),
      sql`${`[${chunk.join(",")}]`}::jsonb`, sql.raw(")")]));
    chunk = []; size = 0;
  };
  for (const row of rows) {
    const json = JSON.stringify(Object.fromEntries(plain.map(name => [name, row[name] ?? null])));
    chunk.push(json); size += json.length;
    if (size > CHUNK_BYTES || chunk.length >= 2000) await flush();
  }
  await flush();
}

/** Läser in kopian som en ny tävling. Samma `requestId` ger samma tävling (ett omförsök skapar aldrig två). */
export async function restoreRaceBackup(db: Database,
  input: UserAccountSessionProof & { bytes: Uint8Array; options: unknown; quota?: MapStorageQuota },
  now = new Date(), mailer?: InvitationMailer): Promise<RaceRestoreResult> {
  const options = raceRestoreOptionsSchema.safeParse(input.options);
  if (!options.success) return { status: "invalid-request" };
  const { requestId, people: peopleMode } = options.data;
  let result: RaceRestoreResult & { prepared?: PreparedInvitationMail[] };
  try {
    result = await db.transaction(async (tx): Promise<RaceRestoreResult & { prepared?: PreparedInvitationMail[] }> => {
      const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
      if (auth.status !== "authenticated") return auth;
      const accountId = auth.principal.accountId;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"race-restore:" + requestId}, 0))`);
      const fileSha256 = sha256Hex(input.bytes);
      const [prior] = await tx.select().from(schema.raceRestoreRequests).where(eq(schema.raceRestoreRequests.requestId, requestId));
      if (prior) {
        if (prior.actorAccountId !== accountId || prior.fileSha256 !== fileSha256 || prior.people !== peopleMode) return { status: "conflict" } as const;
        return { status: "restored", response: { ...storedResponse(prior.response), replayed: true } } as const;
      }
      const { backup, catalog, ids } = await checkBackup(tx, input.bytes);
      // Alla främmande nycklar som går att skjuta upp (fastställandet på loppet, avpricknings- och kortbanejournalerna)
      // kontrolleras vid commit; övriga följer tabellernas ordning.
      await tx.execute(sql`set constraints all deferred`);
      // Utlösaren behåller en medförd hash som skiljer sig från den uträknade (migration 0042): så förblir ett inaktuellt
      // resultat inaktuellt. Bara i den här transaktionen.
      await tx.execute(sql`select set_config('otid.restore', 'on', true)`);
      const staleRevisions = new Set(backup.manifest.staleResultRevisions ?? []);
      // Kartinnehållet före återställningen, för kvoten (ADR-0189 beslut 3).
      const before = await mapStorageUsage(tx, accountId);

      // Nya id för allt, också för kontonas referenser. Bara referensen med den återställandes egen adress blir det egna kontot
      // (det avslöjar inget: adressen och kontot är ens egna); andra konton kopplas aldrig (ADR-0187, ändrat 2026-11-07).
      const [self] = await tx.select({ email: schema.userAccounts.email }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
      const map = new Map<string, string>([...ids].map(id => [id, randomUUID()]));
      const own = self ? backup.people.find(person => person.email === self.email) : undefined;
      if (own) map.set(own.ref, accountId);
      const startDraws: { id: string; drawId: string }[] = [];
      let eventId = "", raceId = "";
      for (const table of RACE_BACKUP_TABLES) {
        const tableCatalog = catalog.get(table.name)!;
        const verbatim = new Set(table.verbatim ?? []);
        const cleared = new Set(RACE_RESTORE_CLEARED[table.name] ?? []);
        const types = new Map(tableCatalog.columns.map(column => [column.name, column.type]));
        const original = validRows(backup, table, tableCatalog);
        const originalIds = original.map(row => row.id as string | undefined);
        let rows = original.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => {
          if (cleared.has(name) || value === null) return [name, null];
          const type = types.get(name);
          if (type === "uuid") return [name, map.get(value as string)!];
          if (type === "bytea" || verbatim.has(name)) return [name, value];
          return [name, remapDeep(value, map)];
        })));
        switch (table.name) {
          case "event":
            rows = rows.map(row => ({ ...row, created_at: now.toISOString() }));
            eventId = rows[0]!.id as string;
            break;
          case "race":
            // Opublicerad med ny kort adress (kolumnens förval); superadminens döljning följer med som vid en kopia.
            // ADR-0191 beslut 5: en kopia från före migration 0047 kan ha FORKED; den återställs som Tävling (STANDARD).
            rows = rows.map(row => ({ ...row, published_at: null, created_at: now.toISOString(),
              ...(row.race_type === "FORKED" ? { race_type: "STANDARD" } : {}) }));
            raceId = rows[0]!.id as string;
            break;
          case "class":
            for (const row of rows) if (row.start_draw_id) startDraws.push({ id: row.id as string, drawId: row.start_draw_id as string });
            rows = rows.map(row => ({ ...row, start_draw_id: null }));
            break;
          case "entry":
            rows = selfOrdered(rows, "relay_card_entry_id", "id");
            break;
          case "race_radio_link":
            rows = rows.map(row => ({ ...row, enabled: false }));
            break;
          case "course_setting_grant":
            // Banläggningens behörigheter blir inbjudningar (nedan); den som återställer är ägare och har redan banläggningen.
            rows = [];
            break;
          case "result_revision":
            // Underlaget räknas om för den nya tävlingen; bara de revisioner som var inaktuella när kopian togs behåller sin
            // gamla hash (som aldrig stämmer med de nya id:na) och förblir inaktuella.
            rows = rows.map((row, index) => staleRevisions.has(originalIds[index]!) ? row : { ...row, basis_hash: null });
            break;
          case "result_finalization":
            // Id i den fastställda XML:en är utbytta; kontrollsumman räknas om så att filen stämmer med sig själv.
            rows = rows.map(row => typeof row.complete_xml === "string" ? { ...row, complete_xml_hash: sha256Hex(row.complete_xml) } : row);
            break;
        }
        try {
          await insertRows(tx, backup, table.name, tableCatalog, rows);
          if (table.name === "start_draw_class") {
            for (const draw of startDraws) {
              await tx.update(schema.classes).set({ startDrawId: draw.drawId }).where(eq(schema.classes.id, draw.id));
            }
          }
        } catch (error) {
          if (error instanceof BackupRejected) throw error;
          throw new BackupRejected(problem("DATA_REJECTED", `${table.name}: ${databaseMessage(error)}`));
        }
      }

      // ADR-0189: kartbilden och kartfilen till innehållslagret (samma innehåll som redan finns lagras inte igen). Nytt innehåll
      // räknas mot kvoten för den som återställer.
      const quota: MapStorageQuota = input.quota ?? mapStorageQuota();
      await storeInlineMapContentForRace(tx, raceId, accountId);
      const after = await mapStorageUsage(tx, accountId);
      const MB = 1024 * 1024;
      const accountLimit = await accountMapQuotaBytes(tx, accountId, quota);
      if (after.accountBytes > before.accountBytes && accountLimit !== null && after.accountBytes > accountLimit) {
        throw new BackupRejected(problem("STORAGE_QUOTA_EXCEEDED", `ditt konto: ${Math.ceil(after.accountBytes / MB)} av ${Math.floor(accountLimit / MB)} MB`));
      }
      if (after.totalBytes > before.totalBytes && quota.totalBytes !== null && after.totalBytes > quota.totalBytes) {
        throw new BackupRejected(problem("STORAGE_QUOTA_EXCEEDED", `servern: ${Math.ceil(after.totalBytes / MB)} av ${Math.floor(quota.totalBytes / MB)} MB`));
      }

      // Den som återställer blir ägare och den enda med behörighet. Personerna i kopian får vanliga inbjudningar (ADR-0188
      // beslut 6) till adressen, likadant oavsett om adressen har ett konto här; mejlen med spärrarna i ADR-0206.
      await tx.insert(schema.eventAdministrationGrants).values({ eventId, accountId, role: "OWNER", grantedAt: now });
      const prepared: PreparedInvitationMail[] = [];
      let invitations = 0;
      for (const person of peopleMode === "link" ? backup.people : []) {
        if (person.email === null || person.email === self?.email) continue;
        for (const role of personInvitationRoles(person)) {
          const id = randomUUID();
          await tx.insert(schema.racePersonInvitations).values({ id, requestId: randomUUID(), raceId, eventId, email: person.email, role,
            actorAccountId: accountId, createdAt: now });
          await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_person_invitation", entityId: id,
            action: "RACE_PERSON_INVITED", actorKind: "USER_ACCOUNT", actorId: accountId, requestId,
            after: { invitationId: id, role, invitedAt: now.toISOString(), restored: true } });
          const mail = await prepareIfMail(tx, mailer, { kind: "RACE", invitationId: id }, accountId, now);
          if (mail) prepared.push(mail);
          invitations += 1;
        }
      }
      const response = raceRestoreResponseSchema.parse({ formatVersion: 1, replayed: false, requestId, eventId, raceId,
        counts: backup.manifest.counts, invitations, createdAt: now.toISOString() });
      await tx.insert(schema.raceRestoreRequests).values({ requestId, actorAccountId: accountId, eventId, raceId, fileSha256,
        people: peopleMode, response: response as unknown as Record<string, unknown>, createdAt: now });
      // Journalen: kontrollsumma, tid och antal, inga namn eller adresser.
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_RESTORED_FROM_BACKUP",
        actorKind: "USER_ACCOUNT", actorId: accountId, requestId, createdAt: now,
        after: { fileSha256, backupFormatVersion: backup.manifest.formatVersion, backupCreatedAt: backup.manifest.createdAt,
          counts: backup.manifest.counts, people: peopleMode, invitations } });
      return { status: "restored", response, prepared } as const;
    });
  } catch (error) {
    if (error instanceof BackupRejected) return error.failure;
    throw error;
  }
  if (result.status !== "restored") return result;
  // Mejlen efter commit (som när en administratör bjuder in); ett misslyckat mejl ändrar inte svaret, inbjudan står kvar.
  for (const mail of result.prepared ?? []) await deliverPrepared(db, mail, mailer, now);
  return { status: "restored", response: result.response };
}

/** Kvittot från en tidigare återställning. Kvitton från före 2026-11-07 har `linkedPeople` och `missingPeople`. */
function storedResponse(stored: unknown): RaceRestoreResponse {
  const { linkedPeople, missingPeople, ...rest } = stored as Record<string, unknown>;
  const legacy = (typeof linkedPeople === "number" ? linkedPeople : 0) + (Array.isArray(missingPeople) ? missingPeople.length : 0);
  return raceRestoreResponseSchema.parse({ invitations: legacy, ...rest });
}

/** Databasens felbesked utan värden (bara villkorets eller kolumnens namn). */
function databaseMessage(error: unknown): string {
  const cause = (error as { cause?: { constraint?: string; column?: string; code?: string } }).cause ?? error as { constraint?: string; column?: string; code?: string };
  return cause.constraint ?? cause.column ?? cause.code ?? "okänt fel";
}
