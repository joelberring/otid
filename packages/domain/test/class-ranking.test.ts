import { describe, expect, it } from "vitest";
import {
  ClassRankingError,
  compareResultStatuses,
  RESULT_STATUS_ORDER,
  rankClassResults,
  type ClassRankingCandidate,
  type StoredResultStatus
} from "../src";

const courseOne = "00000000-0000-4000-8000-000000000001";
const courseTwo = "00000000-0000-4000-8000-000000000002";

function candidate(
  key: string,
  status: "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "NT" | "DNS",
  elapsedMs?: number,
  courseVersionId = courseOne
): ClassRankingCandidate {
  return {
    key,
    status,
    courseVersionId,
    ...(elapsedMs === undefined ? {} : { elapsedMs })
  };
}

describe("rankClassResults", () => {
  it("exponerar en gemensam fryst statusordning", () => {
    const statuses: StoredResultStatus[] = ["DNS", "NT", "OOC", "OK", "DNF", "DSQ", "MP"];
    expect(RESULT_STATUS_ORDER).toEqual({ OK: 0, MP: 1, DSQ: 2, DNF: 3, OOC: 4, NT: 5, DNS: 6 });
    expect(statuses.sort(compareResultStatuses))
      .toEqual(["OK", "MP", "DSQ", "DNF", "OOC", "NT", "DNS"]);
  });
  it("ger competition ranking och exakt tid efter för lika millisekunder", () => {
    expect(rankClassResults([
      candidate("fourth", "OK", 90_000),
      candidate("second", "OK", 72_000),
      candidate("first", "OK", 63_000),
      candidate("third", "OK", 72_000)
    ])).toEqual([
      { key: "first", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "second", rankingState: "RANKED", position: 2, timeBehindMs: 9_000 },
      { key: "third", rankingState: "RANKED", position: 2, timeBehindMs: 9_000 },
      { key: "fourth", rankingState: "RANKED", position: 4, timeBehindMs: 27_000 }
    ]);
  });

  it("låter delade vinnare behålla position ett och noll tid efter", () => {
    expect(rankClassResults([
      candidate("b", "OK", 60_000),
      candidate("a", "OK", 60_000),
      candidate("c", "OK", 75_000)
    ])).toEqual([
      { key: "a", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "b", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "c", rankingState: "RANKED", position: 3, timeBehindMs: 15_000 }
    ]);
  });

  it("lämnar MP orankad och sorterar den efter rankade resultat", () => {
    expect(rankClassResults([
      candidate("mp", "MP", 95_000),
      candidate("ok", "OK", 75_000)
    ])).toEqual([
      { key: "ok", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("lämnar DNS orankad utan att ändra OK-placering eller tid efter", () => {
    expect(rankClassResults([
      candidate("dns", "DNS"),
      candidate("second", "OK", 75_000),
      candidate("winner", "OK", 60_000),
      candidate("mp", "MP")
    ])).toEqual([
      { key: "winner", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "second", rankingState: "RANKED", position: 2, timeBehindMs: 15_000 },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dns", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("lämnar DSQ orankad och använder gemensam ordning OK, MP, DSQ, DNS", () => {
    expect(rankClassResults([
      candidate("dns", "DNS"),
      candidate("dsq", "DSQ", 55_000),
      candidate("mp", "MP", 50_000),
      candidate("ok", "OK", 60_000)
    ])).toEqual([
      { key: "ok", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dsq", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dns", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("lämnar DNF orankad mellan DSQ och DNS utan att påverka OK-rankingen", () => {
    expect(rankClassResults([
      candidate("dns", "DNS"),
      candidate("dnf", "DNF"),
      candidate("dsq", "DSQ"),
      candidate("winner", "OK", 60_000),
      candidate("mp", "MP")
    ])).toEqual([
      { key: "winner", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dsq", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dnf", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dns", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("lämnar OOC orankad med bevarad tid utan att påverka ranking eller mixed-course", () => {
    expect(rankClassResults([
      candidate("dns", "DNS"),
      candidate("ooc", "OOC", 45_000, courseTwo),
      candidate("dnf", "DNF"),
      candidate("winner", "OK", 60_000, courseOne),
      candidate("mp", "MP")
    ])).toEqual([
      { key: "winner", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dnf", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "ooc", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "dns", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("lämnar status-only NT orankad och utanför mixed-course-bedömningen", () => {
    expect(rankClassResults([
      candidate("nt", "NT", undefined, courseTwo),
      candidate("winner", "OK", 60_000, courseOne),
      candidate("mp", "MP")
    ])).toEqual([
      { key: "winner", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" },
      { key: "nt", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("undertrycker all OK-ranking när historiska banversioner är blandade", () => {
    expect(rankClassResults([
      candidate("ok-one", "OK", 60_000, courseOne),
      candidate("mp", "MP", 45_000, courseOne),
      candidate("ok-two", "OK", 45_000, courseTwo)
    ])).toEqual([
      { key: "ok-one", rankingState: "MIXED_COURSE_VERSIONS" },
      { key: "ok-two", rankingState: "MIXED_COURSE_VERSIONS" },
      { key: "mp", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("är permutationsdeterministisk utan att använda nyckeln som resultattiebreak", () => {
    const candidates = [
      candidate("tie-b", "OK", 70_000),
      candidate("mp", "MP"),
      candidate("winner", "OK", 60_000),
      candidate("tie-a", "OK", 70_000)
    ];
    const expected = rankClassResults(candidates);
    for (const order of [
      [...candidates].reverse(),
      [candidates[2]!, candidates[0]!, candidates[3]!, candidates[1]!]
    ]) {
      expect(rankClassResults(order)).toEqual(expected);
    }
    expect(expected.filter((result) => result.key.startsWith("tie")))
      .toEqual([
        { key: "tie-a", rankingState: "RANKED", position: 2, timeBehindMs: 10_000 },
        { key: "tie-b", rankingState: "RANKED", position: 2, timeBehindMs: 10_000 }
      ]);
  });

  it("validerar hela den historiska kandidatmängden fail closed", () => {
    const invalid = [
      { candidates: [candidate("", "OK", 1)], code: "INVALID_KEY" },
      { candidates: [candidate("same", "OK", 1), candidate("same", "MP")], code: "DUPLICATE_KEY" },
      { candidates: [{ ...candidate("unknown", "OK", 1), status: "OUT" }], code: "INVALID_STATUS" },
      { candidates: [{ ...candidate("course", "MP"), courseVersionId: "  " }], code: "INVALID_COURSE_VERSION" },
      { candidates: [candidate("negative", "MP", -1)], code: "INVALID_ELAPSED_TIME" },
      { candidates: [candidate("unsafe", "OK", Number.MAX_SAFE_INTEGER + 1)], code: "INVALID_ELAPSED_TIME" },
      { candidates: [candidate("missing", "OK")], code: "INVALID_ELAPSED_TIME" }
    ] as const;
    for (const example of invalid) {
      try {
        rankClassResults(example.candidates as readonly ClassRankingCandidate[]);
        throw new Error("Den ogiltiga rankingkandidaten skulle ha avvisats");
      } catch (error) {
        expect(error).toBeInstanceOf(ClassRankingError);
        if (error instanceof ClassRankingError) expect(error.code).toBe(example.code);
      }
    }
  });
});
