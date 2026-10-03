import { expect, it } from "vitest";
import { consumeEntryNavigation, offerEntryNavigation } from "./entry-navigation";
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
it("delivers an immutable copy once to the matching race and destination", () => {
  const hint = { raceId, entryId, destination: "cards" as const };
  offerEntryNavigation(hint); hint.entryId = raceId;
  expect(consumeEntryNavigation(raceId, "cards")).toBe(entryId);
  expect(consumeEntryNavigation(raceId, "cards")).toBeUndefined();
});
it("discards mismatched race or destination rather than forwarding it later", () => {
  offerEntryNavigation({ raceId, entryId, destination: "cards" });
  expect(consumeEntryNavigation(entryId, "cards")).toBeUndefined();
  expect(consumeEntryNavigation(raceId, "cards")).toBeUndefined();
  offerEntryNavigation({ raceId, entryId, destination: "cards" });
  expect(consumeEntryNavigation(raceId, "start-times")).toBeUndefined();
});
it("rejects noncanonical ids and removes any older pending hint", () => {
  offerEntryNavigation({ raceId, entryId, destination: "cards" });
  offerEntryNavigation({ raceId, entryId: "not-an-entry", destination: "cards" });
  expect(consumeEntryNavigation(raceId, "cards")).toBeUndefined();
});
it("supports class navigation without accepting a card destination", () => {
  offerEntryNavigation({ raceId, entryId, destination: "classes" });
  expect(consumeEntryNavigation(raceId, "cards")).toBeUndefined();
  offerEntryNavigation({ raceId, entryId, destination: "classes" });
  expect(consumeEntryNavigation(raceId, "classes")).toBe(entryId);
  expect(consumeEntryNavigation(raceId, "classes")).toBeUndefined();
});
it("consumes history hints only for the history surface", () => {
  offerEntryNavigation({ raceId, entryId, destination: "history" });
  expect(consumeEntryNavigation(raceId, "history")).toBe(entryId);
  expect(consumeEntryNavigation(raceId, "history")).toBeUndefined();
});
it("consumes identity hints once and never forwards them to another surface", () => {
  offerEntryNavigation({ raceId, entryId, destination: "entry-identity" });
  expect(consumeEntryNavigation(raceId, "history")).toBeUndefined();
  offerEntryNavigation({ raceId, entryId, destination: "entry-identity" });
  expect(consumeEntryNavigation(raceId, "entry-identity")).toBe(entryId);
  expect(consumeEntryNavigation(raceId, "entry-identity")).toBeUndefined();
});
