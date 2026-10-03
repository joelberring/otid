import { StartCheckinRecoveryManifestSchema, canonicalStartCheckinRecoveryManifest } from "@o-tid/contracts";
import { hashCheckinBytes } from "./checkin-vault-crypto";
import type { CheckinVault } from "./checkin-vault";

/** Private approval input, not a recovery authorization and not a clone/import of the queue. */
export async function createCheckinRecoveryManifest(vault: Pick<CheckinVault, "read">) {
  const snapshot = await vault.read();
  const { registration } = snapshot;
  const pending = snapshot.operations.filter((row) => row.receipt === null);
  if (pending.some(({ operation }) => operation.raceId !== registration.raceId ||
      operation.deviceId !== registration.deviceId || operation.actorCredentialId !== registration.actorCredentialId ||
      (registration.capability === "START_CHECKIN" ? operation.action.kind !== "MARK_START" : operation.action.kind !== "FINISH_CORRECTION"))) {
    throw new Error("Invalid recovery manifest scope");
  }
  const manifest = StartCheckinRecoveryManifestSchema.parse({ formatVersion: 1, kind: "OTID_CHECKIN_RECOVERY_MANIFEST",
    raceId: registration.raceId, deviceId: registration.deviceId, actorCredentialId: registration.actorCredentialId,
    capability: registration.capability, firstSequence: snapshot.lastReceiptSequence + 1, lastSequence: snapshot.nextSequence - 1,
    items: pending.map(({ operation, contentHash }) => ({ requestId: operation.requestId, localSequence: operation.localSequence, contentHash })) });
  const bytes = canonicalStartCheckinRecoveryManifest(manifest);
  return { snapshot, manifest, bytes, contentHash: await hashCheckinBytes(bytes) };
}
