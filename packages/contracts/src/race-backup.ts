import { z } from "zod";
import { ANY_UUID_PATTERN, sha256HexSchema, uuidSchema } from "./ids";

/**
 * Säkerhetskopia av en tävling (ADR-0187): en zip med `manifest.json`, en JSON-fil per tabell (`data/<tabell>.json`),
 * personer med behörighet (`personer.json`, bara e-post och roll) och binärdata (kartfil, kartbild, foton, GPX) som egna
 * filer (`filer/<sha256>`). Varje fil har sin sha256 i manifestet. Konton, lösenord, sessioner och Eventor-nycklar finns
 * aldrig med; kontonas id är ersatta med slumpade referenser.
 */
export const RACE_BACKUP_FORMAT = "otid-sakerhetskopia";
export const RACE_BACKUP_FORMAT_VERSION = 2;
/** Den gamla exporten (PLAN.md steg 27) var en JSON-fil med formatVersion 1 och kan inte läsas in. */
export const RACE_EXPORT_V1_FORMAT = "otid-race-export";

/** Uppladdningen (hela zip-filen). Caddy har ingen lägre gräns för sökvägen (deploy/Caddyfile). */
export const RACE_BACKUP_MAX_BYTES = 200 * 1024 * 1024;
/** En tabellfil eller personfilen, uppackad. */
export const RACE_BACKUP_MAX_DATA_FILE_BYTES = 96 * 1024 * 1024;
/** En binärfil, uppackad (kartfilen får vara 60 MB). */
export const RACE_BACKUP_MAX_BINARY_BYTES = 72 * 1024 * 1024;
/** Allt uppackat tillsammans. */
export const RACE_BACKUP_MAX_TOTAL_BYTES = 400 * 1024 * 1024;
/** Antal filer i arkivet. */
export const RACE_BACKUP_MAX_ENTRIES = 10_000;
/** Manifestet, uppackat. */
export const RACE_BACKUP_MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export const BACKUP_TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
export const backupDataPath = (table: string) => `data/${table}.json`;
export const backupBinaryPath = (sha256: string) => `filer/${sha256}`;
export const BACKUP_PEOPLE_PATH = "personer.json";
export const BACKUP_MANIFEST_PATH = "manifest.json";

const count = z.number().int().nonnegative();

/** Det första som läses: känner servern inte igen formatet eller versionen avvisas filen med ett begripligt besked. */
export const raceBackupHeaderSchema = z.object({ format: z.string().max(100), formatVersion: z.number().int() }).loose();

export const raceBackupCountsSchema = z.object({
  classes: count, courses: count, controls: count, entries: count, teams: count, cardReadouts: count,
  resultRevisions: count, radioPunches: count, files: count, people: count
}).strict();
export type RaceBackupCounts = z.infer<typeof raceBackupCountsSchema>;

export const raceBackupManifestSchema = z.object({
  format: z.literal(RACE_BACKUP_FORMAT),
  formatVersion: z.literal(RACE_BACKUP_FORMAT_VERSION),
  createdAt: z.iso.datetime({ offset: true }),
  /** Resultatmotorns version när kopian togs (informativt). */
  engineVersion: z.string().min(1).max(40),
  /** Kopian innehåller personuppgifter (namn, klubb, bricka, e-post för behörigheter). Alltid sant. */
  containsPersonalData: z.literal(true),
  race: z.object({
    eventName: z.string().min(1).max(200), raceName: z.string().max(200), raceDate: z.iso.date(),
    raceType: z.string().min(1).max(20), timeZone: z.string().min(1).max(100)
  }).strict(),
  counts: raceBackupCountsSchema,
  /** Deltagare vars resultat behövde räknas om när kopian togs (ADR-0187: räknas som aktuella i kopian). */
  staleResults: count,
  /**
   * Resultatrevisionerna (id i kopian) vars underlag inte längre gällde när kopian togs. De behåller sin hash vid återställningen
   * och förblir inaktuella (ADR-0187 beslut 5). Saknas i kopior från före 2026-11-03; då räknas alla som aktuella.
   */
  staleResultRevisions: z.array(z.string().regex(ANY_UUID_PATTERN)).max(1_000_000).optional(),
  tables: z.array(z.object({ name: z.string().regex(BACKUP_TABLE_NAME), rows: count, sha256: sha256HexSchema, bytes: count }).strict())
    .max(200),
  people: z.object({ sha256: sha256HexSchema, bytes: count }).strict(),
  files: z.array(z.object({ sha256: sha256HexSchema, bytes: count }).strict()).max(RACE_BACKUP_MAX_ENTRIES)
}).strict();
export type RaceBackupManifest = z.infer<typeof raceBackupManifestSchema>;

/** En person med behörighet: referensen som tabellerna använder i stället för kontots id, e-post och roller. */
export const raceBackupPersonSchema = z.object({
  ref: uuidSchema,
  /** Null för den som bjöds in "Från klubben" (ADR-0209 beslut 7: den som bjöd in ser aldrig adressen); kopplas aldrig. */
  email: z.string().trim().toLowerCase().min(3).max(254).regex(/^[^@\s]+@[^@\s]+$/).nullable(),
  eventRole: z.enum(["OWNER", "ADMIN", "FUNCTIONARY"]).nullable(),
  courseSettingLevel: z.enum(["EDIT", "SUGGEST", "COMMENT", "MAP"]).nullable()
}).strict();
export const raceBackupPeopleSchema = z.array(raceBackupPersonSchema).max(10_000);
export type RaceBackupPerson = z.infer<typeof raceBackupPersonSchema>;

