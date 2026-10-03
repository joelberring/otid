import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  participantEntryClaimIssues,
  participantEntryClaimRedemptions,
  participantEntryClaimRevocations
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0079_task_152_participant_entry_claim.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK152 participant entry claim schema", () => {
  it("models immutable issue, one-time redemption, and revocation journals", () => {
    expect(participantEntryClaimIssues.secretHash.name).toBe("secret_hash");
    expect(participantEntryClaimIssues.attestation.name).toBe("attestation");
    expect(participantEntryClaimRedemptions.claimId.name).toBe("claim_id");
    expect(participantEntryClaimRedemptions.accountId.name).toBe("account_id");
    expect(participantEntryClaimRevocations.actorCredentialId.name).toBe("actor_credential_id");
    expect(migration).toContain("participant_entry_claim_issue_entry_scope_fk");
    expect(migration).toContain("participant_entry_claim_issue_issuer_scope_fk");
    expect(migration).toContain("participant_entry_claim_revocation_actor_scope_fk");
    expect(migration).toContain("participant_entry_claim_redemption_claim_uidx");
    expect(migration).toContain("participant_entry_claim_revocation_claim_uidx");
    expect(migration).toContain("secret_hash ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("expires_at <= issued_at + interval '7 days'");
    expect(migration).toContain("attestation = 'IDENTITY_CHECKED'");
  });

  it("registers the additive migration and documents recovery without backfill", () => {
    expect(journal.entries?.find((entry) => entry.idx === 79)).toMatchObject({
      idx: 79,
      tag: "0079_task_152_participant_entry_claim"
    });
    expect(migration).toContain("Additive only: existing entries, accounts, results and history are untouched.");
    expect(migration).toContain("Forward repair or restore a verified full");
    expect(migration).toContain("plaintext codes cannot be recovered after restore");
  });

  it("installs immutable triggers on each lifecycle table", () => {
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(3);
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON participant_entry_claim_issue");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON participant_entry_claim_redemption");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON participant_entry_claim_revocation");
  });
});
