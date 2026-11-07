import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  BACKUP_MANIFEST_PATH, BACKUP_PEOPLE_PATH, RACE_BACKUP_FORMAT, RACE_BACKUP_FORMAT_VERSION, backupBinaryPath, backupDataPath,
  raceBackupManifestSchema, raceBackupPeopleSchema, type RaceBackupCounts, type RaceBackupManifest, type RaceBackupPerson
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { RACE_BACKUP_TABLES } from "./race-backup-tables";
import { loadBackupCatalog, quoteIdentifier, remapDeep } from "./race-backup-catalog";
import { writeZip, type ZipEntry } from "./race-backup-zip";
import { sha256Hex } from "./serialization";
import { clubSourcedInContext } from "./club-invite";

/**
 * "Ladda ner säkerhetskopia" (ADR-0187, ersätter steg 27:s JSON-export): allt om tävlingen i en zip som kan återställas som en
 * ny tävling på samma eller en annan server (`race-restore.ts`). Raderna skrivs som databasen har dem (kolumnnamn i snake_case),
 * binärdata som egna filer och kontonas id som slumpade referenser; personer med behörighet följer med som e-post och roll,
 * utom adressen för den som bjöds in "Från klubben" (ADR-0209 beslut 7: den som bjöd in ser aldrig adressen).
 * Konton, lösenord, sessioner och Eventor-nycklar följer aldrig med. Läser i en ögonblicksbild (repeatable read); när kopian
 * är klar sparas tiden (`race.last_backup_at`) och en rad i journalen utan personuppgifter, i en egen kort transaktion.
 * Bara administratören.
 */
export type RaceExportResult =
  | { status: "unauthorized" | "forbidden" | "not-found" }
  | { status: "ok"; bytes: Uint8Array; fileName: string; manifest: RaceBackupManifest };

type Row = Record<string, unknown>;

function counted(tables: ReadonlyMap<string, Row[]>, files: number, people: number): RaceBackupCounts {
  const size = (name: string) => tables.get(name)?.length ?? 0;
  return { classes: size("class"), courses: size("course"), controls: size("control"), entries: size("entry"), teams: size("team"),
    cardReadouts: size("card_readout"), resultRevisions: size("result_revision"), radioPunches: size("radio_punch"), files, people };
}

