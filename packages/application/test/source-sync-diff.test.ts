import { describe, expect, it } from "vitest";
import { diffCourseFile } from "../src/course-file-diff";
import { diffEventor } from "../src/eventor-sync-diff";
import type { CurrentEntry, CurrentState, EventorProjection } from "../src/source-sync-model";

const h21 = { id: "class-h21", name: "H21", externalSource: null, externalId: null, courseId: "course-1", courseVersionId: "v1",
  startRule: "PUNCH" as const, legCount: 0 };
const local = (values: Partial<CurrentEntry> & Pick<CurrentEntry, "id" | "givenName" | "familyName">): CurrentEntry => ({
  classId: h21.id, organisationName: "OK Skogsfalken", externalSource: null, externalId: null, teamId: null, relayLeg: null, version: 1,
  cardNumber: null, readOut: false, hasResult: false, didNotStart: false, ...values });
const state = (entries: CurrentEntry[]): CurrentState => ({ timeZone: "Europe/Stockholm", raceDate: "2026-10-18", classes: [h21], entries,
  teams: [], courses: [{ id: "course-1", name: "Bana 1", externalSource: null, externalId: null, versionId: "v1", version: 1,
    controlCodes: [31, 32], variants: [] }] });
const eventor = (entries: EventorProjection["entries"]): EventorProjection => ({ kind: "EVENTOR",
  event: { id: "1", name: "Test", date: "2026-10-18", clock: null, form: "INDIVIDUAL" },
  classes: [{ id: "90001", name: "H21", cancelled: false }], entries, teams: [] });
const person = (id: string, givenName: string, familyName: string, cardNumber: string | null = null) =>
  ({ id, classId: "90001", givenName, familyName, club: "OK Skogsfalken", cardNumber });

describe("skillnader mot Eventor", () => {
  it("länkar klass på namn och matchar deltagare från en tidigare fil på namn, klubb och klass", () => {
    const diff = diffEventor(eventor([person("1", "Åsa", "Ödman", "123")]),
      state([local({ id: "a", givenName: "Åsa", familyName: "Ödman", externalSource: "iof", externalId: "x" })]));
    expect(diff.links).toEqual([{ id: "class-h21", externalId: "90001" }]);
    expect(diff.rows.map(planned => [planned.row.kind, planned.row.matchedByName, planned.row.changes])).toEqual([
      ["CHANGED", true, [{ field: "CARD", from: null, to: "123" }]]]);
    expect(diff.rows[0]!.action).toMatchObject({ type: "UPDATE_ENTRY", entryId: "a", eventorId: "1", cardNumber: "123" });
  });

  it("rör aldrig en direktanmäld deltagare med samma namn", () => {
    const diff = diffEventor(eventor([person("1", "Åsa", "Ödman")]), state([local({ id: "a", givenName: "Åsa", familyName: "Ödman" })]));
    expect(diff.rows.map(planned => [planned.row.kind, planned.action.type])).toEqual([["NEW", "CREATE_ENTRY"]]);
  });

  it("visar en bricka som redan används som konflikt, men tillåter byte av brickor mellan två löpare", () => {
    const used = diffEventor(eventor([person("1", "Ny", "Löpare", "555")]),
      state([local({ id: "a", givenName: "Lokal", familyName: "Löpare", cardNumber: "555" })]));
    expect(used.rows.map(planned => [planned.row.kind, planned.row.note])).toEqual([["CONFLICT", "CARD_IN_USE"]]);
    const swap = diffEventor(eventor([person("1", "Ada", "A", "2"), person("2", "Bo", "B", "1")]), state([
      local({ id: "a", givenName: "Ada", familyName: "A", cardNumber: "1", externalSource: "eventor", externalId: "1" }),
      local({ id: "b", givenName: "Bo", familyName: "B", cardNumber: "2", externalSource: "eventor", externalId: "2" })]));
    expect(swap.rows.map(planned => planned.row.kind)).toEqual(["CHANGED", "CHANGED"]);
  });

  it("stryker inte tyst: avläst blir konflikt, redan struken visas inte", () => {
    const diff = diffEventor(eventor([]), state([
      local({ id: "a", givenName: "Läst", familyName: "Ut", externalSource: "eventor", externalId: "1", readOut: true, hasResult: true }),
      local({ id: "b", givenName: "Redan", familyName: "Struken", externalSource: "eventor", externalId: "2", hasResult: true, didNotStart: true }),
      local({ id: "c", givenName: "Ska", familyName: "Strykas", externalSource: "eventor", externalId: "3" })]));
    expect(diff.rows.map(planned => [planned.row.label, planned.row.kind, planned.row.note, planned.row.optional])).toEqual([
      ["Läst Ut", "CONFLICT", "WITHDRAWN_READ_OUT", false], ["Ska Strykas", "WITHDRAWN", null, true]]);
  });
});

describe("skillnader mot en banfil", () => {
  it("ger ny banversion för ändrade kontroller och visar banor som saknas i filen utan att ta bort dem", () => {
    const current = state([]);
    const withFileCourse = { ...current, courses: [...current.courses, { id: "course-2", name: "Bana 2", externalSource: "iof",
      externalId: "Bana 2", versionId: "v2", version: 1, controlCodes: [33], variants: [] }] };
    const diff = diffCourseFile({ kind: "COURSE_FILE", data: { courses: [{ externalId: "Bana 1", name: "Bana 1", controlCodes: [31, 39] }],
      assignments: [{ classExternalId: "H21", className: "H21", courseExternalId: "Bana 1", startRule: "PUNCH" }],
      personAssignments: [], teamAssignments: [], warnings: [] } }, withFileCourse, new Map([["class-h21", 2]]));
    expect(diff.links).toEqual([{ id: "course-1", externalId: "Bana 1" }]);
    expect(diff.rows.map(planned => [planned.row.kind, planned.row.label, planned.row.readOut, planned.row.note, planned.row.changes])).toEqual([
      ["CHANGED", "Bana 1", true, null, [{ field: "CONTROLS", from: "31 32", to: "31 39" }]],
      ["CONFLICT", "Bana 2", false, "NOT_IN_FILE", []]]);
    expect(diff.unchanged).toBe(1);
  });
});
