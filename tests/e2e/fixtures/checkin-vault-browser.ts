import * as api from "../../../apps/web/src/lib/checkin-vault";
import { syncNextCheckinOperation } from "../../../apps/web/src/lib/checkin-vault-sync";
import { createCheckinRecoveryManifest } from "../../../apps/web/src/lib/checkin-recovery-manifest";
import type { StartCheckinDeviceRegistrationResponse, StartCheckinRosterResponse } from "@o-tid/contracts";

const handles = new Map<string, api.CheckinVault>();
function fixture(capability: "START_CHECKIN" | "FINISH_FOREST_WATCH" = "START_CHECKIN") {
  const vaultId = crypto.randomUUID(), entryId = crypto.randomUUID(), classId = crypto.randomUUID();
  const registration: StartCheckinDeviceRegistrationResponse = { formatVersion: 1, deviceId: crypto.randomUUID(), raceId: crypto.randomUUID(),
    actorCredentialId: crypto.randomUUID(), capability, label: "Syntetisk offlineenhet", registeredAt: "2026-09-05T10:00:00.000Z" };
  const roster: StartCheckinRosterResponse = { formatVersion: 1, raceId: registration.raceId, snapshotVersion: 1,
    timeZone: "Europe/Stockholm", generatedAt: "2026-09-05T10:00:00.000Z", knowledge: "LAST_SYNCED_ONLY",
    entries: [{ entryId, entryVersion: 1, classId, className: "Öppen", displayName: "Syntetisk Offlineperson", organisationName: "Provklubb",
      startRule: "PUNCH", fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false, revision: 0,
      startState: "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false,
      conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true }],
    devices: [{ deviceId: registration.deviceId, label: registration.label, capability, lastReceivedAt: null, lastSequence: 0 }] };
  return { vaultId, entryId, registration, roster, preparedAt: "2026-09-05T10:00:00.000Z", passphrase: "En separat syntetisk lokal lösenfras" };
}
const harness = { ...api, syncNextCheckinOperation, createCheckinRecoveryManifest, handles, fixture };
declare global { interface Window { checkinVaultTest: typeof harness } }
window.checkinVaultTest = harness;
