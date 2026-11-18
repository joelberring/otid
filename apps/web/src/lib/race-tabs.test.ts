import { describe, expect, it } from "vitest";
import { activeRaceNavKey, autoRaceMode, parseRaceMode, raceNavigation, raceNavPlacement, type RaceNavInput, type RaceMode } from "./race-tabs";

const ID = "1b0c5e2a-0000-4000-8000-000000000000";
const RACE = `/admin/${ID}`;
const admin = (raceType: RaceNavInput["raceType"], extra: Partial<RaceNavInput> = {}): RaceNavInput =>
  ({ raceId: ID, raceType, role: "ADMIN", courseSetting: "EDIT", ...extra });
const functionary = (raceType: RaceNavInput["raceType"], extra: Partial<RaceNavInput> = {}): RaceNavInput =>
  ({ raceId: ID, raceType, role: "FUNCTIONARY", ...extra });
const keys = (input: RaceNavInput, mode: RaceMode) => {
  const nav = raceNavigation(input, mode);
  return { tabs: nav.tabs.map(item => item.key), more: nav.more.map(item => item.key) };
};

describe("tävlingsraden", () => {
  it("tävling: Förbereda och Tävlingsdag enligt ägarens beslut, resten under Mer", () => {
    expect(keys(admin("STANDARD"), "PREPARE")).toEqual({ tabs: ["courses", "classes", "entries", "start"],
      more: ["publish", "secretariat", "results", "readout", "speaker", "courseSetting", "people", "settings"] });
    expect(keys(admin("STANDARD"), "RACE_DAY")).toEqual({ tabs: ["readout", "secretariat", "results", "speaker"],
      more: ["courses", "classes", "entries", "start", "publish", "courseSetting", "people", "settings"] });
    // Äldre gafflade tävlingar visas som Tävling.
    expect(keys(admin("FORKED"), "RACE_DAY").tabs).toEqual(["readout", "secretariat", "results", "speaker"]);
  });

  it("träning: tävlingsdagen utan speaker; Förbereda med träningens delar och Publicera", () => {
    expect(keys(admin("TRAINING"), "RACE_DAY").tabs).toEqual(["readout", "secretariat", "results"]);
    const prepare = raceNavigation(admin("TRAINING"), "PREPARE");
    expect(prepare.tabs.map(item => [item.key, item.label])).toEqual([["courses", "COURSES_CLASSES"], ["entries", "PARTICIPANTS"],
      ["publish", "PUBLISH"]]);
    // Övning i mobilen: inställningen under Mer; när en övning är på blir ledarens sida en flik på tävlingsdagen.
    expect(prepare.more.find(item => item.key === "exercise")?.href).toBe(`${RACE}/course-setting?flik=traning`);
    const bingo = raceNavigation(admin("TRAINING", { bingo: { enabled: true, mode: "SHIPS" } }), "RACE_DAY");
    expect(bingo.tabs.map(item => item.key)).toEqual(["readout", "secretariat", "results", "exercise"]);
    expect(bingo.tabs[3]).toMatchObject({ label: "SHIPS", href: `${RACE}/bingo` });
  });

  it("specialtyperna får bara sidor som finns", () => {
    expect(keys(admin("SMALL"), "RACE_DAY").tabs).toEqual(["readout", "secretariat", "results"]);
    expect(keys(admin("RELAY"), "RACE_DAY").tabs).toEqual(["readout", "secretariat", "results", "speaker"]);
    expect(raceNavigation(admin("RELAY"), "PREPARE").tabs.map(item => item.label)).toEqual(["COURSES", "CLASSES_LEGS", "TEAMS", "START"]);
    expect(raceNavigation(admin("ROGAINING"), "PREPARE").tabs.map(item => item.label)).toEqual(["CONTROLS_POINTS", "PARTICIPANTS", "PUBLISH"]);
    expect(keys(admin("ROGAINING"), "RACE_DAY").tabs).toEqual(["readout", "secretariat", "results"]);
    expect(keys(admin("PARTY"), "PREPARE")).toEqual({ tabs: ["party", "publish"], more: ["readout", "courseSetting", "people", "settings"] });
    const party = raceNavigation(admin("PARTY"), "RACE_DAY");
    expect(party.tabs.map(item => [item.key, item.label])).toEqual([["readout", "PARTY_DESK"], ["party", "PARTY"]]);
  });

  it("funktionären ser bara det rollen får använda", () => {
    const allowed = new Set(["start", "secretariat", "party", "readout", "speaker", "courseSetting"]);
    for (const type of ["TRAINING", "SMALL", "STANDARD", "RELAY", "ROGAINING", "PARTY"] as const) {
      for (const mode of ["PREPARE", "RACE_DAY"] as const) {
        const nav = raceNavigation(functionary(type), mode);
        for (const item of nav.all) expect(allowed.has(item.key), `${type} ${mode} ${item.key}`).toBe(true);
        expect(nav.all.some(item => item.key === "courseSetting")).toBe(false);
        expect(nav.tabs.length).toBeGreaterThan(0);
      }
    }
    expect(keys(functionary("STANDARD"), "RACE_DAY")).toEqual({ tabs: ["readout", "secretariat", "speaker"], more: ["start"] });
    expect(keys(functionary("STANDARD"), "PREPARE")).toEqual({ tabs: ["start"], more: ["secretariat", "readout", "speaker"] });
    // Träningen har inget Start: Förbereda visar tävlingsdagens flikar i stället för en rad med bara Mer.
    expect(keys(functionary("TRAINING"), "PREPARE").tabs).toEqual(["readout", "secretariat"]);
    // Banläggning bara med banläggningens behörighet, och då till rätt sida.
    expect(raceNavigation(functionary("STANDARD", { courseSetting: "MAP" }), "RACE_DAY").more.at(-1))
      .toMatchObject({ key: "courseSetting", label: "MAP_ERRORS", href: `${RACE}/course-setting/map-errors` });
    // Övningen kräver administratör.
    expect(raceNavigation(functionary("TRAINING", { bingo: { enabled: true, mode: "BINGO" } }), "RACE_DAY").all
      .some(item => item.key === "exercise")).toBe(false);
  });

  it("varje rad pekar på en befintlig sida i arbetsytan eller under arrangemanget", () => {
    for (const item of raceNavigation(admin("STANDARD"), "PREPARE").all) {
      expect(item.href).toMatch(new RegExp(`^${RACE}/(manage\\?del=[a-z]+|readout|speaker|course-setting)$`));
      if (item.section) expect(item.href).toContain("/manage?del=");
    }
    expect(raceNavigation(admin("STANDARD"), "RACE_DAY").tabs[1]).toMatchObject({ label: "SECRETARIAT", href: `${RACE}/manage?del=avlasning` });
  });

  it("placering och aktiv rad efter sidan", () => {
    expect(raceNavPlacement(`${RACE}/manage`)).toBe("workspace");
    expect(raceNavPlacement(`${RACE}/manage?del=banor`)).toBe("workspace");
    expect(raceNavPlacement(RACE)).toBe("workspace");
    expect(raceNavPlacement(`${RACE}/speaker`)).toBe("narrow");
    for (const page of ["maps", "imports", "bingo", "party-labels"]) expect(raceNavPlacement(`${RACE}/${page}`), page).toBe("page");
    for (const page of ["course-setting", "course-setting/print", "stations", "readout"]) expect(raceNavPlacement(`${RACE}/${page}`), page).toBe("none");
    expect(raceNavPlacement("/organizer")).toBe("none");
    expect(activeRaceNavKey(`${RACE}/manage`, "READOUT")).toBe("secretariat");
    expect(activeRaceNavKey(`${RACE}/manage`)).toBeUndefined();
    expect(activeRaceNavKey(`${RACE}/speaker`)).toBe("speaker");
    expect(activeRaceNavKey(`${RACE}/maps`)).toBe("start");
    expect(activeRaceNavKey(`${RACE}/imports`)).toBe("entries");
    expect(activeRaceNavKey(`${RACE}/bingo`)).toBe("exercise");
  });

  it("läget väljs efter tävlingsdygnet i arrangemangets tidszon (ADR-0178)", () => {
    const zone = "Europe/Stockholm";
    expect(autoRaceMode("2026-12-09", zone, new Date("2026-12-08T22:59:00Z"))).toBe("PREPARE");
    expect(autoRaceMode("2026-12-09", zone, new Date("2026-12-08T23:00:00Z"))).toBe("RACE_DAY");
    expect(autoRaceMode("2026-12-09", zone, new Date("2026-12-10T10:59:00Z"))).toBe("RACE_DAY");
    expect(autoRaceMode("2026-12-09", zone, new Date("2026-12-10T11:01:00Z"))).toBe("PREPARE");
    expect(parseRaceMode("RACE_DAY")).toBe("RACE_DAY");
    expect(parseRaceMode("x")).toBeUndefined();
    expect(parseRaceMode(null)).toBeUndefined();
  });
});
