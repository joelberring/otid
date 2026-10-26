import { describe, expect, it, vi } from "vitest";
import { coalesceNotifications, formatPublicResultEvent, parsePublicResultUpdateNotification } from "./public-result-event-stream-wire";

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

  it("steg 51: samlar täta markörer per tävling till en väckning med den senaste", async () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const notify = coalesceNotifications(250, async (raceId, sequence) => { delivered.push(`${raceId.slice(0, 1)}:${sequence}`); });
    const a = "10000000-0000-4000-8000-000000000001", b = "20000000-0000-4000-8000-000000000002";
    for (let sequence = 1; sequence <= 300; sequence += 1) notify(a, String(sequence));
    notify(b, "301");
    notify(a, "5");
    expect(delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(delivered).toEqual(["1:300", "2:301"]);
    notify(a, "302");
    await vi.advanceTimersByTimeAsync(250);
    expect(delivered).toEqual(["1:300", "2:301", "1:302"]);
    vi.useRealTimers();
  });
});
