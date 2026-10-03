import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userPublicResultFollowEvents } from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0080_task_153_account_public_result_follow.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK153 account public result follow schema", () => {
  it("models a sequenced account preference journal for the exact public target", () => {
    expect(userPublicResultFollowEvents.eventSequence.name).toBe("event_sequence");
    expect(userPublicResultFollowEvents.requestId.name).toBe("request_id");
    expect(userPublicResultFollowEvents.accountId.name).toBe("account_id");
    expect(userPublicResultFollowEvents.publicResultId.name).toBe("public_result_id");
    expect(userPublicResultFollowEvents.followed.name).toBe("followed");
    expect(migration).toContain("event_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY");
    expect(migration).toContain("FOREIGN KEY(race_id, public_result_id)");
    expect(migration).toContain("REFERENCES entry(race_id, public_result_id)");
    expect(migration).toContain("ON account_public_result_follow(request_id)");
    expect(migration).toContain("account_public_result_follow_account_latest_idx");
    expect(migration).toContain("account_public_result_follow_account_sequence_idx");
  });

  it("registers the additive migration without backfilling local favorites", () => {
    expect(journal.entries?.find((entry) => entry.idx === 80)).toMatchObject({
      idx: 80,
      tag: "0080_task_153_account_public_result_follow"
    });
    expect(migration).toContain("no local favorites or result history are imported or changed");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON account_public_result_follow");
  });

  it("protects the follow journal with the shared immutable trigger", () => {
    expect(migration).toContain("EXECUTE FUNCTION reject_immutable_change()");
  });
});
