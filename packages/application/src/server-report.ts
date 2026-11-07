import { localRaceDate, parseRaceClock } from "@o-tid/domain";

/**
 * ADR-0216: serverns veckorapport och larm till superadmin. Den här filen är ren (ingen I/O): inställningarna, vilka problem en
 * mätning visar, larmens "högst ett per sort och dygn / löst"-logik, när veckorapporten ska gå och texterna. Mätningen görs i
 * `server-status.ts` och skickas av webbens bevakning (`apps/web/src/lib/server-watch-runner.ts`). Inga personuppgifter: bara
 * storlekar, antal och tider.
 */
export const ALERT_KINDS = ["DISK", "MAP_QUOTA", "BACKUP", "HEALTH", "MEMORY"] as const;
export type AlertKind = typeof ALERT_KINDS[number];
export const TIME_ZONE = "Europe/Stockholm";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Larm per sort: högst ett per dygn (också påminnelsen när problemet står kvar). */
export const ALERT_REPEAT_MS = DAY;

type Env = Partial<Record<string, string | undefined>>;

export interface ServerWatchSettings {
  /** Minuter mellan varven (samma som hälsokontrollen, `OTID_HEALTH_INTERVAL_MINUTES`, förval 15). */
  readonly intervalMinutes: number;
  /** Veckorapporten: ISO-veckodag (1 = måndag, 7 = söndag) och timme i svensk tid; null = avstängd. */
  readonly report: { readonly day: number; readonly hour: number } | null;
  readonly alerts: boolean;
  readonly diskAlertPercent: number;
  readonly mapQuotaAlertPercent: number;
  readonly backupMaxAgeHours: number;
  readonly memoryAlertPercent: number;
  /** Så många misslyckade hälsokontroller i rad innan det larmas. */
  readonly healthFailures: number;
}

const DEFAULTS = { intervalMinutes: 15, day: 7, hour: 19, diskAlertPercent: 80, mapQuotaAlertPercent: 90, backupMaxAgeHours: 3,
  memoryAlertPercent: 10, healthFailures: 3 } as const;

const VARIABLES = {
  intervalMinutes: ["OTID_HEALTH_INTERVAL_MINUTES", 1, 1440],
  day: ["OTID_SERVER_REPORT_DAY", 1, 7],
  hour: ["OTID_SERVER_REPORT_HOUR", 0, 23],
  diskAlertPercent: ["OTID_DISK_ALERT_PERCENT", 1, 100],
  mapQuotaAlertPercent: ["OTID_MAP_QUOTA_ALERT_PERCENT", 1, 100],
  backupMaxAgeHours: ["OTID_BACKUP_ALERT_HOURS", 1, 720],
  memoryAlertPercent: ["OTID_MEMORY_ALERT_PERCENT", 1, 99]
} as const;

const readInteger = (env: Env, name: string, min: number, max: number): number | undefined => {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
};
const isOff = (value: string | undefined) => ["off", "av", "0", "false"].includes(value?.trim().toLowerCase() ?? "");

/** Inställningarna ur miljön; ett ogiltigt värde ger förvalet (och står i `serverWatchSettingsProblems`). */
export function serverWatchSettings(env: Env = process.env): ServerWatchSettings {
  const read = (key: keyof typeof VARIABLES) => {
    const [name, min, max] = VARIABLES[key];
    return readInteger(env, name, min, max) ?? DEFAULTS[key];
  };
  return {
    intervalMinutes: read("intervalMinutes"),
    report: isOff(env.OTID_SERVER_REPORT) ? null : { day: read("day"), hour: read("hour") },
    alerts: !isOff(env.OTID_SERVER_ALERTS),
    diskAlertPercent: read("diskAlertPercent"),
    mapQuotaAlertPercent: read("mapQuotaAlertPercent"),
    backupMaxAgeHours: read("backupMaxAgeHours"),
    memoryAlertPercent: read("memoryAlertPercent"),
    healthFailures: DEFAULTS.healthFailures
  };
}

