import { describe, expect, it } from "vitest";
import {
  DID_NOT_START_POLICY_VERSION,
  createDidNotStartResult
} from "../src";

describe("createDidNotStartResult", () => {
  it("skapar ett rent manuellt status-only-utslag", () => {
    expect(createDidNotStartResult({
      entryId: "10000000-0000-4000-8000-000000000001",
      classId: "20000000-0000-4000-8000-000000000002",
      courseVersionId: "30000000-0000-4000-8000-000000000003"
    })).toEqual({
      status: "DNS",
      reason: "DID_NOT_START",
      entryId: "10000000-0000-4000-8000-000000000001",
      classId: "20000000-0000-4000-8000-000000000002",
      courseVersionId: "30000000-0000-4000-8000-000000000003"
    });
    expect(DID_NOT_START_POLICY_VERSION).toBe("did-not-start-v1");
  });
});
