import { describe, expect, it } from "vitest";
import type { ClubArchiveCourseFileView } from "@o-tid/contracts";
import { preferredCourseFile } from "./club-archive-course-files";

const file = (kind: "PPEN" | "COURSE_DATA", fileName: string, names: string[]): ClubArchiveCourseFileView => ({ courseFileId: fileName, kind, fileName,
  byteLength: 1, courses: names.map(name => ({ name, controls: 8, lengthM: null })), scale: 10000, problem: null, mapReference: null,
  resolution: "FOLDER", mapVersion: null, courseData: null });

describe("användartestet 2026-11-12 (B): samma banor i två format", () => {
  it("väljer .ppen när filerna har samma banor, och frågar när de skiljer sig", () => {
    const ppen = file("PPEN", "Torsdagsträning.ppen", ["Medel", "Kort"]);
    expect(preferredCourseFile([file("COURSE_DATA", "Torsdagsträning IOF.xml", ["Kort", "Medel"]), ppen])).toBe(ppen);
    expect(preferredCourseFile([file("COURSE_DATA", "Torsdagsträning IOF.xml", ["Kort", "Medel", "Lång"]), ppen])).toBeUndefined();
    expect(preferredCourseFile([ppen])).toBeUndefined();
    expect(preferredCourseFile([file("COURSE_DATA", "a.xml", ["Kort"]), file("COURSE_DATA", "b.xml", ["Kort"])])).toBeUndefined();
  });
});