/** Fel inställningar, för loggen vid start (KONFIGURATIONSFEL). */
export function serverWatchSettingsProblems(env: Env): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(VARIABLES) as (keyof typeof VARIABLES)[]) {
    const [name, min, max] = VARIABLES[key];
    if (env[name]?.trim() && readInteger(env, name, min, max) === undefined) {
      problems.push(`${name} ska vara ett heltal ${min}–${max}; förvalet ${DEFAULTS[key]} används`);
    }
  }
  return problems;
}

// ---- Mätningen

export interface MonitorCheck { readonly at: Date; readonly ok: boolean; readonly codes: readonly string[]; readonly text: string }
export interface BackupStatus { readonly at: Date; readonly ok: boolean; readonly detail: string }

export interface DatabaseSizes {
  readonly totalBytes: number;
  /** Kartfiler och kartbilder (kartinnehållet och de gamla kolumnerna), banfiler och GPS-rutter. */
  readonly mapBytes: number;
  /** Klubbarkivets miniatyrer och kontroller, papperets bilder, festens logga, kommentarernas foton. */
  readonly imageBytes: number;
  /** Utskriftskön (PDF:erna). */
  readonly printBytes: number;
}

export interface ServerCounts {
  readonly accounts: number;
  readonly accountsNew: number;
  readonly clubs: number;
  readonly events: number;
  readonly races: number;
  readonly upcomingRaces: number;
  readonly upcomingPublished: number;
  readonly upcomingEntries: number;
  readonly upcomingMaxEntries: number;
}

export interface ServerSnapshot {
  readonly at: Date;
  readonly disk: { readonly totalBytes: number; readonly freeBytes: number } | null;
  /** Minsta lediga minnet sedan förra varvet (hela servern, MemAvailable). */
  readonly memory: { readonly totalBytes: number; readonly availableBytes: number } | null;
  /** Högsta belastningen (1 min) sedan förra varvet. */
  readonly load: { readonly max: number; readonly at: Date; readonly cpus: number } | null;
  readonly database: DatabaseSizes;
  /** Kartinnehållet som räknas mot kvoten (`mapStorageUsage`) och kvoten för hela servern (null = ingen). */
  readonly maps: { readonly storedBytes: number; readonly quotaBytes: number | null };
  /** Null när katalogen med säkerhetskopiorna inte syns för webben. */
  readonly backups: {
    readonly totalBytes: number; readonly dumpBytes: number; readonly mapContentBytes: number; readonly dumps: number;
    readonly newestAt: Date | null; readonly status: BackupStatus | null;
  } | null;
  /** De senaste hälsokontrollerna (nyast sist); null när tjänsten monitor inte skriver något som webben ser. */
  readonly monitor: readonly MonitorCheck[] | null;
  readonly counts: ServerCounts;
}

/** Hälsokontrollens koder som har egna larm (disken och backupen) räknas inte som "hälsokontroll misslyckad". */
const OWN_ALERT_CODES = new Set(["disk", "backup"]);

export const usedPercent = (disk: { totalBytes: number; freeBytes: number }) =>
  disk.totalBytes > 0 ? (disk.totalBytes - disk.freeBytes) / disk.totalBytes * 100 : 0;

