import { describe, expect, it } from "vitest";
import {
  alertMessage, diskForecast, EMPTY_NOTICE, evaluateAlerts, isoWeek, lastReportSlot, serverProblems, serverWatchSettings,
  serverWatchSettingsProblems, weeklyReport, weeklyReportDue, type AlertKind, type NoticeState, type SampleRow, type ServerSnapshot
} from "../src/server-report";
import { parseMonitorLog } from "../src/server-status";

/** ADR-0216: veckorapportens sammanställning och larmens "en gång per dygn / löst"-logik. */
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const HOUR = 3_600_000;
const settings = serverWatchSettings({});
const now = new Date("2026-11-08T18:05:00Z"); // söndag 19:05 svensk tid

function snapshot(overrides: Partial<ServerSnapshot> = {}): ServerSnapshot {
  return {
    at: now,
    disk: { totalBytes: 38 * GB, freeBytes: 25 * GB },
    memory: { totalBytes: 4 * GB, availableBytes: 1.5 * GB },
    load: { max: 0.4, at: now, cpus: 2 },
    database: { totalBytes: 3 * GB, mapBytes: 2 * GB, imageBytes: 100 * MB, printBytes: 200 * MB },
    maps: { storedBytes: 2 * GB, quotaBytes: 20 * GB },
    backups: { totalBytes: 6 * GB, dumpBytes: 4 * GB, mapContentBytes: 2 * GB, dumps: 34, newestAt: new Date(now.getTime() - 5 * 60_000),
      status: { at: new Date(now.getTime() - 5 * 60_000), ok: true, detail: "" } },
    monitor: [{ at: new Date(now.getTime() - 10 * 60_000), ok: true, codes: [], text: "" }],
    counts: { accounts: 85, accountsNew: 3, clubs: 12, events: 120, races: 140, upcomingRaces: 6, upcomingPublished: 4, upcomingEntries: 900,
      upcomingMaxEntries: 320 },
    ...overrides
  };
}

describe("inställningarna", () => {
  it("har förval och säger vilka värden som är fel", () => {
    expect(settings).toMatchObject({ intervalMinutes: 15, report: { day: 7, hour: 19 }, alerts: true, diskAlertPercent: 80, backupMaxAgeHours: 3 });
    expect(serverWatchSettings({ OTID_SERVER_REPORT: "off", OTID_SERVER_ALERTS: "off" })).toMatchObject({ report: null, alerts: false });
    expect(serverWatchSettings({ OTID_SERVER_REPORT_DAY: "1", OTID_SERVER_REPORT_HOUR: "7" }).report).toEqual({ day: 1, hour: 7 });
    expect(serverWatchSettings({ OTID_DISK_ALERT_PERCENT: "200" }).diskAlertPercent).toBe(80);
    expect(serverWatchSettingsProblems({ OTID_DISK_ALERT_PERCENT: "200", OTID_SERVER_REPORT_HOUR: "x" })).toHaveLength(2);
    expect(serverWatchSettingsProblems({})).toEqual([]);
  });
});

