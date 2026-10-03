import { describe, expect, it } from "vitest";
import { parseCheckinRecoveryCliArguments, readCheckinRecoveryManifestInput } from "../src/checkin-recovery-cli-input";

const id = "00000000-0000-4000-8000-000000000001";
const manifest = { formatVersion: 1, kind: "OTID_CHECKIN_RECOVERY_MANIFEST", raceId: id, deviceId: id,
  actorCredentialId: id, capability: "START_CHECKIN", firstSequence: 1, lastSequence: 1,
  items: [{ requestId: id, localSequence: 1, contentHash: "a".repeat(64) }] };
async function* input(...chunks: Uint8Array[]) { yield* chunks; }
const issue = ["issue", "--operator-label", "Ansvarig", "--reason", "Utgången behörighet", "--expires-at", "2026-09-05T10:30:00.000Z"];

describe("private recovery CLI input", () => {
  it("accepts only explicit issue/revoke fields and canonical expiry", () => {
    expect(parseCheckinRecoveryCliArguments(issue)).toEqual({ command: "issue", operatorLabel: "Ansvarig", reason: "Utgången behörighet", expiresAt: new Date(issue[6]!) });
    expect(parseCheckinRecoveryCliArguments(["revoke", "--operator-label", "Ansvarig", "--reason", "Avbruten", "--grant-id", id])).toEqual({ command: "revoke", operatorLabel: "Ansvarig", reason: "Avbruten", grantId: id });
    for (const args of [[], [...issue, "--token", "secret"], [...issue, "--reason", "Extra"], issue.slice(0, -1),
      [...issue.slice(0, -1), "2026-09-05"], [...issue.slice(0, -1), "2026-02-30T10:30:00.000Z"],
      ["issue", "--operator-label", " ", ...issue.slice(3)]]) expect(() => parseCheckinRecoveryCliArguments(args)).toThrow("CHECKIN_RECOVERY_ARGUMENTS_INVALID");
  });

  it("reads exact validated manifest across arbitrary byte chunks", async () => {
    const bytes = Buffer.from(JSON.stringify(manifest));
    expect(await readCheckinRecoveryManifestInput(input(bytes.subarray(0, 3), bytes.subarray(3, 17), bytes.subarray(17)))).toEqual(manifest);
  });

  it("accepts the full 20,000-item exported queue within the byte bound", async () => {
    const full = { ...manifest, lastSequence: 20_000, items: Array.from({ length: 20_000 }, (_, index) => ({
      requestId: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      localSequence: index + 1, contentHash: "a".repeat(64)
    })) };
    expect((await readCheckinRecoveryManifestInput(input(Buffer.from(JSON.stringify(full))))).items).toHaveLength(20_000);
  });

  it("rejects oversized, malformed, non-UTF8 and extra private fields without leaking input", async () => {
    for (const bytes of [Buffer.alloc(4 * 1024 * 1024 + 1), Buffer.from("PRIVATE-NAME-INVALID"), Buffer.from([0xff]),
      Buffer.from(JSON.stringify({ ...manifest, name: "PRIVATE-NAME" }))]) {
      await expect(readCheckinRecoveryManifestInput(input(bytes))).rejects.toThrow(/^CHECKIN_RECOVERY_MANIFEST_INPUT_INVALID$/);
    }
    await expect(readCheckinRecoveryManifestInput(input())).rejects.toThrow("CHECKIN_RECOVERY_MANIFEST_INPUT_INVALID");
  });
});