/** Binärdata i en rad: filen i arkivet. */
export const backupBinaryRefSchema = z.object({ fil: sha256HexSchema }).strict();

/** Kolumnens typ i PostgreSQL (`information_schema.columns`), för den strikta kontrollen av varje rad. */
export type BackupColumnType = "uuid" | "text" | "integer" | "smallint" | "bigint" | "double precision" | "boolean" | "date" |
  "timestamp with time zone" | "jsonb" | "bytea" | "text[]" | "enum";

/** Lösare än `uuidSchema`: id från enheter och äldre rader behöver inte ha version 1–8. */
const anyUuid = z.string().regex(ANY_UUID_PATTERN);
const int = (bits: 16 | 32) => z.number().int().min(-(2 ** (bits - 1))).max(2 ** (bits - 1) - 1);

export function backupColumnSchema(type: BackupColumnType): z.ZodType {
  switch (type) {
    case "uuid": return anyUuid;
    case "text": case "enum": return z.string().max(64 * 1024 * 1024);
    case "integer": return int(32);
    case "smallint": return int(16);
    case "bigint": return z.number().int().refine(Number.isSafeInteger);
    case "double precision": return z.number().finite();
    case "boolean": return z.boolean();
    case "date": return z.iso.date();
    case "timestamp with time zone": return z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:\d{2}|Z)$/);
    case "jsonb": return z.json();
    case "bytea": return backupBinaryRefSchema;
    case "text[]": return z.array(z.string().max(10_000)).max(100_000);
  }
}

/** En rad: bara kända kolumner, rätt typ och NULL bara där kolumnen tillåter det. */
export function backupRowSchema(columns: readonly { name: string; type: BackupColumnType; nullable: boolean }[]) {
  return z.strictObject(Object.fromEntries(columns.map(column => {
    const value = backupColumnSchema(column.type);
    return [column.name, (column.nullable ? value.nullable() : value).optional()];
  })));
}

/** Förhandsvisningen: vad den nya tävlingen får, innan något sparas. */
export const raceBackupPreviewSchema = z.object({
  formatVersion: z.literal(1),
  backupFormatVersion: z.literal(RACE_BACKUP_FORMAT_VERSION),
  createdAt: z.iso.datetime({ offset: true }),
  race: raceBackupManifestSchema.shape.race,
  counts: raceBackupCountsSchema,
  staleResults: count,
  sha256: sha256HexSchema,
  bytes: count,
  /** Adressen (null = "Från klubben") och rollen. Inget om huruvida adressen har ett konto här (filen är inte signerad). */
  people: z.array(z.object({ email: z.string().nullable(), role: z.string() }).strict()).max(10_000),
  eventorLinked: z.boolean(),
  radioLinked: z.boolean(),
  map: z.boolean()
}).strict();
export type RaceBackupPreview = z.infer<typeof raceBackupPreviewSchema>;

export const raceRestoreOptionsSchema = z.object({
  requestId: uuidSchema,
  /**
   * "link": adresserna i kopian får vanliga inbjudningar med sina roller (gäller när någon loggar in med adressen); "skip": bara
   * du får behörighet. Inget annat konto får behörighet direkt (ADR-0187, ändrat 2026-11-07).
   */
  people: z.enum(["link", "skip"])
}).strict();
export type RaceRestoreOptions = z.infer<typeof raceRestoreOptionsSchema>;

export const raceRestoreResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuidSchema,
  eventId: uuidSchema,
  raceId: uuidSchema,
  counts: raceBackupCountsSchema,
  /** Antal inbjudningar som skapades till adresserna i kopian. Säger inget om vilka adresser som har konto här. */
  invitations: count,
  createdAt: z.iso.datetime({ offset: true })
}).strict();
export type RaceRestoreResponse = z.infer<typeof raceRestoreResponseSchema>;

/** Varför en fil avvisades. `detail` är t.ex. formatversionen eller tabellen och kolumnen. */
export const raceBackupProblemCodes = ["NOT_A_BACKUP", "OLD_EXPORT", "UNKNOWN_FORMAT_VERSION", "TOO_LARGE", "BROKEN_ARCHIVE",
  "CHECKSUM_MISMATCH", "UNKNOWN_CONTENT", "INVALID_CONTENT", "DATA_REJECTED", "STORAGE_QUOTA_EXCEEDED"] as const;
export const raceBackupProblemSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(raceBackupProblemCodes),
  detail: z.string().max(300).optional()
}).strict();
export type RaceBackupProblem = z.infer<typeof raceBackupProblemSchema>;

/** Senaste nedladdningen av säkerhetskopian (Inställningar): bara tiden, ingen person. */
export const raceBackupStatusSchema = z.object({
  formatVersion: z.literal(1),
  lastDownloadedAt: z.iso.datetime({ offset: true }).nullable()
}).strict();
export type RaceBackupStatus = z.infer<typeof raceBackupStatusSchema>;