describe("problemen", () => {
  it("allt bra ger inga problem", () => {
    expect(serverProblems(snapshot(), settings).size).toBe(0);
  });

  it("disk, kvot, backup, hälsokontroll och minne", () => {
    const failing = (minutes: number) => ({ at: new Date(now.getTime() - minutes * 60_000), ok: false, codes: ["public"], text: "publikens instans svarar inte" });
    const problems = serverProblems(snapshot({
      disk: { totalBytes: 38 * GB, freeBytes: 5 * GB },
      maps: { storedBytes: 19 * GB, quotaBytes: 20 * GB },
      backups: { totalBytes: 1, dumpBytes: 1, mapContentBytes: 0, dumps: 1, newestAt: new Date(now.getTime() - 5 * HOUR), status: null },
      monitor: [failing(40), failing(25), failing(10)],
      memory: { totalBytes: 4 * GB, availableBytes: 200 * MB }
    }), settings);
    expect([...problems.keys()].sort()).toEqual(["BACKUP", "DISK", "HEALTH", "MAP_QUOTA", "MEMORY"]);
    expect(problems.get("DISK")).toContain("87 % full");
    expect(problems.get("BACKUP")).toContain("5 timmar gammal");
    expect(problems.get("HEALTH")).toContain("3 gånger i rad");
  });

  it("en misslyckad backup efter den senaste dumpen larmar; hälsokontrollens disk- och backupfel har egna larm", () => {
    const problems = serverProblems(snapshot({
      backups: { totalBytes: 1, dumpBytes: 1, mapContentBytes: 0, dumps: 1, newestAt: new Date(now.getTime() - HOUR),
        status: { at: new Date(now.getTime() - 60_000), ok: false, detail: "pg_dump misslyckades" } },
      monitor: [1, 2, 3].map(index => ({ at: new Date(now.getTime() - index * 60_000), ok: false, codes: ["disk"], text: "disken" }))
    }), settings);
    expect(problems.get("BACKUP")).toContain("misslyckades");
    expect(problems.has("HEALTH")).toBe(false);
  });

  it("två misslyckade kontroller räcker inte, en tyst hälsokontroll larmar", () => {
    const fail = { ok: false, codes: ["web"], text: "webben" };
    expect(serverProblems(snapshot({ monitor: [{ at: new Date(now.getTime() - 30 * 60_000), ok: true, codes: [], text: "" },
      { at: new Date(now.getTime() - 20 * 60_000), ...fail }, { at: new Date(now.getTime() - 5 * 60_000), ...fail }] }), settings).has("HEALTH")).toBe(false);
    expect(serverProblems(snapshot({ monitor: [{ at: new Date(now.getTime() - 3 * HOUR), ok: true, codes: [], text: "" }] }), settings)
      .get("HEALTH")).toContain("inte rapporterat");
    expect(serverProblems(snapshot({ monitor: null, backups: null, disk: null, memory: null }), settings).size).toBe(0);
  });
});

describe("larmen: högst ett per sort och dygn, och löst", () => {
  const disk = new Map<AlertKind, string>([["DISK", "Disken är 85 % full"]]);
  const none = new Map<AlertKind, string>();
  const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
  const run = (states: Map<AlertKind, NoticeState>, problems: Map<AlertKind, string>, time: Date) => evaluateAlerts(states, problems, time);

  it("larmar direkt, inte igen samma dygn, påminner efter ett dygn och säger löst en gång", () => {
    let result = run(new Map(), disk, at(0));
    expect(result.messages).toEqual([{ kind: "DISK", status: "ALERT", detail: "Disken är 85 % full", since: at(0) }]);
    result = run(result.states, disk, at(1));
    expect(result.messages).toEqual([]);
    result = run(result.states, disk, at(23.9));
    expect(result.messages).toEqual([]);
    result = run(result.states, disk, at(24));
    expect(result.messages).toEqual([{ kind: "DISK", status: "ALERT", detail: "Disken är 85 % full", since: at(0) }]);
    result = run(result.states, none, at(25));
    expect(result.messages).toEqual([{ kind: "DISK", status: "RESOLVED", detail: "Disken är 85 % full", since: at(0) }]);
    result = run(result.states, none, at(26));
    expect(result.messages).toEqual([]);
  });

  it("ett problem som kommer tillbaka samma dygn larmar inte och ger inget löst; efter ett dygn larmar det", () => {
    let result = run(new Map(), disk, at(0));
    result = run(result.states, none, at(1));
    expect(result.messages.map(message => message.status)).toEqual(["RESOLVED"]);
    result = run(result.states, disk, at(2));
    expect(result.messages).toEqual([]);
    expect(result.states.get("DISK")).toMatchObject({ activeSince: at(2), alerted: false });
    result = run(result.states, none, at(3));
    expect(result.messages).toEqual([]);
    result = run(result.states, disk, at(10));
    result = run(result.states, disk, at(24));
    expect(result.messages).toEqual([{ kind: "DISK", status: "ALERT", detail: "Disken är 85 % full", since: at(10) }]);
  });

  it("sorterna räknas var för sig", () => {
    let result = run(new Map(), disk, at(0));
    result = run(result.states, new Map([...disk, ["BACKUP", "Ingen dump"]]), at(1));
    expect(result.messages).toEqual([{ kind: "BACKUP", status: "ALERT", detail: "Ingen dump", since: at(1) }]);
    expect(result.states.get("MEMORY")).toEqual(EMPTY_NOTICE);
  });

  it("mejlet säger larm, fortfarande och löst och hur det stängs av", () => {
    const mail = alertMessage([{ kind: "DISK", status: "ALERT", detail: "Disken är 85 % full", since: at(-30) },
      { kind: "BACKUP", status: "ALERT", detail: "Ingen dump", since: at(0) },
      { kind: "MEMORY", status: "RESOLVED", detail: "Bara 200 MB", since: at(-2) }], at(0), "otid.exempel.se");
    expect(mail.subject).toBe("O-Tid otid.exempel.se: larm – disken, säkerhetskopian");
    expect(mail.text).toContain("FORTFARANDE (disken, sedan");
    expect(mail.text).toContain("LARM (säkerhetskopian): Ingen dump");
    expect(mail.text).toContain("LÖST (minnet)");
    expect(mail.text).toContain("OTID_SERVER_ALERTS=off");
    expect(alertMessage([{ kind: "MEMORY", status: "RESOLVED", detail: "", since: at(-2) }], at(0), "x").subject).toBe("O-Tid x: löst – minnet");
  });
});

