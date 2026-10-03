import { expect, it } from "vitest";
import { reportedStartAt, type AppliedStartObservation } from "../src";

it("TASK061 preserves the start episode, resets on correction and rejects incomplete history", () => {
  const first = "2026-09-12T10:00:00.000Z", later = "2026-09-12T10:20:00.000Z";
  const rows: AppliedStartObservation[] = [{ revision: 1, state: "STARTED", observedAt: first },
    { revision: 2, state: "STARTED", observedAt: later }];
  expect(reportedStartAt({ revision: 0, state: "UNMARKED" }, [])).toBeNull();
  expect(reportedStartAt({ revision: 2, state: "STARTED" }, [...rows].reverse())).toBe(first);
  rows.push({ revision: 3, state: "UNMARKED", observedAt: later });
  expect(reportedStartAt({ revision: 3, state: "UNMARKED" }, rows)).toBeNull();
  rows.push({ revision: 4, state: "STARTED", observedAt: later });
  expect(reportedStartAt({ revision: 4, state: "STARTED" }, rows)).toBe(later);
  expect(() => reportedStartAt({ revision: 4, state: "STARTED" }, rows.slice(1))).toThrow();
  expect(() => reportedStartAt({ revision: 2, state: "STARTED" }, [rows[0]!, rows[0]!])).toThrow();
  expect(() => reportedStartAt({ revision: 4, state: "UNMARKED" }, rows)).toThrow();
});
