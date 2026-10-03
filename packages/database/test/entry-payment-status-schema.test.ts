import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entries, entryPaymentStatusChanges, paymentStatusEnum } from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0075_task_142_entry_payment_status.sql", import.meta.url),
  "utf8"
);
const migrationsReadme = readFileSync(
  new URL("../migrations/README.md", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK142 database schema", () => {
  it("registers the additive private payment-status migration", () => {
    expect(journal.entries?.find(entry => entry.idx === 75)).toMatchObject({
      idx: 75, tag: "0075_task_142_entry_payment_status"
    });
    expect(paymentStatusEnum.enumValues).toEqual(["UNMARKED", "UNPAID", "PAID", "WAIVED"]);
    expect(entries.paymentStatus.name).toBe("payment_status");
    expect(entries.paymentStatusVersion.name).toBe("payment_status_version");
    expect(migration).toContain("DEFAULT 'UNMARKED'");
    expect(migration).toContain("DEFAULT 1");
    expect(migrationsReadme).toContain("0075_task_142_entry_payment_status.sql");
  });

  it("keeps a separate, immutable, race-scoped status journal", () => {
    expect(entryPaymentStatusChanges.previousPaymentStatus.name).toBe("previous_payment_status");
    expect(entryPaymentStatusChanges.paymentStatus.name).toBe("payment_status");
    expect(entryPaymentStatusChanges.entryVersionAtChange.name).toBe("entry_version_at_change");
    expect(entryPaymentStatusChanges.paymentStatusVersionBefore.name).toBe("payment_status_version_before");
    expect(entryPaymentStatusChanges.paymentStatusVersionAfter.name).toBe("payment_status_version_after");
    expect(migration).toContain("entry_payment_status_change_entry_version_uidx");
    expect(migration).toContain("entry_payment_status_change_capability_check");
    expect(migration).toContain("entry_payment_status_change_entry_scope_fk");
    expect(migration).toContain("entry_payment_status_change_immutable");
    expect(migration).toContain("EXECUTE FUNCTION reject_immutable_change()");
  });

  it("does not turn the migration into an economic transaction or rewrite historical results", () => {
    expect(migration).not.toMatch(/\bUPDATE\s+(?:entry|result_revision|race)\b/i);
    expect(migration).not.toMatch(/\bDROP\s+(?:COLUMN|TABLE|TYPE)\b/i);
    expect(migration).not.toMatch(/(?:amount|currency|swish|ocr|invoice|transaction)/i);
  });
});
