import { sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { anonymizeEntries } from "./anonymization";
import { purgeRows } from "./purge";
import { sweepMapContent } from "./map-content";

/**
 * ADR-0189 beslut 6: valfri automatisk gallring. Tävlingar vars datum är äldre än `months` månader anonymiseras (alla
 * deltagare som "Anonym deltagare", festens gäster, GPS-rutterna och utskrifterna) eller tas bort helt (evenemanget när alla
 * dess lopp är så gamla). Av som förval. Körs av webbens underhåll (`apps/web/src/lib/maintenance-runner.ts`) en gång i timmen,
 * högst några tävlingar per varv och en tävling per transaktion.
 */
export interface RetentionSettings { readonly mode: "off" | "anonymize" | "delete"; readonly months: number }
/** Förslaget i ADR-0189: två säsonger, så att förra årets resultat finns kvar till nästa års tävling. */
export const DEFAULT_RETENTION_MONTHS = 24;
const BATCH = 5;

export function retentionSettings(env: Partial<Record<string, string | undefined>> = process.env): RetentionSettings {
  const raw = env.OTID_RETENTION?.trim().toLowerCase();
  const mode = raw === "anonymize" || raw === "anonymisera" ? "anonymize" : raw === "delete" || raw === "ta-bort" ? "delete" : "off";
  const months = Number(env.OTID_RETENTION_MONTHS?.trim());
  return { mode, months: Number.isInteger(months) && months >= 3 && months <= 600 ? months : DEFAULT_RETENTION_MONTHS };
}

/** Fel inställningar, för loggen vid start. */
export function retentionSettingsProblems(env: Partial<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  const raw = env.OTID_RETENTION?.trim().toLowerCase();
  if (raw && !["off", "av", "anonymize", "anonymisera", "delete", "ta-bort"].includes(raw)) {
    problems.push(`OTID_RETENTION="${raw}" är okänd; tillåtet är off, anonymize eller delete. Gallringen är av`);
  }
  const months = env.OTID_RETENTION_MONTHS?.trim();
  if (months && !(Number.isInteger(Number(months)) && Number(months) >= 3 && Number(months) <= 600)) {
    problems.push(`OTID_RETENTION_MONTHS ska vara ett heltal 3–600; förvalet ${DEFAULT_RETENTION_MONTHS} används`);
  }
  return problems;
}

/** Dagen före vilken en tävling gallras (ÅÅÅÅ-MM-DD, i UTC). */
export function retentionCutoff(now: Date, months: number): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return cutoff.toISOString().slice(0, 10);
}

export interface RetentionRun { readonly anonymizedRaces: number; readonly anonymizedEntries: number; readonly deletedEvents: number }

/** Anonymiserar en hel tävling i anroparens transaktion (gallringen). Ger antal deltagare. */
export async function anonymizeRace(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], raceId: string, now: Date): Promise<number> {
  const result = await anonymizeEntries(tx, raceId, "all", now);
  // Festens gäster (inte anmälda) och alla GPS-rutter; brickans nummer hör till festens kassa och stannar.
  await tx.execute(sql`update party_guest set name = 'Anonym', display_name = null, club = null where race_id = ${raceId}`);
  await tx.execute(sql`delete from participant_route where race_id = ${raceId}`);
  await tx.execute(sql`update race set personal_data_removed_at = ${now} where id = ${raceId}`);
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_ANONYMIZED_BY_RETENTION",
    createdAt: now, after: { entries: result.entries, rows: result.rows } });
  return result.entries;
}

export async function runRetention(db: Database, settings: RetentionSettings, now = new Date()): Promise<RetentionRun> {
  let anonymizedRaces = 0, anonymizedEntries = 0, deletedEvents = 0;
  if (settings.mode === "off") return { anonymizedRaces, anonymizedEntries, deletedEvents };
  const cutoff = retentionCutoff(now, settings.months);
  if (settings.mode === "anonymize") {
    const races = (await db.execute<{ id: string }>(sql`select id from race where race_date < ${cutoff}::date and personal_data_removed_at is null
      order by race_date limit ${BATCH}`)).rows;
    for (const { id } of races) {
      const entries = await db.transaction(async tx => {
        const [locked] = (await tx.execute<{ id: string }>(sql`select id from race where id = ${id} and personal_data_removed_at is null
          for update skip locked`)).rows;
        return locked ? anonymizeRace(tx, id, now) : undefined;
      });
      if (entries !== undefined) { anonymizedRaces += 1; anonymizedEntries += entries; }
    }
  } else {
    const events = (await db.execute<{ id: string; name: string }>(sql`select e.id, e.name from event e
      where exists (select 1 from race r where r.event_id = e.id)
        and not exists (select 1 from race r where r.event_id = e.id and r.race_date >= ${cutoff}::date)
      order by e.created_at limit ${BATCH}`)).rows;
    for (const event of events) {
      await db.transaction(async tx => {
        const [locked] = (await tx.execute<{ id: string }>(sql`select id from event where id = ${event.id} for update skip locked`)).rows;
        if (!locked) return;
        await purgeRows(tx, "event", [event.id]);
        // Samma logg som superadmins borttagning, utan konto (append-only, utan främmande nycklar).
        await tx.insert(schema.superadminActions).values({ createdAt: now, actorAccountId: null, actorLabel: "Automatisk gallring",
          action: "DELETE_EVENT", targetType: "EVENT", targetId: event.id, targetLabel: event.name.trim() || "Tävling",
          reason: `Gallring: tävlingen är äldre än ${settings.months} månader (OTID_RETENTION=delete)` });
        deletedEvents += 1;
      });
    }
  }
  return { anonymizedRaces, anonymizedEntries, deletedEvents };
}

/** Underhållet en gång i timmen: kartinnehåll utan referens och avbrutna uppladdningar, sedan gallringen. */
export async function runMaintenance(db: Database, settings: RetentionSettings, now = new Date()) {
  const swept = await db.transaction(tx => sweepMapContent(tx, now));
  const retention = await runRetention(db, settings, now);
  return { swept, retention };
}
