import { describe, expect, it } from "vitest";
import { parseGpsStatus, type GpsStatus } from "../src/gps-plugin";
import { describeStatus } from "../ui/status-view";

const id = "11111111-1111-4111-8111-111111111111";
const stopped = {
  state: "STOPPED", recordingId: id, pointCount: 2,
  lastMeasuredAtMs: 1_800_000_000_000, hash: "a".repeat(64)
};

describe("deltagarens lokala GPS-status", () => {
  it("godtar en fryst version och visar att den fortfarande är osynkad", () => {
    const status = parseGpsStatus(stopped);
    expect(describeStatus(status)).toMatchObject({ tone: "neutral", canStart: true, canResume: false, canStop: false });
    expect(describeStatus(status).detail).toContain("inte synkad");
  });

  it("kallar aldrig en väntande start för pågående inspelning", () => {
    const starting = parseGpsStatus({ state: "STARTING", recordingId: null, pointCount: 0,
      lastMeasuredAtMs: null, hash: null });
    expect(describeStatus(starting)).toMatchObject({ tone: "warning", canStart: false, canStop: false });
    expect(describeStatus(starting).title).toContain("Startar");
  });

  it("visar avbrott som lucka med uttrycklig fortsättning eller stopp", () => {
    const status: GpsStatus = { state: "INTERRUPTED", recordingId: id, pointCount: 1,
      lastMeasuredAtMs: 1_800_000_000_000, hash: null };
    expect(describeStatus(status)).toMatchObject({ tone: "error", canResume: true, canStop: true });
    expect(describeStatus(status).detail).toContain("lucka");
  });

  it("avvisar svar som påstår stopp utan fryst hash eller punkter utan mättid", () => {
    expect(() => parseGpsStatus({ ...stopped, hash: null })).toThrow();
    expect(() => parseGpsStatus({ ...stopped, lastMeasuredAtMs: null })).toThrow();
  });

  it("avvisar okänd status, extra fält och ogiltig lokal identitet", () => {
    expect(() => parseGpsStatus({ ...stopped, state: "SYNCED" })).toThrow();
    expect(() => parseGpsStatus({ ...stopped, secret: "do-not-expose" })).toThrow();
    expect(() => parseGpsStatus({ ...stopped, recordingId: "not-a-uuid" })).toThrow();
  });
});
