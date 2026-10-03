import { registerPlugin } from "@capacitor/core";
import type { StationPairingCredentialMetadata } from "@o-tid/contracts";

export interface InstallPackageRequest {
  envelopeJson: string;
  trustedPublicKeySpkiBase64: string;
}

export interface InstalledPackageMetadata {
  status: "installed" | "duplicate";
  raceId: string;
  packageVersion: number;
  payloadSha256: string;
  keyId: string;
}

export interface ActivePackageMetadata {
  raceId: string;
  packageVersion: number;
  payloadSha256: string;
  keyId: string;
}

export interface LoadedActivePackage extends ActivePackageMetadata {
  payloadJson: string;
}

export interface LatestLocalEvaluation {
  localEvaluationJson: string;
  evaluationHash: string;
}

export interface ServerAckObservation {
  observationHash: string;
  rawMessageId: string | null;
  acknowledgementStatus: "stored" | "duplicate" | "rejected";
  rejectionReason: string | null;
  currentPackageVersion: number;
  packageVersionStatus: "current" | "stale" | "ahead";
  packageUpdateRequired: boolean;
  serverResultJson: string | null;
  serverResultHash: string | null;
  evaluationHash: string | null;
  observedAtEpochMs: number;
}

export interface LatestEvaluationPair {
  deviceId: string;
  localSequence: number;
  raceId: string;
  packageVersion: number;
  contentHash: string;
  outboxState: "PENDING" | "ACKNOWLEDGED" | "REJECTED";
  rejectionReason: string | null;
  localEvaluation: LatestLocalEvaluation | null;
  serverObservation: ServerAckObservation | null;
}

export type StationCredentialMetadata = StationPairingCredentialMetadata;

export type StationCredentialStatus =
  | { state: "missing" | "invalid" }
  | { state: "active" | "expired"; credential: StationCredentialMetadata };

export interface StationPairingAttemptMetadata {
  attemptId: string;
  deviceId: string;
  startedAtEpochMs: number;
}

export type StationPairingStatus =
  | { state: "none" | "invalid" }
  | { state: "pending"; attempt: StationPairingAttemptMetadata }
  | { state: "completed"; attemptId: string; credential: StationCredentialMetadata };

export interface StationPairingRedeemResult {
  status: "installed" | "already-installed";
  credential: StationCredentialMetadata;
}

export type AuthorizedStationRequest =
  | {
      baseUrl: string;
      raceId: string;
      resource: "station-package";
      method: "GET";
      connectTimeoutMs: number;
      readTimeoutMs: number;
    }
  | {
      baseUrl: string;
      raceId: string;
      resource: "device-batches";
      method: "POST";
      bodyJson: string;
      idempotencyKey: string;
      connectTimeoutMs: number;
      readTimeoutMs: number;
    };

export interface AuthorizedStationResponse {
  status: number;
  headers: Record<string, string>;
  data: string;
  url: string;
}

export interface StationStoreStatus {
  deviceId: string;
  nextLocalSequence: number;
  activePackages: ActivePackageMetadata[];
  pendingCount: number;
  readoutCount: number;
  acknowledgedCount: number;
  rejectedCount: number;
  latestLocalEvaluation: LatestLocalEvaluation | null;
}

export interface EnqueueEventRequest {
  raceId: string;
  sessionId: string;
  packageVersion: number;
  stationReceivedAt: string;
  transport: "simulator";
  payloadJson: string;
  contentHash: string;
}

export interface StoredOutboxEvent extends EnqueueEventRequest {
  deviceId: string;
  localSequence: number;
}

export interface RecordedLocalEvaluation {
  status: "stored" | "duplicate";
  deviceId: string;
  localSequence: number;
  evaluationHash: string;
}

export interface StationStoreCapacitorPlugin {
  beginDevicePairing(request: { baseUrl: string; grantToken: string }): Promise<StationPairingStatus>;
  getDevicePairingStatus(): Promise<StationPairingStatus>;
  redeemDevicePairing(request: {
    attemptId: string;
    connectTimeoutMs: number;
    readTimeoutMs: number;
  }): Promise<StationPairingRedeemResult>;
  discardDevicePairing(request: { expectedAttemptId: string }): Promise<{ state: "none" }>;
  discardInvalidDevicePairing(request: { confirmDeviceId: string }): Promise<{ state: "none" }>;
  getDeviceCredentialStatus(): Promise<StationCredentialStatus>;
  authorizedStationRequest(request: AuthorizedStationRequest): Promise<AuthorizedStationResponse>;
  installPackage(request: InstallPackageRequest): Promise<InstalledPackageMetadata>;
  getStatus(): Promise<StationStoreStatus>;
  saveBaseUrl(request: { baseUrl: string }): Promise<{ baseUrl: string }>;
  loadBaseUrl(): Promise<{ baseUrl: string | null }>;
  loadLatestEvaluationPair(request: { raceId: string }): Promise<{ pair: LatestEvaluationPair | null }>;
  loadActivePackage(request: { raceId: string }): Promise<LoadedActivePackage>;
  enqueueEvent(request: EnqueueEventRequest): Promise<StoredOutboxEvent>;
  recordLocalEvaluation(request: {
    localEvaluationJson: string;
    evaluationHash: string;
  }): Promise<RecordedLocalEvaluation>;
  listPending(request: { limit: number }): Promise<{ events: StoredOutboxEvent[] }>;
  applyAcknowledgements(request: { acknowledgementJson: string }): Promise<{
    acknowledgedCount: number;
    rejectedCount: number;
    unchangedCount: number;
    pendingCount: number;
  }>;
}

export const OtidStationStore = registerPlugin<StationStoreCapacitorPlugin>("OtidStationStore");