describe("veckorapportens tid", () => {
  const schedule = { day: 7, hour: 19 };
  it("senaste söndag kl. 19 svensk tid (vintertid och sommartid)", () => {
    expect(lastReportSlot(now, schedule).toISOString()).toBe("2026-11-08T18:00:00.000Z");
    expect(lastReportSlot(new Date("2026-11-08T17:59:00Z"), schedule).toISOString()).toBe("2026-11-01T18:00:00.000Z");
    expect(lastReportSlot(new Date("2026-07-01T12:00:00Z"), schedule).toISOString()).toBe("2026-06-28T17:00:00.000Z");
    expect(lastReportSlot(new Date("2026-11-10T12:00:00Z"), { day: 2, hour: 7 }).toISOString()).toBe("2026-11-10T06:00:00.000Z");
  });

  it("första gången bara en tidpunkt, sedan en gång per vecka även efter omstart", () => {
    expect(weeklyReportDue(null, now, schedule)).toBe("baseline");
    expect(weeklyReportDue(new Date("2026-11-04T10:00:00Z"), now, schedule)).toBe("due");
    expect(weeklyReportDue(new Date("2026-11-08T18:01:00Z"), now, schedule)).toBe("not-due");
    expect(weeklyReportDue(new Date("2026-11-08T18:01:00Z"), new Date("2026-11-12T10:00:00Z"), schedule)).toBe("not-due");
    expect(weeklyReportDue(new Date("2026-11-04T10:00:00Z"), now, null)).toBe("not-due");
    expect(isoWeek(now)).toBe(45);
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe(53);
  });
});