/** Problemen just nu, per sort, med en kort beskrivning på svenska. */
export function serverProblems(snapshot: ServerSnapshot, settings: ServerWatchSettings): Map<AlertKind, string> {
  const problems = new Map<AlertKind, string>();
  const now = snapshot.at.getTime();
  if (snapshot.disk) {
    const used = usedPercent(snapshot.disk);
    if (used > settings.diskAlertPercent) {
      problems.set("DISK", `Disken är ${percent(used)} full (gräns ${settings.diskAlertPercent} %): ${bytes(snapshot.disk.freeBytes)} ledigt av ` +
        `${bytes(snapshot.disk.totalBytes)}.`);
    }
  }
  const { storedBytes, quotaBytes } = snapshot.maps;
  if (quotaBytes !== null && quotaBytes > 0 && storedBytes / quotaBytes * 100 >= settings.mapQuotaAlertPercent) {
    problems.set("MAP_QUOTA", `Kartorna tar ${bytes(storedBytes)} av kvoten ${bytes(quotaBytes)} (${percent(storedBytes / quotaBytes * 100)}). ` +
      "När kvoten är nådd kan ingen ladda upp nya kartor.");
  }
  const backups = snapshot.backups;
  if (backups) {
    const maxAge = settings.backupMaxAgeHours * HOUR;
    if (backups.status && !backups.status.ok && (!backups.newestAt || backups.status.at.getTime() > backups.newestAt.getTime())) {
      problems.set("BACKUP", `Senaste säkerhetskopian misslyckades ${dateTime(backups.status.at)}: ${backups.status.detail}`.slice(0, 400));
    } else if (!backups.newestAt) {
      problems.set("BACKUP", "Det finns ingen säkerhetskopia i backups/hourly.");
    } else if (now - backups.newestAt.getTime() > maxAge) {
      problems.set("BACKUP", `Senaste säkerhetskopian är ${Math.floor((now - backups.newestAt.getTime()) / HOUR)} timmar gammal ` +
        `(${dateTime(backups.newestAt)}; gräns ${settings.backupMaxAgeHours} timmar).`);
    }
  }
  const checks = snapshot.monitor;
  if (checks && checks.length > 0) {
    const last = checks[checks.length - 1]!;
    const stale = Math.max(3 * settings.intervalMinutes * 60_000, HOUR);
    const recent = checks.slice(-settings.healthFailures);
    const failing = recent.length === settings.healthFailures && recent.every(check => !check.ok && check.codes.some(code => !OWN_ALERT_CODES.has(code)));
    if (now - last.at.getTime() > stale) {
      problems.set("HEALTH", `Hälsokontrollen (tjänsten monitor) har inte rapporterat sedan ${dateTime(last.at)}.`);
    } else if (failing) {
      problems.set("HEALTH", `Hälsokontrollen har misslyckats ${settings.healthFailures} gånger i rad: ${last.text}`.slice(0, 400));
    }
  }
  if (snapshot.memory && snapshot.memory.totalBytes > 0) {
    const free = snapshot.memory.availableBytes / snapshot.memory.totalBytes * 100;
    if (free < settings.memoryAlertPercent) {
      problems.set("MEMORY", `Bara ${bytes(snapshot.memory.availableBytes)} ledigt minne av ${bytes(snapshot.memory.totalBytes)} ` +
        `(${percent(free)}; gräns ${settings.memoryAlertPercent} %).`);
    }
  }
  return problems;
}

// ---- Larmen

export interface NoticeState {
  /** När det pågående problemet började (null = inget problem). */
  readonly activeSince: Date | null;
  /** Om ett larm skickats för det pågående problemet (då kommer ett "löst" när det går över). */
  readonly alerted: boolean;
  /** När det senaste larmet av den här sorten skickades. */
  readonly lastSentAt: Date | null;
  readonly detail: string | null;
}
export const EMPTY_NOTICE: NoticeState = { activeSince: null, alerted: false, lastSentAt: null, detail: null };

export interface AlertMessage {
  readonly kind: AlertKind;
  readonly status: "ALERT" | "RESOLVED";
  readonly detail: string;
  /** När problemet började (för "fortfarande" och "löst"). */
  readonly since: Date;
}

/**
 * Larmens logik: ett nytt problem larmas direkt, om inget larm av samma sort skickats det senaste dygnet; ett problem som står
 * kvar larmas igen (påminnelse) tidigast ett dygn efter förra larmet; ett problem som gått över ger ett "löst" bara om det
 * larmades. Så blir det högst ett larm och ett "löst" per sort och dygn, också när ett problem kommer och går.
 */
