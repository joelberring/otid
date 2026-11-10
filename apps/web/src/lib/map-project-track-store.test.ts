import { describe, expect, it } from "vitest";
import { closeParts, type LocalTrack } from "./map-project-track-store";

const track = (parts: LocalTrack["parts"], open: LocalTrack["open"], sent: number): LocalTrack => ({ trackId: "t", projectId: "p", accountId: "a",
  name: "Spår", source: "FIELD", startedAt: "2026-11-10T08:00:00Z", parts, open, sent, created: true });

describe("spårets delar (översynen G3)", () => {
  it("stoppas inspelningen när allt redan är skickat blir sista punkten en egen del, så att slutet når servern", () => {
    const sentAll = track([[[0, 59, 18, 5], [1000, 59.001, 18, 5]]], [], 1);
    const ended = closeParts(sentAll, true);
    expect(ended.parts).toHaveLength(2);
    expect(ended.parts[1]).toEqual([[1000, 59.001, 18, 5]]);
    expect(ended.sent).toBeLessThan(ended.parts.length);
  });

  it("utan några delar alls händer inget", () => {
    expect(closeParts(track([], [], 0), true).parts).toEqual([]);
  });
});
