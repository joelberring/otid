import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountInvitationIssues,
  accountInvitationRedemptions,
  accountInvitationRevocations,
  accountInvitationSubjects,
  accountInvitationThrottles
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0082_task_159_account_invitation.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK159 account invitation schema", () => {
  it("models normalized subject reservations and immutable invitation journals", () => {
    expect(accountInvitationSubjects.loginName.name).toBe("login_name");
    expect(accountInvitationSubjects.generation.name).toBe("generation");
    expect(accountInvitationIssues.requestId.name).toBe("request_id");
    expect(accountInvitationIssues.codeHash.name).toBe("code_hash");
    expect(accountInvitationIssues.loginName.name).toBe("login_name");
    expect(accountInvitationRevocations.invitationId.name).toBe("invitation_id");
    expect(accountInvitationRedemptions.accountId.name).toBe("account_id");
    expect(accountInvitationRedemptions.intentHash.name).toBe("intent_hash");
    expect(accountInvitationThrottles.loginKeyHash.name).toBe("login_key_hash");
    expect(migration).toContain("expires_at <= issued_at + interval '48 hours'");
    expect(migration).toContain("account_invitation_issue_code_hash_uidx");
    expect(migration).toContain("account_invitation_redemption_invitation_uidx");
    expect(migration).toContain("account_invitation_redemption_account_uidx");
  });

  it("advances subject generation from each journal and protects its identity", () => {
    expect(migration).toContain("NEW.generation <> OLD.generation + 1");
    expect(migration).toContain("NEW.login_name IS DISTINCT FROM OLD.login_name");
    expect(migration).toContain("account_invitation_issue_advance_subject");
    expect(migration).toContain("account_invitation_revocation_advance_subject");
    expect(migration).toContain("account_invitation_redemption_advance_subject");
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(3);
  });

  it("registers the additive migration and documents operational rollback", () => {
    expect(journal.entries?.find((entry) => entry.idx === 82)).toMatchObject({
      idx: 82,
      tag: "0082_task_159_account_invitation"
    });
    expect(migration).toContain("disable invitation issue and activation");
    expect(migration).toContain("Do not drop invitation journals or reservations");
  });
});
