import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  eventAccountInvitationIssues,
  eventAccountInvitationRevocations
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0083_task_160_owner_account_invitation.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK160 event scoped account invitation schema", () => {
  it("models immutable issue and revocation request journals", () => {
    expect(eventAccountInvitationIssues.requestId.name).toBe("request_id");
    expect(eventAccountInvitationIssues.invitationId.name).toBe("invitation_id");
    expect(eventAccountInvitationIssues.eventId.name).toBe("event_id");
    expect(eventAccountInvitationIssues.actorAccountId.name).toBe("actor_account_id");
    expect(eventAccountInvitationIssues.createdAt.name).toBe("created_at");
    expect(eventAccountInvitationRevocations.requestId.name).toBe("request_id");
    expect(eventAccountInvitationRevocations.revocationId.name).toBe("revocation_id");
    expect(eventAccountInvitationRevocations.invitationId.name).toBe("invitation_id");
    expect(eventAccountInvitationRevocations.eventId.name).toBe("event_id");
    expect(eventAccountInvitationRevocations.actorAccountId.name).toBe("actor_account_id");
    expect(eventAccountInvitationRevocations.reason.name).toBe("reason");
    expect(eventAccountInvitationRevocations.createdAt.name).toBe("created_at");
  });

  it("binds revocation to its A3a revocation and same event invitation", () => {
    expect(migration).toContain("FOREIGN KEY(invitation_id, event_id)");
    expect(migration).toContain("REFERENCES event_account_invitation_issue(invitation_id, event_id)");
    expect(migration).toContain("FROM account_invitation_revocation WHERE id = NEW.revocation_id");
    expect(migration).toContain("revoked_invitation_id IS DISTINCT FROM NEW.invitation_id");
    expect(migration.match(/REFERENCES user_account\(id\)/g)).toHaveLength(2);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(2);
  });

  it("registers migration 0083 and documents rollback/restore", () => {
    expect(journal.entries?.find((entry) => entry.idx === 83)).toMatchObject({
      idx: 83,
      tag: "0083_task_160_owner_account_invitation"
    });
    expect(migration).toContain("disable TASK160 OWNER issue/list/revoke routes");
    expect(migration).toContain("do not drop history");
  });
});
