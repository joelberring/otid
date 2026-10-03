import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountPasswordRecoveryIssues,
  accountPasswordRecoveryRedemptions,
  accountPasswordRecoveryRevocations,
  accountPasswordRecoveryThrottles
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0084_task_161_account_password_recovery.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK161 account password recovery schema", () => {
  it("models hashed issues, one-time journals, and a persistent login throttle", () => {
    expect(accountPasswordRecoveryIssues.requestId.name).toBe("request_id");
    expect(accountPasswordRecoveryIssues.accountId.name).toBe("account_id");
    expect(accountPasswordRecoveryIssues.codeHash.name).toBe("code_hash");
    expect(accountPasswordRecoveryIssues.expectedPasswordVersion.name).toBe("expected_password_version");
    expect(accountPasswordRecoveryRevocations.recoveryId.name).toBe("recovery_id");
    expect(accountPasswordRecoveryRedemptions.passwordVersion.name).toBe("password_version");
    expect(accountPasswordRecoveryRedemptions.intentHash.name).toBe("intent_hash");
    expect(accountPasswordRecoveryThrottles.loginKeyHash.name).toBe("login_key_hash");
    expect(migration).toContain("expires_at <= issued_at + interval '24 hours'");
    expect(migration).toContain("account_password_recovery_issue_verifier_fk");
    expect(migration).toContain("account_password_recovery_redemption_issue_account_fk");
    expect(migration).toContain("account_password_recovery_redemption_verifier_fk");
    expect(migration).toContain("account_password_recovery_redemption_recovery_uidx");
  });

  it("guards pending, unexpired recovery and preserves immutable history", () => {
    expect(migration).toContain("Active password recovery already exists");
    expect(migration).toContain("Revoked recovery cannot be redeemed");
    expect(migration).toContain("Expired recovery cannot be redeemed");
    expect(migration).toContain("Recovery verifier version changed");
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(3);
  });

  it("registers additive migration and operational rollback guidance", () => {
    expect(journal.entries?.find((entry) => entry.idx === 84)).toMatchObject({
      idx: 84,
      tag: "0084_task_161_account_password_recovery"
    });
    expect(migration).toContain("disable recovery issue/revoke CLI");
    expect(migration).toContain("Do not drop recovery journals or verifier history");
  });
});