export function evaluateAlerts(states: ReadonlyMap<AlertKind, NoticeState>, problems: ReadonlyMap<AlertKind, string>, now: Date)
  : { states: Map<AlertKind, NoticeState>; messages: AlertMessage[] } {
  const next = new Map<AlertKind, NoticeState>();
  const messages: AlertMessage[] = [];
  for (const kind of ALERT_KINDS) {
    const state = states.get(kind) ?? EMPTY_NOTICE;
    const problem = problems.get(kind);
    if (problem !== undefined) {
      const since = state.activeSince ?? now;
      const mayAlert = !state.lastSentAt || now.getTime() - state.lastSentAt.getTime() >= ALERT_REPEAT_MS;
      if (mayAlert) {
        messages.push({ kind, status: "ALERT", detail: problem, since });
        next.set(kind, { activeSince: since, alerted: true, lastSentAt: now, detail: problem });
      } else {
        next.set(kind, { ...state, activeSince: since, detail: problem });
      }
    } else if (state.activeSince) {
      if (state.alerted) messages.push({ kind, status: "RESOLVED", detail: state.detail ?? "", since: state.activeSince });
      next.set(kind, { activeSince: null, alerted: false, lastSentAt: state.lastSentAt, detail: null });
    } else {
      next.set(kind, state);
    }
  }
  return { states: next, messages };
}

const KIND_NAMES: Record<AlertKind, string> = {
  DISK: "disken", MAP_QUOTA: "kartornas kvot", BACKUP: "säkerhetskopian", HEALTH: "hälsokontrollen", MEMORY: "minnet"
};
const KIND_HELP: Record<AlertKind, string> = {
  DISK: "Se docs/drift.md, Serverrapport och larm (Disken): gamla dumpar, loggar och docker-avbildningar kan tas bort, eller köp större disk.",
  MAP_QUOTA: "Höj OTID_MAP_QUOTA_TOTAL_MB i .env om disken räcker, eller be klubbarna ta bort gamla kartor.",
  BACKUP: "Se `docker compose -f docker-compose.prod.yml logs backup` (BACKUP MISSLYCKADES) och docs/drift.md, Backup.",
  HEALTH: "Se `docker compose -f docker-compose.prod.yml logs monitor` och `ps`; starta om en tjänst med `restart <tjänst>`.",
  MEMORY: "Se `docker stats --no-stream`; en tjänst som växer kan startas om med `docker compose -f docker-compose.prod.yml restart <tjänst>`."
};

/** Ett mejl med alla nya larm och "löst" från ett varv. */
export function alertMessage(messages: readonly AlertMessage[], now: Date, serverName: string): { subject: string; text: string } {
  const alerts = messages.filter(message => message.status === "ALERT");
  const resolved = messages.filter(message => message.status === "RESOLVED");
  const subject = alerts.length > 0
    ? `O-Tid ${serverName}: larm – ${alerts.map(message => KIND_NAMES[message.kind]).join(", ")}`
    : `O-Tid ${serverName}: löst – ${resolved.map(message => KIND_NAMES[message.kind]).join(", ")}`;
  const lines = [`Serverns bevakning ${dateTime(now)}.`, ""];
  for (const message of alerts) {
    const ongoing = now.getTime() - message.since.getTime() >= HOUR;
    lines.push(`${ongoing ? "FORTFARANDE" : "LARM"} (${KIND_NAMES[message.kind]}${ongoing ? `, sedan ${dateTime(message.since)}` : ""}): ${message.detail}`,
      `  ${KIND_HELP[message.kind]}`, "");
  }
  for (const message of resolved) {
    lines.push(`LÖST (${KIND_NAMES[message.kind]}): problemet från ${dateTime(message.since)} har gått över.`,
      ...(message.detail ? [`  Det var: ${message.detail}`] : []), "");
  }
  lines.push("Samma larm skickas högst en gång per dygn, och ett \"löst\" när problemet har gått över.",
    "Skickas till kontona med superadmin. Stängs av med OTID_SERVER_ALERTS=off i .env (docs/drift.md, Serverrapport och larm).");
  return { subject, text: lines.join("\n") };
}

// ---- Veckorapporten

/** Senaste schemalagda tillfälle (veckodag och timme i svensk tid) som har passerat. */
export function lastReportSlot(now: Date, schedule: { day: number; hour: number }): Date {
  const today = localRaceDate(now, TIME_ZONE);
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  for (let back = 0; back <= 8; back += 1) {
    const date = new Date(Date.UTC(year, month - 1, day - back));
    const isoDay = (date.getUTCDay() + 6) % 7 + 1;
    if (isoDay !== schedule.day) continue;
    const slot = parseRaceClock(date.toISOString().slice(0, 10), `${String(schedule.hour).padStart(2, "0")}:00`, TIME_ZONE)
      ?? parseRaceClock(date.toISOString().slice(0, 10), `${String(schedule.hour + 1).padStart(2, "0")}:00`, TIME_ZONE);
    if (slot && Date.parse(slot) <= now.getTime()) return new Date(slot);
  }
  throw new Error("Inget tillfälle för veckorapporten hittades");
}

