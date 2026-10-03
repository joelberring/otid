import { describe, expect, it } from "vitest";
import type { StartListAdminListResponse, StartListPublicationContent } from "@o-tid/contracts";
import { filterPublishedStartListClasses, filterStartListClasses } from "./start-list-filter";

const classes: StartListAdminListResponse["classes"] = [
  { id: "fixed", name: "D21", startRule: "FIXED", entries: [
    { id: "first", displayName: "Åsa Exempel", organisationName: "Testklubben", fixedStartTime: null,
      cardNumber: "123456", multipleActiveAssignments: false },
    { id: "second", displayName: "Bo Exempel", organisationName: null, fixedStartTime: null,
      cardNumber: null, multipleActiveAssignments: true }
  ] },
  { id: "punch", name: "Öppen", startRule: "PUNCH", entries: [
    { id: "third", displayName: "Cecilia Exempel", organisationName: "Testklubben", fixedStartTime: null,
      cardNumber: "987654", multipleActiveAssignments: false }
  ] }
];
const ids = (classId: string, query: string) => filterStartListClasses(classes, classId, query)
  .flatMap(row => row.entries.map(entry => entry.id));

describe("start list presentation filter", () => {
  it("preserves server order and input for empty/whitespace search", () => {
    const original = structuredClone(classes);
    expect(ids("", "  ")).toEqual(["first", "second", "third"]);
    expect(classes).toEqual(original);
  });
  it("normalizes Unicode and case without removing Swedish diacritics", () => {
    expect(ids("", " A\u030aSA ")).toEqual(["first"]);
    expect(ids("", "Asa")).toEqual([]);
  });
  it("combines class selection with name, club or card substring", () => {
    expect(ids("", "testklubben")).toEqual(["first", "third"]);
    expect(ids("punch", "TESTKLUBBEN")).toEqual(["third"]);
    expect(ids("fixed", "3456")).toEqual(["first"]);
    expect(ids("punch", "3456")).toEqual([]);
  });
  it("does not invent a card match for missing or ambiguous assignments", () => {
    expect(ids("", "null")).toEqual([]);
    expect(ids("fixed", "Bo")).toEqual(["second"]);
    expect(ids("unknown", "")).toEqual([]);
  });
});

describe("published start list view filter", () => {
  const published: StartListPublicationContent["classes"] = [
    { name: "D21", startRule: "FIXED", entries: [
      { displayName: "Åsa Exempel", organisationName: "Testklubben", fixedStartTime: null },
      { displayName: "Bo Exempel", organisationName: null, fixedStartTime: null }
    ] },
    { name: "Öppen", startRule: "PUNCH", entries: [
      { displayName: "Cecilia Exempel", organisationName: "Testklubben", fixedStartTime: null }
    ] },
    { name: "H34", startRule: "PUNCH", entries: [] }
  ];
  it("keeps source order and empty classes without a query", () => {
    const original = structuredClone(published);
    expect(filterPublishedStartListClasses(published, "", "  ").map(row => [row.index, row.name, row.entries.length]))
      .toEqual([[0, "D21", 2], [1, "Öppen", 1], [2, "H34", 0]]);
    expect(published).toEqual(original);
  });
  it("combines class and Swedish Unicode name/club search without inventing private card fields", () => {
    expect(filterPublishedStartListClasses(published, "", " A\u030aSA ").map(row => row.entries[0]?.displayName))
      .toEqual(["Åsa Exempel"]);
    expect(filterPublishedStartListClasses(published, "", "Asa")).toEqual([]);
    expect(filterPublishedStartListClasses(published, "1", "TESTKLUBBEN").map(row => row.entries[0]?.displayName))
      .toEqual(["Cecilia Exempel"]);
    expect(filterPublishedStartListClasses(published, "0", "TESTKLUBBEN").map(row => row.entries[0]?.displayName))
      .toEqual(["Åsa Exempel"]);
  });
});
