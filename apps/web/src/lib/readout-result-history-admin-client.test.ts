import { describe, expect, it } from "vitest";
import {
  parseReadoutHistoryDetail,
  parseReadoutHistoryList,
  readReadoutResultHistoryAdminCsrf
} from "./readout-result-history-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const readoutId = "20000000-0000-4000-8000-000000000002";
const instant = "2026-08-31T12:00:00.000Z";

describe("TASK 005N historyklient", () => {
  it("kräver strict expected-race-lista", () => {
    const response = { formatVersion: 1, raceId, items: [], nextCursor: null };
    expect(parseReadoutHistoryList(response, raceId)).toEqual(response);
    expect(() => parseReadoutHistoryList({ ...response, rawPayload: "CANARY" }, raceId)).toThrow();
    expect(() => parseReadoutHistoryList(response, readoutId)).toThrow();
  });
  it("binder detalj till route-readout", () => {
    const response = { formatVersion: 1, raceId,
      readout: { id: readoutId, cardNumber: "123", readAt: instant, startPunchedAt: null,
        finishPunchedAt: instant, punches: [] }, firstServerAssessment: null, entry: null,
      history: { upperRevision: 0, items: [], nextCursor: null } };
    expect(parseReadoutHistoryDetail(response, raceId, readoutId)).toEqual(response);
    expect(() => parseReadoutHistoryDetail(response, raceId, raceId)).toThrow();
  });
  it("läser endast history-CSRF för rätt miljö och avvisar dubbletter", () => {
    const csrf = "c".repeat(43);
    expect(readReadoutResultHistoryAdminCsrf(
      `__Host-otid-readout-result-history-csrf=${csrf}; __Host-otid-race-overview-csrf=${"o".repeat(43)}`,
      new URL("https://otid.example/admin")
    )).toBe(csrf);
    expect(() => readReadoutResultHistoryAdminCsrf(
      `__Host-otid-readout-result-history-csrf=${csrf}; __Host-otid-readout-result-history-csrf=${csrf}`,
      new URL("https://otid.example/admin")
    )).toThrow();
  });
});