/**
 * Om veckorapporten ska skickas nu. Första gången (ingen tidigare rapport) skickas ingen: tiden sparas och den första rapporten
 * går vid nästa tillfälle, så att en ny version inte mejlar mitt i veckan.
 */
export function weeklyReportDue(lastSentAt: Date | null, now: Date, schedule: { day: number; hour: number } | null): "due" | "baseline" | "not-due" {
  if (!schedule) return "not-due";
  if (!lastSentAt) return "baseline";
  return lastSentAt.getTime() < lastReportSlot(now, schedule).getTime() ? "due" : "not-due";
}

export interface SampleRow {
  readonly at: Date;
  readonly diskTotalBytes: number | null;
  readonly diskFreeBytes: number | null;
  readonly loadMax: number | null;
  readonly loadMaxAt: Date | null;
  readonly memoryTotalBytes: number | null;
  readonly memoryAvailableMinBytes: number | null;
}
export interface LogRow { readonly kind: string; readonly status: string; readonly detail: string | null; readonly sentAt: Date }

/**
 * Prognosen för disken: tillväxten per vecka ur mätningarna (minsta kvadrat över högst fyra veckor, minst två dygn) och veckor
 * till full disk med den takten. Null när det finns för lite att räkna på.
 */
export function diskForecast(samples: readonly SampleRow[], now: Date): { growthPerWeekBytes: number; weeksToFull: number | null; days: number } | null {
  const points = samples.filter(row => row.diskTotalBytes !== null && row.diskFreeBytes !== null && now.getTime() - row.at.getTime() <= 28 * DAY)
    .map(row => ({ x: row.at.getTime(), used: row.diskTotalBytes! - row.diskFreeBytes!, free: row.diskFreeBytes! }))
    .sort((a, b) => a.x - b.x);
  if (points.length < 3) return null;
  const span = points[points.length - 1]!.x - points[0]!.x;
  if (span < 2 * DAY) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.used, 0) / points.length;
  let numerator = 0, denominator = 0;
  for (const point of points) { numerator += (point.x - meanX) * (point.used - meanY); denominator += (point.x - meanX) ** 2; }
  const growthPerWeekBytes = denominator > 0 ? numerator / denominator * 7 * DAY : 0;
  const free = points[points.length - 1]!.free;
  return { growthPerWeekBytes, weeksToFull: growthPerWeekBytes > 0 ? free / growthPerWeekBytes : null, days: span / DAY };
}

export interface WeeklyHistory {
  /** Mätningarna de senaste fyra veckorna. */
  readonly samples: readonly SampleRow[];
  /** Det som skickats de senaste sju dagarna. */
  readonly log: readonly LogRow[];
}

