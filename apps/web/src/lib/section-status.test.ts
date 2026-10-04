import { describe, expect, it } from "vitest";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { checklistFacts, mispunchedEntries, sectionStatus, type SectionFacts } from "./section-status";
import { raceTypeProfile, visibleSections, type SectionId } from "./race-sections";

const steps: SectionId[] = ["COURSES", "CLASSES", "ENTRIES", "START", "READOUT", "RESULTS"];
const checklistStatus = (id: SectionId, facts: SectionFacts) => sectionStatus({ id, label: id }, facts, "STANDARD");

type Data = Pick<EntryTransferCandidates, "classes" | "entries">;
const raceClass = (id: string, courseName: string, startRule: "PUNCH" | "FIXED") =>
  ({ id, name: id, courseName, startRule }) as Data["classes"][number];
const entry = (id: string, classId: string, status?: "OK" | "MP" | "DNS", fixedStartTime: string | null = null) => ({
  id, classId, fixedStartTime,
  effectiveResult: status === undefined ? { state: "NO_PUBLISHED_RESULT", selectedRevision: null }
    : { state: "ACTIVE_RESULT", selectedRevision: { id, revision: 1 }, resultSnapshotVersion: 1,
      result: status === "OK" ? { revision: 1, status, reason: "COMPLETE", elapsedMs: 1 }
        : status === "MP" ? { revision: 1, status, reason: "MISSING_FINISH" } : { revision: 1, status, reason: "DID_NOT_START" } }
}) as unknown as Data["entries"][number];

const data: Data = {
  classes: [raceClass("H21", "Lång", "PUNCH"), raceClass("D21", "Kort", "PUNCH")],
  entries: [entry("a", "H21", "OK"), entry("b", "H21", "MP"), entry("c", "D21"), entry("d", "D21", "DNS"), entry("e", "D21")]
};

describe("status per del i sidopanelen", () => {
  it("visar status per steg i ord", () => {
    const facts = checklistFacts(data, { unknownCards: 1 });
    expect(steps.map(step => checklistStatus(step, facts))).toEqual([
      { tone: "DONE", text: "2 banor" },
      { tone: "DONE", text: "2 klasser" },
      { tone: "DONE", text: "5 anmälda" },
      { tone: "DONE", text: "Fri start" },
      { tone: "ATTENTION", text: "2 avlästa · 2 kvar · 1 okänd bricka" },
      { tone: "ATTENTION", text: "1 felstämplad att titta på" }
    ]);
    expect(mispunchedEntries(data).map(row => row.id)).toEqual(["b"]);
  });

  it("använder bantabellen och skogsrapporten när de är inlästa", () => {
    const facts = checklistFacts(data, { courseCount: 3, inForest: 1 });
    expect(checklistStatus("COURSES", facts).text).toBe("3 banor");
    expect(checklistStatus("READOUT", facts)).toEqual({ tone: "OPEN", text: "2 avlästa · 1 kvar" });
  });

  it("varnar för saknade starttider i klasser med minutstart", () => {
    const fixed: Data = { classes: [raceClass("H21", "Lång", "FIXED")],
      entries: [entry("a", "H21", undefined, "2026-10-08T16:00:00.000Z"), entry("b", "H21"), entry("c", "H21")] };
    expect(checklistStatus("START", checklistFacts(fixed, {}))).toEqual({ tone: "ATTENTION", text: "2 saknar starttid" });
    const done: Data = { classes: fixed.classes, entries: [entry("a", "H21", undefined, "2026-10-08T16:00:00.000Z")] };
    expect(checklistStatus("START", checklistFacts(done, {}))).toEqual({ tone: "DONE", text: "Starttider klara" });
  });

  it("visar en tom tävling som inte påbörjad", () => {
    const facts = checklistFacts({ classes: [], entries: [] }, {});
    expect(steps.map(step => checklistStatus(step, facts).tone)).toEqual(["OPEN", "OPEN", "OPEN", "OPEN", "OPEN", "OPEN"]);
    expect(checklistStatus("RESULTS", facts).text).toBe("Inga resultat ännu");
  });

  it("skriver antalet med delens namn för typen", () => {
    const facts = checklistFacts(data, {});
    const texts = (type: "TRAINING" | "RELAY") => visibleSections(raceTypeProfile(type)).map(section => sectionStatus(section, facts, type).text);
    expect(texts("TRAINING")).toEqual(["2 banor · 2 klasser", "5 deltagare", "2 avlästa · 2 kvar", "1 felstämplad att titta på", "Träning"]);
    expect(texts("RELAY")[2]).toBe("Inga lag ännu");
  });
});