export async function exportRaceAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">,
  now = new Date()): Promise<RaceExportResult> {
  const result = await db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const { raceId, eventId, accountId } = auth.principal;
    const [race] = await tx.select({ name: schema.races.name, raceDate: schema.races.raceDate, raceType: schema.races.raceType,
      shortCode: schema.races.shortCode, eventName: schema.events.name, timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
    if (!race) return { status: "not-found" } as const;

    const catalog = await loadBackupCatalog(tx, RACE_BACKUP_TABLES.map(table => table.name));
    const tables = new Map<string, Row[]>();
    const files = new Map<string, Uint8Array>();
    const uuids = new Set<string>();
    for (const table of RACE_BACKUP_TABLES) {
      const { columns, primaryKey } = catalog.get(table.name)!;
      const omit = new Set(table.omit ?? []);
      const binary = columns.filter(column => column.type === "bytea" && !omit.has(column.name));
      const removed = [...omit, ...binary.map(column => column.name)].map(name => ` - '${name}'`).join("");
      const order = primaryKey.length > 0 ? ` order by ${primaryKey.map(name => `t.${quoteIdentifier(name)}`).join(", ")}` : "";
      // ADR-0189: innehåll i lagret läses ut som fil, precis som innehåll i den gamla kolumnen.
      const binaryValue = (name: string) => table.stored?.[name]
        ? `coalesce(t.${quoteIdentifier(name)}, otid_map_content_bytes(t.${quoteIdentifier(table.stored[name])}))` : `t.${quoteIdentifier(name)}`;
      const query = sql.join([sql.raw(`select to_jsonb(t)${removed} as row${binary.map((column, index) =>
        `, ${binaryValue(column.name)} as b${index}`).join("")} from ${quoteIdentifier(table.name)} t where `),
      table.scope(raceId, eventId), sql.raw(order)]);
      const rows = (await tx.execute<Record<string, unknown> & { row: Row }>(query)).rows.map(result => {
        const row = result.row;
        binary.forEach((column, index) => {
          const value = result[`b${index}`];
          if (value === null || value === undefined) { row[column.name] = null; return; }
          const bytes = new Uint8Array(value as Buffer);
          const sha = sha256Hex(bytes);
          files.set(sha, bytes);
          row[column.name] = { fil: sha };
        });
        for (const column of columns) {
          const value = row[column.name];
          if (column.type === "uuid" && typeof value === "string") uuids.add(value);
        }
        return row;
      });
      tables.set(table.name, rows);
    }

    // Kontonas id byts mot slumpade referenser. Personer med behörighet följer med som e-post och roll (ADR-0187).
    const grants = await tx.select({ accountId: schema.eventAdministrationGrants.accountId, role: schema.eventAdministrationGrants.role,
      email: schema.userAccounts.email })
      .from(schema.eventAdministrationGrants)
      .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.eventAdministrationGrants.accountId))
      .leftJoin(schema.eventAdministrationGrantRevocations,
        eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
      .where(and(eq(schema.eventAdministrationGrants.eventId, eventId), isNull(schema.eventAdministrationGrantRevocations.id),
        isNull(schema.userAccounts.blockedAt)));
    const courseGrants = await tx.select({ accountId: schema.courseSettingGrants.accountId, level: schema.courseSettingGrants.level,
      email: schema.userAccounts.email })
      .from(schema.courseSettingGrants).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.courseSettingGrants.accountId))
      .where(eq(schema.courseSettingGrants.raceId, raceId));
    const referenced = uuids.size === 0 ? [] : (await tx.execute<{ id: string }>(sql`select id from user_account
      where id = any(${`{${[...uuids].join(",")}}`}::uuid[])`)).rows;
    const accounts = new Map<string, string>([...referenced.map(row => row.id), ...grants.map(row => row.accountId),
      ...courseGrants.map(row => row.accountId)].map(id => [id, randomUUID()]));
    const people = new Map<string, RaceBackupPerson>();
    // ADR-0209 beslut 7: personer "Från klubben" följer med utan adress (rollen står kvar, kopplas inte vid återställningen).
    const fromClub = (await clubSourcedInContext(tx, "RACE_PERSON", raceId)).accounts;
    const emailOf = (accountId: string, email: string) => fromClub.has(accountId) ? null : email;
    const strength = { OWNER: 0, ADMIN: 1, FUNCTIONARY: 2 } as const;
    for (const grant of grants) {
      const ref = accounts.get(grant.accountId)!;
      const person = people.get(ref) ?? { ref, email: emailOf(grant.accountId, grant.email), eventRole: null, courseSettingLevel: null };
      if (person.eventRole === null || strength[grant.role] < strength[person.eventRole]) person.eventRole = grant.role;
      people.set(ref, person);
    }
    for (const grant of courseGrants) {
      const ref = accounts.get(grant.accountId)!;
      people.set(ref, { ...(people.get(ref) ?? { ref, email: emailOf(grant.accountId, grant.email), eventRole: null }), courseSettingLevel: grant.level });
    }
    for (const [name, rows] of tables) tables.set(name, rows.map(row => remapDeep(row, accounts) as Row));

    // Deltagare vars senaste resultat bygger på ett annat underlag än det som gäller nu (behöver räknas om), och alla revisioner
    // med ett sådant underlag: de förblir inaktuella efter återställningen (ADR-0187 beslut 5).
    const stale = await tx.execute<{ count: number }>(sql`select count(*)::int as count from (
      select distinct on (entry_id) entry_id, basis_hash from result_revision where race_id = ${raceId} order by entry_id, revision desc) r
      where r.basis_hash is not null and r.basis_hash is distinct from otid_result_basis_hash(r.entry_id)`);
    const staleRevisions = await tx.execute<{ id: string }>(sql`select r.id from result_revision r
      where r.race_id = ${raceId} and r.basis_hash is not null and r.basis_hash is distinct from otid_result_basis_hash(r.entry_id)
      order by r.id`);

    const peopleBytes = new TextEncoder().encode(JSON.stringify(raceBackupPeopleSchema.parse([...people.values()])));
    const entries: ZipEntry[] = [];
    const tableEntries: RaceBackupManifest["tables"] = [];
    for (const [name, rows] of tables) {
      const data = new TextEncoder().encode(JSON.stringify(rows));
      entries.push({ name: backupDataPath(name), data });
      tableEntries.push({ name, rows: rows.length, sha256: sha256Hex(data), bytes: data.byteLength });
    }
    const fileEntries = [...files].sort(([a], [b]) => a.localeCompare(b));
    for (const [sha, data] of fileEntries) entries.push({ name: backupBinaryPath(sha), data });
    const manifest = raceBackupManifestSchema.parse({
      format: RACE_BACKUP_FORMAT, formatVersion: RACE_BACKUP_FORMAT_VERSION, createdAt: now.toISOString(),
      engineVersion: RESULT_ENGINE_VERSION, containsPersonalData: true,
      race: { eventName: race.eventName, raceName: race.name, raceDate: race.raceDate, raceType: race.raceType, timeZone: race.timeZone },
      counts: counted(tables, files.size, people.size), staleResults: stale.rows[0]?.count ?? 0,
      staleResultRevisions: staleRevisions.rows.map(row => row.id), tables: tableEntries,
      people: { sha256: sha256Hex(peopleBytes), bytes: peopleBytes.byteLength },
      files: fileEntries.map(([sha, data]) => ({ sha256: sha, bytes: data.byteLength }))
    });
    const bytes = writeZip([{ name: BACKUP_MANIFEST_PATH, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      { name: BACKUP_PEOPLE_PATH, data: peopleBytes }, ...entries]);
    // Loppets namn, eller evenemangets när loppet saknar eget namn.
    const slug = (race.name.trim() || race.eventName).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 60) || race.shortCode;
    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    return { status: "ok", bytes, manifest, raceId, accountId, sha256: sha256Hex(bytes),
      fileName: `otid-sakerhetskopia-${slug}-${race.raceDate}-${stamp}.zip` } as const;
  }, { isolationLevel: "repeatable read" });
  if (result.status !== "ok") return result;

  // Tiden för "Senast nedladdad" och journalen: utan namn, bara antal och filens kontrollsumma.
  await db.transaction(async (tx) => {
    await tx.update(schema.races).set({ lastBackupAt: now }).where(eq(schema.races.id, result.raceId));
    await tx.insert(schema.auditEvents).values({ raceId: result.raceId, entityType: "race", entityId: result.raceId,
      action: "RACE_BACKUP_CREATED", actorKind: "USER_ACCOUNT", actorId: result.accountId, createdAt: now,
      after: { formatVersion: RACE_BACKUP_FORMAT_VERSION, sha256: result.sha256, bytes: result.bytes.byteLength,
        counts: result.manifest.counts } });
  });
  return { status: "ok", bytes: result.bytes, fileName: result.fileName, manifest: result.manifest };
}

/** Tiden när säkerhetskopian senast laddades ner (Inställningar). Bara administratören. */
export async function readRaceBackupStatusAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">,
  now = new Date()): Promise<{ status: "unauthorized" | "forbidden" | "not-found" } | { status: "ok"; lastDownloadedAt: string | null }> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const [race] = await tx.select({ at: schema.races.lastBackupAt }).from(schema.races).where(eq(schema.races.id, auth.principal.raceId));
    if (!race) return { status: "not-found" } as const;
    return { status: "ok", lastDownloadedAt: race.at?.toISOString() ?? null } as const;
  });
}