/** Veckorapporten: kort och läsbar, på svenska, utan personuppgifter. */
export function weeklyReport(snapshot: ServerSnapshot, history: WeeklyHistory, settings: ServerWatchSettings, serverName: string)
  : { subject: string; text: string } {
  const now = snapshot.at;
  const weekAgo = now.getTime() - 7 * DAY;
  const lines: string[] = [];
  const week = isoWeek(now);
  lines.push(`Veckorapport för O-Tid (${serverName}), vecka ${week}, ${dateTime(now)}.`, "");

  // Disken och diskfrågan.
  lines.push("DISKEN");
  const problems = serverProblems(snapshot, settings);
  const forecast = diskForecast(history.samples, now);
  if (snapshot.disk) {
    const used = snapshot.disk.totalBytes - snapshot.disk.freeBytes;
    lines.push(`- ${bytes(used)} använt av ${bytes(snapshot.disk.totalBytes)} (${percent(usedPercent(snapshot.disk))}), ` +
      `${bytes(snapshot.disk.freeBytes)} ledigt. Larmgräns ${settings.diskAlertPercent} %.`);
    if (!forecast) lines.push("- Prognos: för få mätningar ännu (kommer när bevakningen har mätt i minst två dygn).");
    else if (forecast.weeksToFull === null || forecast.growthPerWeekBytes < 50 * 1024 * 1024) {
      lines.push(`- Prognos: disken växer knappt (${signedBytes(forecast.growthPerWeekBytes)} per vecka de senaste ${Math.round(forecast.days)} dygnen). ` +
        "Ingen större disk behövs nu.");
    } else {
      const weeks = forecast.weeksToFull;
      const advice = weeks < 8 ? " Köp större disk (eller en Hetzner Volume) snart." : weeks < 26 ? " Planera för större disk inom några månader."
        : " Ingen större disk behövs nu.";
      lines.push(`- Prognos: ${signedBytes(forecast.growthPerWeekBytes)} per vecka de senaste ${Math.round(forecast.days)} dygnen; ` +
        `med den takten är disken full om ungefär ${weeks >= 104 ? "två år eller mer" : `${Math.round(weeks)} veckor`}.${advice}`);
    }
  } else lines.push("- Diskens storlek kunde inte läsas.");
  const { storedBytes, quotaBytes } = snapshot.maps;
  lines.push(`- Kartorna tar ${bytes(storedBytes)}${quotaBytes === null ? " (ingen kvot)" : ` av kvoten ${bytes(quotaBytes)}`}. ` +
    "Varje GB kartor tar ungefär 2 GB disk (databasen och säkerhetskopiornas kartinnehåll).");
  if (quotaBytes !== null && snapshot.disk && 2 * (quotaBytes - storedBytes) > snapshot.disk.freeBytes) {
    // Kartorna får växa med 40 % av det lediga (två kopior och 20 % marginal).
    const fitsMb = Math.floor((storedBytes + snapshot.disk.freeBytes * 0.4) / 1024 ** 3) * 1024;
    lines.push(`  Kvoten ryms inte på disken om klubbarna fyller den. Sänk OTID_MAP_QUOTA_TOTAL_MB till högst ${fitsMb} ` +
      "eller köp större disk när prognosen ovan säger det.");
  }
  lines.push("");

  lines.push(`DATABASEN: ${bytes(snapshot.database.totalBytes)}`);
  const rest = Math.max(0, snapshot.database.totalBytes - snapshot.database.mapBytes - snapshot.database.imageBytes - snapshot.database.printBytes);
  lines.push(`- kartfiler, kartbilder, banfiler och GPS-rutter: ${bytes(snapshot.database.mapBytes)}`,
    `- bilder och miniatyrer: ${bytes(snapshot.database.imageBytes)}`,
    `- utskrifter (PDF): ${bytes(snapshot.database.printBytes)}`,
    `- resten (tävlingar, anmälda, avläsningar, resultat, konton): ${bytes(rest)}`, "");

  lines.push("SÄKERHETSKOPIOR");
  const backups = snapshot.backups;
  if (!backups) lines.push("- Katalogen backups syns inte för webben (se docs/drift.md, Serverrapport och larm).");
  else {
    lines.push(`- Totalt ${bytes(backups.totalBytes)}: ${count(backups.dumps, "dump", "dumpar")} ${bytes(backups.dumpBytes)}, kartinnehåll ${bytes(backups.mapContentBytes)}.`);
    const status = backups.status ? `${backups.status.ok ? "lyckades" : "MISSLYCKADES"} ${dateTime(backups.status.at)}` : null;
    lines.push(`- Senaste dump: ${backups.newestAt ? dateTime(backups.newestAt) : "ingen"}${status ? `; senaste körningen ${status}` : ""}.`);
  }
  lines.push("");

  const counts = snapshot.counts;
  lines.push("ANVÄNDNING",
    `- ${count(counts.accounts, "konto", "konton")} (${counts.accountsNew} nya senaste veckan), ${count(counts.clubs, "klubb", "klubbar")}, ` +
      `${counts.events} evenemang med ${count(counts.races, "tävling", "tävlingar")}.`,
    `- Kommande 14 dagar: ${count(counts.upcomingRaces, "tävling", "tävlingar")} (${counts.upcomingPublished} publicerade), ${counts.upcomingEntries} anmälda` +
      `${counts.upcomingRaces > 0 ? `, störst ${counts.upcomingMaxEntries} anmälda` : ""}.`, "");

  lines.push("LARM OCH FEL SENASTE VECKAN");
  const sent = history.log.filter(row => row.sentAt.getTime() >= weekAgo && row.status !== "REPORT").sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  if (sent.length === 0) lines.push("- Inga larm.");
  for (const row of sent.slice(-12)) {
    lines.push(`- ${dateTime(row.sentAt)} ${row.status === "RESOLVED" ? "löst" : "larm"} (${KIND_NAMES[row.kind as AlertKind] ?? row.kind})` +
      `${row.status === "ALERT" && row.detail ? `: ${row.detail}` : ""}`);
  }
  if (sent.length > 12) lines.push(`- … och ${sent.length - 12} till.`);
  for (const [kind, detail] of problems) lines.push(`- Just nu (${KIND_NAMES[kind]}): ${detail}`);
  const checks = (snapshot.monitor ?? []).filter(check => check.at.getTime() >= weekAgo);
  if (snapshot.monitor) {
    const failed = checks.filter(check => !check.ok).length;
    lines.push(`- Hälsokontrollen: ${checks.length} kontroller, ${failed} misslyckade.`);
  } else lines.push("- Hälsokontrollens resultat syns inte för webben (se docs/drift.md, Serverrapport och larm).");
  lines.push("");

  lines.push("BELASTNING");
  const week7 = history.samples.filter(row => row.at.getTime() >= weekAgo);
  const peak = week7.filter(row => row.loadMax !== null).sort((a, b) => b.loadMax! - a.loadMax!)[0];
  const cpus = snapshot.load?.cpus ?? 2;
  if (peak) {
    lines.push(`- Högsta belastning (1 min): ${number(peak.loadMax!)} ${dateTime(peak.loadMaxAt ?? peak.at)} (${cpus} kärnor; ${cpus} = fullt utnyttjad).`);
  } else if (snapshot.load) {
    lines.push(`- Belastning just nu (1 min): ${number(snapshot.load.max)} (${cpus} kärnor); topparna kommer när bevakningen har mätt en vecka.`);
  } else lines.push("- Inga mätningar av belastningen ännu.");
  const lowest = week7.filter(row => row.memoryAvailableMinBytes !== null && row.memoryTotalBytes)
    .sort((a, b) => a.memoryAvailableMinBytes! - b.memoryAvailableMinBytes!)[0];
  if (lowest) lines.push(`- Minst ledigt minne: ${bytes(lowest.memoryAvailableMinBytes!)} av ${bytes(lowest.memoryTotalBytes!)} ${dateTime(lowest.at)}.`);
  lines.push("", "Rapporten skickas till kontona med superadmin. Dag och tid ändras med OTID_SERVER_REPORT_DAY och OTID_SERVER_REPORT_HOUR, " +
    "och den stängs av med OTID_SERVER_REPORT=off (docs/drift.md, Serverrapport och larm).");

  const headline = problems.size > 0 ? `${problems.size} problem` : snapshot.disk ? `disken ${percent(usedPercent(snapshot.disk))}` : "allt ok";
  return { subject: `O-Tid ${serverName}: veckorapport vecka ${week} (${headline})`, text: lines.join("\n") };
}

// ---- Format

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

const one = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
export function number(value: number): string {
  return one.format(value);
}
export function bytes(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1024 ** 3) return `${one.format(value / 1024 ** 3)} GB`;
  if (abs >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  if (abs >= 1024) return `${Math.round(value / 1024)} kB`;
  return `${Math.round(value)} B`;
}
const signedBytes = (value: number) => `${value >= 0 ? "+" : "−"}${bytes(Math.abs(value))}`;
function percent(value: number): string {
  return `${Math.round(value)} %`;
}
const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit",
  minute: "2-digit", hourCycle: "h23" });
export function dateTime(value: Date): string {
  return stamp.format(value);
}
export function isoWeek(value: Date): number {
  const [year, month, day] = localRaceDate(value, TIME_ZONE).split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7);
}
