import { expect, it } from "vitest";
import { canRefreshForest } from "./forest-auto-refresh";

it("TASK060 allows an idle visible report and pauses for every operator/session constraint", () => {
  const allowed = { enabled: true, authenticated: true, visible: true, reportOpen: true,
    busy: false, pending: false, journalOpen: false, editing: false };
  expect(canRefreshForest(allowed)).toBe(true);
  for (const key of ["enabled", "authenticated", "visible", "reportOpen"] as const) {
    expect(canRefreshForest({ ...allowed, [key]: false })).toBe(false);
  }
  for (const key of ["busy", "pending", "journalOpen", "editing"] as const) {
    expect(canRefreshForest({ ...allowed, [key]: true })).toBe(false);
  }
});
