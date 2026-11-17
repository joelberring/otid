import { describe, expect, it } from "vitest";
import type { OrganizerMyEventsResponse } from "@o-tid/contracts";
import { organizerEn } from "../i18n/organizer-en";
import { organizerSv } from "../i18n/organizer-sv";
import { courseSettingCandidates, createSubmitLabel, myClubHref, quickCourseName } from "./hub-start";

type MyEvent = OrganizerMyEventsResponse["events"][number];
type Race = MyEvent["races"][number];
const race = (raceId: string, raceDate: string, extra: Partial<Race> = {}): Race =>
  ({ raceId, raceName: "", raceDate, raceType: "TRAINING", ...extra });
const event = (eventId: string, role: MyEvent["role"], races: Race[], eventName = eventId): MyEvent =>
  ({ eventId, eventName, role, startsOn: races[0]!.raceDate, timeZone: "Europe/Stockholm", races });
// 2026-11-17 kl. 12 i Stockholm.
const now = new Date("2026-11-17T11:00:00Z");

describe("navet Mitt O-Tid (översynen 2026-11-17)", () => {
  it("Lägg banor: förvalt namn med dagens datum i Stockholms tid, också sent på kvällen i UTC", () => {
    expect(quickCourseName(now, organizerSv.quick.defaultName)).toBe("Banläggning 2026-11-17");
    expect(quickCourseName(new Date("2026-11-17T23:30:00Z"), organizerSv.quick.defaultName)).toBe("Banläggning 2026-11-18");
    expect(quickCourseName(now, organizerEn.quick.defaultName)).toBe("Course setting 2026-11-17");
  });

  it("Lägg banor erbjuder idag och kommande där kontot får lägga banor, närmast först, inte gångna eller bara kartfel", () => {
    const events = [
      event("sen", "OWNER", [race("r-sen", "2026-12-01")]),
      event("idag", "ADMIN", [race("r-idag", "2026-11-17", { raceName: "Kväll" })]),
      event("gammal", "OWNER", [race("r-gammal", "2026-11-10")]),
      event("funktionar", "FUNCTIONARY", [race("r-funk", "2026-11-18")]),
      event("banlaggare", "COURSE_SETTER", [race("r-bana", "2026-11-19", { courseSetting: "SUGGEST" })]),
      event("kartritare", "COURSE_SETTER", [race("r-karta", "2026-11-20", { courseSetting: "MAP" })])
    ];
    expect(courseSettingCandidates(events, now).map(row => row.raceId)).toEqual(["r-idag", "r-bana", "r-sen"]);
    expect(courseSettingCandidates(events, now)[0]).toEqual({ raceId: "r-idag", eventName: "idag", raceName: "Kväll", raceDate: "2026-11-17" });
    expect(courseSettingCandidates(events, now, 2)).toHaveLength(2);
    expect(courseSettingCandidates([], now)).toEqual([]);
  });

  it("knappen i formuläret följer typen: Skapa träning för Träning", () => {
    expect(createSubmitLabel("TRAINING", organizerSv.createSubmit)).toBe("Skapa träning");
    expect(createSubmitLabel("STANDARD", organizerSv.createSubmit)).toBe("Skapa tävling");
    expect(createSubmitLabel("FORKED", organizerSv.createSubmit)).toBe("Skapa tävling");
    expect(createSubmitLabel("RELAY", organizerSv.createSubmit)).toBe("Skapa stafett");
    expect(createSubmitLabel("TRAINING", organizerEn.createSubmit)).toBe("Create training");
  });

  it("Min klubb: en klubbyta öppnas direkt, annars remsans Mina klubbar", () => {
    expect(myClubHref([{ clubId: "a b" }])).toBe("/organizer/clubs/a%20b");
    expect(myClubHref([{ clubId: "a" }, { clubId: "b" }])).toBe("#mina-klubbar");
    expect(myClubHref([])).toBe("#mina-klubbar");
    expect(myClubHref(undefined)).toBe("#mina-klubbar");
  });
});
