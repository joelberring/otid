import { describe, expect, it } from "vitest";
import { formatPublicResultEvent, parsePublicResultUpdateNotification } from "./public-result-event-stream-wire";

const raceId = "10000000-0000-4000-8000-000000000001";
const raceIdWithLetter = "a0000000-0000-4000-8000-000000000001";

describe("TASK129 publikresultat-SSE-wire", () => {
  it("sänder bara versionsmärkt wake-up med ordnat id", () => {
    const value = new TextDecoder().decode(formatPublicResultEvent("refresh", "42"));
    expect(value).toBe('id: 42\nevent: refresh\ndata: {"formatVersion":1}\n\n');
    expect(value).not.toMatch(/entry|result|Ada|status/i);
  });

  it("avvisar okända, icke-canonical och för stora notifieringar", () => {
    expect(parsePublicResultUpdateNotification(`${raceId}:42`)).toEqual({ raceId, eventSequence: "42" });
    expect(parsePublicResultUpdateNotification(`${raceIdWithLetter.toUpperCase()}:42`)).toBeNull();
    expect(parsePublicResultUpdateNotification(`${raceId}:0`)).toBeNull();
    expect(parsePublicResultUpdateNotification(`${raceId}:${"9".repeat(20)}`)).toBeNull();
    expect(() => formatPublicResultEvent("refresh", "0")).toThrow();
  });
});