describe("prognosen och rapporten", () => {
  const samples = (growthPerDayBytes: number, free = 25 * GB): SampleRow[] => Array.from({ length: 8 }, (_, day) => ({
    at: new Date(now.getTime() - (7 - day) * 24 * HOUR), diskTotalBytes: 38 * GB, diskFreeBytes: free + (7 - day) * growthPerDayBytes,
    loadMax: day === 3 ? 1.7 : 0.3, loadMaxAt: new Date(now.getTime() - (7 - day) * 24 * HOUR), memoryTotalBytes: 4 * GB,
    memoryAvailableMinBytes: day === 5 ? 800 * MB : 2 * GB }));

  it("tillväxt per vecka och veckor till full disk", () => {
    const forecast = diskForecast(samples(GB / 7), now)!;
    expect(forecast.growthPerWeekBytes / GB).toBeCloseTo(1, 5);
    expect(forecast.weeksToFull).toBeCloseTo(25, 5);
    expect(diskForecast(samples(GB).slice(-2), now)).toBeNull();
    expect(diskForecast(samples(0), now)!.weeksToFull).toBeNull();
  });

  it("rapporten har disk, prognos, databasens delar, backup, antal, larm och belastning, utan personuppgifter", () => {
    const report = weeklyReport(snapshot(), { samples: samples(GB / 7), log: [
      { kind: "DISK", status: "ALERT", detail: "Disken är 85 % full", sentAt: new Date(now.getTime() - 2 * 24 * HOUR) },
      { kind: "DISK", status: "RESOLVED", detail: null, sentAt: new Date(now.getTime() - 24 * HOUR) },
      { kind: "WEEKLY_REPORT", status: "REPORT", detail: null, sentAt: new Date(now.getTime() - 7 * 24 * HOUR + 60_000) }] },
    settings, "otid.exempel.se");
    expect(report.subject).toBe("O-Tid otid.exempel.se: veckorapport vecka 45 (disken 34 %)");
    const text = report.text;
    expect(text).toContain("13 GB använt av 38 GB (34 %), 25 GB ledigt");
    expect(text).toContain("full om ungefär 25 veckor");
    expect(text).toContain("Kartorna tar 2 GB av kvoten 20 GB");
    expect(text).toContain("Kvoten ryms inte på disken");
    expect(text).toContain("kartfiler, kartbilder, banfiler och GPS-rutter: 2 GB");
    expect(text).toContain("Totalt 6 GB: 34 dumpar 4 GB, kartinnehåll 2 GB");
    expect(text).toContain("85 konton (3 nya senaste veckan), 12 klubbar");
    expect(text).toContain("Kommande 14 dagar: 6 tävlingar (4 publicerade), 900 anmälda, störst 320 anmälda");
    expect(text).toContain("larm (disken): Disken är 85 % full");
    expect(text).toContain("löst (disken)");
    expect(text).toContain("Hälsokontrollen: 1 kontroller, 0 misslyckade");
    expect(text).toContain("Högsta belastning (1 min): 1,7");
    expect(text).toContain("Minst ledigt minne: 800 MB av 4 GB");
    expect(text).not.toMatch(/@/);
  });

  it("utan mätningar säger rapporten det och att katalogerna inte syns", () => {
    const text = weeklyReport(snapshot({ backups: null, monitor: null }), { samples: [], log: [] }, settings, "x").text;
    expect(text).toContain("för få mätningar ännu");
    expect(text).toContain("Katalogen backups syns inte");
    expect(text).toContain("- Inga larm.");
    expect(text).toContain("Inga mätningar av belastningen ännu");
  });

  it("en disk som knappt växer behöver ingen större disk", () => {
    expect(weeklyReport(snapshot(), { samples: samples(MB), log: [] }, settings, "x").text).toContain("disken växer knappt");
  });
});

describe("hälsokontrollens fil", () => {
  it("läser raderna från monitor.sh och hoppar över trasiga", () => {
    const checks = parseMonitorLog("1762624800\tok\t\tHälsokontroll ok\n1762625700\tfail\tpublic,disk\tpublikens instans svarar inte\ntrasig\n\n");
    expect(checks).toEqual([
      { at: new Date(1762624800_000), ok: true, codes: [], text: "Hälsokontroll ok" },
      { at: new Date(1762625700_000), ok: false, codes: ["public", "disk"], text: "publikens instans svarar inte" }
    ]);
  });
});
