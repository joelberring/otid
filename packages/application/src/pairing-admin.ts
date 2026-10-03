import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  didNotFinishAdminLoginRequestSchema,
  didNotFinishWithdrawalAdminLoginRequestSchema,
  outOfCompetitionAdminLoginRequestSchema,
  outOfCompetitionWithdrawalAdminLoginRequestSchema,
  withoutTimingAdminLoginRequestSchema,
  withoutTimingWithdrawalAdminLoginRequestSchema,
  didNotStartAdminLoginRequestSchema,
  didNotStartWithdrawalAdminLoginRequestSchema,
  entryClassAdminLoginRequestSchema,
  entryStartTimeAdminLoginRequestSchema,
  classStartDrawAdminLoginRequestSchema,
  entryCardAdminLoginRequestSchema,
  entryIdentityAdminLoginRequestSchema,
  entryRegistrationAdminLoginRequestSchema,
  iofResultListExportAdminLoginRequestSchema,
  iofImportLoginRequestSchema,
  pairingAdminGrantIssueRequestSchema,
  pairingAdminLoginRequestSchema,
  pmDocumentLoginRequestSchema,
  raceOverviewAdminLoginRequestSchema,
  raceAdministratorLoginRequestSchema,
  startListAdminLoginRequestSchema,
  speakerBoardLoginRequestSchema,
  startListPublicationAdminLoginRequestSchema,
  startCheckinAdminLoginRequestSchema,
  finishForestWatchAdminLoginRequestSchema,
  readoutResultHistoryAdminLoginRequestSchema,
  resultDisqualificationAdminLoginRequestSchema,
  resultDisqualificationWithdrawalAdminLoginRequestSchema,
  resultApprovalAdminLoginRequestSchema,
  resultApprovalWithdrawalAdminLoginRequestSchema,
  resultFinalizationAdminLoginRequestSchema,
  resultRecalculationAdminLoginRequestSchema,
  type PairingAdminGrantIssueResponse,
  type PairingAdminGrantListResponse,
  type PairingAdminGrantMetadata,
  type PairingAdminGrantRevokeResponse,
  type DidNotFinishAdminLoginRequest,
  type DidNotFinishWithdrawalAdminLoginRequest,
  type OutOfCompetitionAdminLoginRequest,
  type OutOfCompetitionWithdrawalAdminLoginRequest,
  type WithoutTimingAdminLoginRequest,
  type WithoutTimingWithdrawalAdminLoginRequest,
  type DidNotStartAdminLoginRequest,
  type DidNotStartWithdrawalAdminLoginRequest,
  type EntryClassAdminLoginRequest,
  type EntryStartTimeAdminLoginRequest,
  type EntryCardAdminLoginRequest,
  type EntryRegistrationAdminLoginRequest,
  type IofResultListExportAdminLoginRequest,
  type IofImportLoginRequest,
  type PairingAdminLoginRequest,
  type PmDocumentLoginRequest,
  type RaceOverviewAdminLoginRequest,
  type StartListAdminLoginRequest,
  type SpeakerBoardLoginRequest,
  type StartListPublicationAdminLoginRequest,
  type StartCheckinAdminLoginRequest,
  type FinishForestWatchAdminLoginRequest,
  type ReadoutResultHistoryAdminLoginRequest,
  type ResultDisqualificationAdminLoginRequest,
  type ResultDisqualificationWithdrawalAdminLoginRequest,
  type ResultApprovalAdminLoginRequest,
  type ResultApprovalWithdrawalAdminLoginRequest,
  type ResultFinalizationAdminLoginRequest,
  type ResultRecalculationAdminLoginRequest
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { raceAdministratorAllowsAction } from "./race-administrator-policy";
import { activeUserAccountParentSession } from "./user-account";

type ClassStartDrawAdminLoginRequest = { formatVersion: 1; accessCredential: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SESSION_PREFIX = "otid_org_session_v1";
const GRANT_LIFETIME_MS = 10 * 60 * 1000;
const DUMMY_HASH = Buffer.from("0e0c2fb493e4475d4ee4055cc5cb7c8229399d72a775ae5c346b57466b72d081", "hex");

export type RaceAdminCapability =
  | "MANAGE_RACE"
  | "PAIR_STATION"
  | "IMPORT_IOF"
  | "CHANGE_ENTRY_CLASS"
  | "CHANGE_ENTRY_START_TIME"
  | "DRAW_CLASS_START_TIMES"
  | "CHANGE_ENTRY_CARD"
  | "CHANGE_ENTRY_IDENTITY"
  | "REGISTER_ENTRY"
  | "RECALCULATE_RESULT"
  | "VIEW_RACE_OVERVIEW"
  | "VIEW_START_LIST"
  | "VIEW_SPEAKER_BOARD"
  | "MANAGE_PM_DOCUMENT"
  | "START_CHECKIN"
  | "FINISH_FOREST_WATCH"
  | "PUBLISH_START_LIST"
  | "VIEW_READOUT_RESULT_HISTORY"
  | "EXPORT_IOF_RESULT_LIST"
  | "FINALIZE_RESULTS"
  | "DECIDE_DID_NOT_START"
  | "WITHDRAW_DID_NOT_START"
  | "DISQUALIFY_RESULT"
  | "WITHDRAW_DISQUALIFICATION"
  | "APPROVE_RESULT"
  | "WITHDRAW_RESULT_APPROVAL"
  | "DECIDE_DID_NOT_FINISH"
  | "WITHDRAW_DID_NOT_FINISH"
  | "DECIDE_OUT_OF_COMPETITION"
  | "WITHDRAW_OUT_OF_COMPETITION"
  | "DECIDE_WITHOUT_TIMING"
  | "WITHDRAW_WITHOUT_TIMING";

const CAPABILITY_POLICY = {
  MANAGE_RACE: {
    accessPrefix: "otid_org_race_admin_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: raceAdministratorLoginRequestSchema,
    auditEntityType: "race_administrator_access_credential",
    issueAuditAction: "RACE_ADMIN_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RACE_ADMIN_ACCESS_CREDENTIAL_REVOKED"
  },
  PAIR_STATION: {
    accessPrefix: "otid_org_pair_v1",
    maxAccessLifetimeMs: 24 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 8 * 60 * 60 * 1000,
    loginRequestSchema: pairingAdminLoginRequestSchema,
    auditEntityType: "pairing_admin_access_credential",
    issueAuditAction: "PAIRING_ADMIN_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "PAIRING_ADMIN_ACCESS_CREDENTIAL_REVOKED"
  },
  IMPORT_IOF: {
    accessPrefix: "otid_org_import_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: iofImportLoginRequestSchema,
    auditEntityType: "iof_import_access_credential",
    issueAuditAction: "IOF_IMPORT_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "IOF_IMPORT_ACCESS_CREDENTIAL_REVOKED"
  },
  CHANGE_ENTRY_CLASS: {
    accessPrefix: "otid_org_entry_class_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: entryClassAdminLoginRequestSchema,
    auditEntityType: "entry_class_access_credential",
    issueAuditAction: "ENTRY_CLASS_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "ENTRY_CLASS_ACCESS_CREDENTIAL_REVOKED"
  },
  CHANGE_ENTRY_START_TIME: {
    accessPrefix: "otid_org_entry_start_time_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: entryStartTimeAdminLoginRequestSchema,
    auditEntityType: "entry_start_time_access_credential",
    issueAuditAction: "ENTRY_START_TIME_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "ENTRY_START_TIME_ACCESS_CREDENTIAL_REVOKED"
  },
  DRAW_CLASS_START_TIMES: {
    accessPrefix: "otid_org_class_start_draw_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: classStartDrawAdminLoginRequestSchema,
    auditEntityType: "class_start_draw_access_credential",
    issueAuditAction: "CLASS_START_DRAW_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "CLASS_START_DRAW_ACCESS_CREDENTIAL_REVOKED"
  },
  CHANGE_ENTRY_CARD: {
    accessPrefix: "otid_org_entry_card_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: entryCardAdminLoginRequestSchema,
    auditEntityType: "entry_card_access_credential",
    issueAuditAction: "ENTRY_CARD_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "ENTRY_CARD_ACCESS_CREDENTIAL_REVOKED"
  },
  CHANGE_ENTRY_IDENTITY: {
    accessPrefix: "otid_org_entry_identity_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: entryIdentityAdminLoginRequestSchema,
    auditEntityType: "entry_identity_access_credential",
    issueAuditAction: "ENTRY_IDENTITY_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "ENTRY_IDENTITY_ACCESS_CREDENTIAL_REVOKED"
  },
  REGISTER_ENTRY: {
    accessPrefix: "otid_org_entry_registration_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: entryRegistrationAdminLoginRequestSchema,
    auditEntityType: "entry_registration_access_credential",
    issueAuditAction: "ENTRY_REGISTRATION_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "ENTRY_REGISTRATION_ACCESS_CREDENTIAL_REVOKED"
  },
  RECALCULATE_RESULT: {
    accessPrefix: "otid_org_result_recalc_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: resultRecalculationAdminLoginRequestSchema,
    auditEntityType: "result_recalculation_access_credential",
    issueAuditAction: "RESULT_RECALCULATION_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RESULT_RECALCULATION_ACCESS_CREDENTIAL_REVOKED"
  },
  VIEW_RACE_OVERVIEW: {
    accessPrefix: "otid_org_race_overview_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: raceOverviewAdminLoginRequestSchema,
    auditEntityType: "race_overview_access_credential",
    issueAuditAction: "RACE_OVERVIEW_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RACE_OVERVIEW_ACCESS_CREDENTIAL_REVOKED"
  },
  VIEW_START_LIST: {
    accessPrefix: "otid_org_start_list_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: startListAdminLoginRequestSchema,
    auditEntityType: "start_list_access_credential",
    issueAuditAction: "START_LIST_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "START_LIST_ACCESS_CREDENTIAL_REVOKED"
  },
  VIEW_SPEAKER_BOARD: {
    accessPrefix: "otid_org_speaker_board_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: speakerBoardLoginRequestSchema,
    auditEntityType: "speaker_board_access_credential",
    issueAuditAction: "SPEAKER_BOARD_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "SPEAKER_BOARD_ACCESS_CREDENTIAL_REVOKED"
  },
  MANAGE_PM_DOCUMENT: {
    accessPrefix: "otid_org_pm_document_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: pmDocumentLoginRequestSchema,
    auditEntityType: "pm_document_access_credential",
    issueAuditAction: "PM_DOCUMENT_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "PM_DOCUMENT_ACCESS_CREDENTIAL_REVOKED"
  },
  START_CHECKIN: {
    accessPrefix: "otid_org_start_checkin_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: startCheckinAdminLoginRequestSchema,
    auditEntityType: "start_checkin_access_credential",
    issueAuditAction: "START_CHECKIN_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "START_CHECKIN_ACCESS_CREDENTIAL_REVOKED"
  },
  FINISH_FOREST_WATCH: {
    accessPrefix: "otid_org_finish_forest_watch_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: finishForestWatchAdminLoginRequestSchema,
    auditEntityType: "finish_forest_watch_access_credential",
    issueAuditAction: "FINISH_FOREST_WATCH_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "FINISH_FOREST_WATCH_ACCESS_CREDENTIAL_REVOKED"
  },
  PUBLISH_START_LIST: { accessPrefix: "otid_org_start_list_publication_v1", maxAccessLifetimeMs: 8 * 60 * 60 * 1000, maxSessionLifetimeMs: 60 * 60 * 1000, loginRequestSchema: startListPublicationAdminLoginRequestSchema, auditEntityType: "start_list_publication_access_credential", issueAuditAction: "START_LIST_PUBLICATION_ACCESS_CREDENTIAL_ISSUED", revokeAuditAction: "START_LIST_PUBLICATION_ACCESS_CREDENTIAL_REVOKED" },
  VIEW_READOUT_RESULT_HISTORY: {
    accessPrefix: "otid_org_readout_result_history_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: readoutResultHistoryAdminLoginRequestSchema,
    auditEntityType: "readout_result_history_access_credential",
    issueAuditAction: "READOUT_RESULT_HISTORY_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "READOUT_RESULT_HISTORY_ACCESS_CREDENTIAL_REVOKED"
  },
  EXPORT_IOF_RESULT_LIST: {
    accessPrefix: "otid_org_result_list_export_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: iofResultListExportAdminLoginRequestSchema,
    auditEntityType: "iof_result_list_export_access_credential",
    issueAuditAction: "IOF_RESULT_LIST_EXPORT_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "IOF_RESULT_LIST_EXPORT_ACCESS_CREDENTIAL_REVOKED"
  },
  FINALIZE_RESULTS: {
    accessPrefix: "otid_org_result_finalize_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: resultFinalizationAdminLoginRequestSchema,
    auditEntityType: "result_finalization_access_credential",
    issueAuditAction: "RESULT_FINALIZATION_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RESULT_FINALIZATION_ACCESS_CREDENTIAL_REVOKED"
  },
  DECIDE_DID_NOT_START: {
    accessPrefix: "otid_org_did_not_start_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: didNotStartAdminLoginRequestSchema,
    auditEntityType: "did_not_start_access_credential",
    issueAuditAction: "DID_NOT_START_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "DID_NOT_START_ACCESS_CREDENTIAL_REVOKED"
  },
  WITHDRAW_DID_NOT_START: {
    accessPrefix: "otid_org_did_not_start_withdrawal_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: didNotStartWithdrawalAdminLoginRequestSchema,
    auditEntityType: "did_not_start_withdrawal_access_credential",
    issueAuditAction: "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL_REVOKED"
  },
  DISQUALIFY_RESULT: {
    accessPrefix: "otid_org_result_disqualification_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: resultDisqualificationAdminLoginRequestSchema,
    auditEntityType: "result_disqualification_access_credential",
    issueAuditAction: "RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL_REVOKED"
  },
  WITHDRAW_DISQUALIFICATION: {
    accessPrefix: "otid_org_result_disqualification_withdrawal_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: resultDisqualificationWithdrawalAdminLoginRequestSchema,
    auditEntityType: "result_disqualification_withdrawal_access_credential",
    issueAuditAction: "RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL_REVOKED"
  },
  APPROVE_RESULT: {
    accessPrefix: "otid_org_result_approval_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: resultApprovalAdminLoginRequestSchema,
    auditEntityType: "result_approval_access_credential",
    issueAuditAction: "RESULT_APPROVAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RESULT_APPROVAL_ACCESS_CREDENTIAL_REVOKED"
  },
  WITHDRAW_RESULT_APPROVAL: {
    accessPrefix: "otid_org_result_approval_withdrawal_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: resultApprovalWithdrawalAdminLoginRequestSchema,
    auditEntityType: "result_approval_withdrawal_access_credential",
    issueAuditAction: "RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL_REVOKED"
  },
  DECIDE_DID_NOT_FINISH: {
    accessPrefix: "otid_org_did_not_finish_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: didNotFinishAdminLoginRequestSchema,
    auditEntityType: "did_not_finish_access_credential",
    issueAuditAction: "DID_NOT_FINISH_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "DID_NOT_FINISH_ACCESS_CREDENTIAL_REVOKED"
  },
  WITHDRAW_DID_NOT_FINISH: {
    accessPrefix: "otid_org_did_not_finish_withdrawal_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: didNotFinishWithdrawalAdminLoginRequestSchema,
    auditEntityType: "did_not_finish_withdrawal_access_credential",
    issueAuditAction: "DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL_REVOKED"
  },
  DECIDE_OUT_OF_COMPETITION: {
    accessPrefix: "otid_org_out_of_competition_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: outOfCompetitionAdminLoginRequestSchema,
    auditEntityType: "out_of_competition_access_credential",
    issueAuditAction: "OUT_OF_COMPETITION_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "OUT_OF_COMPETITION_ACCESS_CREDENTIAL_REVOKED"
  },
  WITHDRAW_OUT_OF_COMPETITION: {
    accessPrefix: "otid_org_out_of_competition_withdrawal_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: outOfCompetitionWithdrawalAdminLoginRequestSchema,
    auditEntityType: "out_of_competition_withdrawal_access_credential",
    issueAuditAction: "OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL_REVOKED"
  },
  DECIDE_WITHOUT_TIMING: {
    accessPrefix: "otid_org_without_timing_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: withoutTimingAdminLoginRequestSchema,
    auditEntityType: "without_timing_access_credential",
    issueAuditAction: "WITHOUT_TIMING_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "WITHOUT_TIMING_ACCESS_CREDENTIAL_REVOKED"
  },
  WITHDRAW_WITHOUT_TIMING: {
    accessPrefix: "otid_org_without_timing_withdrawal_v1",
    maxAccessLifetimeMs: 8 * 60 * 60 * 1000,
    maxSessionLifetimeMs: 60 * 60 * 1000,
    loginRequestSchema: withoutTimingWithdrawalAdminLoginRequestSchema,
    auditEntityType: "without_timing_withdrawal_access_credential",
    issueAuditAction: "WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
    revokeAuditAction: "WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL_REVOKED"
  }
} as const satisfies Record<RaceAdminCapability, {
  accessPrefix: string;
  maxAccessLifetimeMs: number;
  maxSessionLifetimeMs: number;
  loginRequestSchema: { safeParse(value: unknown): { success: boolean; data?: unknown } };
  auditEntityType: string;
  issueAuditAction: string;
  revokeAuditAction: string;
}>;

type RaceAdminLoginRequest = typeof raceAdministratorLoginRequestSchema._output | PairingAdminLoginRequest | IofImportLoginRequest | SpeakerBoardLoginRequest | PmDocumentLoginRequest |
  EntryClassAdminLoginRequest | EntryStartTimeAdminLoginRequest | ClassStartDrawAdminLoginRequest | EntryCardAdminLoginRequest | EntryRegistrationAdminLoginRequest | ResultRecalculationAdminLoginRequest | RaceOverviewAdminLoginRequest | StartListAdminLoginRequest | StartCheckinAdminLoginRequest | FinishForestWatchAdminLoginRequest | StartListPublicationAdminLoginRequest |
  ReadoutResultHistoryAdminLoginRequest | IofResultListExportAdminLoginRequest |
  ResultFinalizationAdminLoginRequest | DidNotStartAdminLoginRequest |
  DidNotStartWithdrawalAdminLoginRequest | ResultDisqualificationAdminLoginRequest |
  ResultDisqualificationWithdrawalAdminLoginRequest | ResultApprovalAdminLoginRequest |
  ResultApprovalWithdrawalAdminLoginRequest | DidNotFinishAdminLoginRequest |
  DidNotFinishWithdrawalAdminLoginRequest | OutOfCompetitionAdminLoginRequest |
  OutOfCompetitionWithdrawalAdminLoginRequest | WithoutTimingAdminLoginRequest |
  WithoutTimingWithdrawalAdminLoginRequest;

export interface RaceAdminLoginResponse {
  formatVersion: 1;
  raceId: string;
  capability: RaceAdminCapability;
  expiresAt: string;
}

export interface PairingAdminPrincipal {
  accessCredentialId: string;
  raceId: string;
  capability: RaceAdminCapability;
  sessionId: string;
  expiresAt: string;
}

export interface PairingAdminAccessCredentialInstallation {
  formatVersion: 1;
  accessCredential: string;
  credentialId: string;
  raceId: string;
  capability: RaceAdminCapability;
  label: string;
  issuedAt: string;
  expiresAt: string;
}

export type PairingAdminAuthenticationResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "authenticated"; principal: PairingAdminPrincipal };

export type PairingAdminLoginResult =
  | { status: "unauthorized" }
  | {
    status: "authenticated";
    response: RaceAdminLoginResponse;
    sessionToken: string;
    csrfToken: string;
  };

export type PairingAdminLogoutResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid-request" }
  | { status: "logged-out" | "already-logged-out" };

export type PairingAdminGrantIssueResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" }
  | { status: "stored" | "duplicate"; response: PairingAdminGrantIssueResponse };

export type PairingAdminGrantListResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: PairingAdminGrantListResponse };

export type PairingAdminGrantRevokeResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "revoked" | "already-revoked"; response: PairingAdminGrantRevokeResponse };

export interface PairingAdminRuntimeOptions {
  now?: Date;
  id?: string;
  secretBytes?: Uint8Array;
  sessionId?: string;
  sessionSecretBytes?: Uint8Array;
  csrfSecretBytes?: Uint8Array;
}

export interface PairingAdminLoginOptions extends PairingAdminRuntimeOptions {
  expectedRaceId: string;
  expectedCapability: RaceAdminCapability;
}

export interface PairingAdminRequestAuthentication {
  sessionToken: string | null;
  raceId: string;
  capability: RaceAdminCapability;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
  requireCsrf?: boolean;
}

interface ParsedToken { id: string; secret: Buffer }

function validDate(value: Date, description: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(`${description} är ogiltig`);
  return value;
}

function uuid(value: string, description: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${description} är ogiltigt`);
  return value;
}

function secret(value?: Uint8Array): Buffer {
  const result = value === undefined ? randomBytes(32) : Buffer.from(value);
  if (result.length !== 32) throw new Error("Secret måste vara exakt 32 bytes");
  return result;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(prefix: string, id: string, value: Buffer): string {
  return `${prefix}.${id}.${value.toString("base64url")}`;
}

function parseToken(value: string | null, prefix: string): ParsedToken | undefined {
  if (value === null || value.length > 128) return undefined;
  const match = new RegExp(`^${prefix}\\.([0-9a-f-]{36})\\.([A-Za-z0-9_-]{43})$`).exec(value);
  if (!match?.[1] || !match[2] || !UUID_PATTERN.test(match[1]) || !SECRET_PATTERN.test(match[2])) return undefined;
  const decoded = Buffer.from(match[2], "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== match[2]) return undefined;
  return { id: match[1], secret: decoded };
}

function hashesMatch(secretBytes: Buffer, stored: string | undefined): boolean {
  const candidate = Buffer.from(sha256(secretBytes), "hex");
  const expected = stored !== undefined && HASH_PATTERN.test(stored) ? Buffer.from(stored, "hex") : DUMMY_HASH;
  return timingSafeEqual(candidate, expected);
}

function csrfMatches(cookie: string | null | undefined, header: string | null | undefined, storedHash: string): boolean {
  const cookieBytes = cookie && SECRET_PATTERN.test(cookie) ? Buffer.from(cookie, "base64url") : Buffer.alloc(32);
  const headerBytes = header && SECRET_PATTERN.test(header) ? Buffer.from(header, "base64url") : Buffer.alloc(32);
  const expected = HASH_PATTERN.test(storedHash) ? Buffer.from(storedHash, "hex") : DUMMY_HASH;
  return timingSafeEqual(Buffer.from(sha256(cookieBytes), "hex"), expected) &&
    timingSafeEqual(Buffer.from(sha256(headerBytes), "hex"), expected) &&
    timingSafeEqual(cookieBytes, headerBytes);
}

async function authorizeSession(
  tx: DbExecutor,
  input: PairingAdminRequestAuthentication,
  now: Date,
  lock: "none" | "share" | "update"
): Promise<PairingAdminAuthenticationResult> {
  const parsed = parseToken(input.sessionToken, SESSION_PREFIX);
  const sessionQuery = tx.select().from(schema.pairingAdminSessions)
    .where(eq(schema.pairingAdminSessions.id, parsed?.id ?? "00000000-0000-4000-8000-000000000000"));
  const [session] = lock === "share" ? await sessionQuery.for("share") :
    lock === "update" ? await sessionQuery.for("update") : await sessionQuery;
  const sessionSecretMatches = hashesMatch(parsed?.secret ?? Buffer.alloc(32), session?.sessionSecretHash);
  if (!session || !parsed || !sessionSecretMatches) return { status: "unauthorized" };

  const credentialQuery = tx.select().from(schema.pairingAdminAccessCredentials)
    .where(eq(schema.pairingAdminAccessCredentials.id, session.accessCredentialId));
  const [credential] = lock === "share" ? await credentialQuery.for("share") :
    lock === "update" ? await credentialQuery.for("update") : await credentialQuery;
  if (lock === "share") {
    // Revocation INSERTs atomically advance this mutable tuple. A stale RR
    // snapshot cannot lock a changed guard: PostgreSQL raises 40001 instead.
    const [guard] = await tx.select({ credentialId: schema.pairingAdminRevocationGuards.credentialId })
      .from(schema.pairingAdminRevocationGuards)
      .where(eq(schema.pairingAdminRevocationGuards.credentialId, session.accessCredentialId)).for("share");
    if (!guard) return { status: "unauthorized" };
  }
  const [sessionRevocation] = await tx.select({ id: schema.pairingAdminSessionRevocations.id })
    .from(schema.pairingAdminSessionRevocations)
    .where(eq(schema.pairingAdminSessionRevocations.sessionId, session.id)).limit(1);
  const [credentialRevocation] = await tx.select({ id: schema.pairingAdminAccessCredentialRevocations.id })
    .from(schema.pairingAdminAccessCredentialRevocations)
    .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, session.accessCredentialId)).limit(1);
  if (!credential || sessionRevocation || credentialRevocation ||
    session.issuedAt.getTime() > now.getTime() || session.expiresAt.getTime() <= now.getTime() ||
    credential.issuedAt.getTime() > now.getTime() || credential.expiresAt.getTime() <= now.getTime()) {
    return { status: "unauthorized" };
  }
  if (credential.raceId !== input.raceId || !raceAdministratorAllowsAction(credential.capability, input.capability)) {
    return { status: "forbidden" };
  }
  if (input.requireCsrf && !csrfMatches(input.csrfCookie, input.csrfHeader, session.csrfSecretHash)) {
    return { status: "forbidden" };
  }
  const delegationQuery = tx.select().from(schema.userAccountRaceDelegations)
    .where(eq(schema.userAccountRaceDelegations.credentialId, credential.id));
  const [delegation] = lock === "share" ? await delegationQuery.for("share") :
    lock === "update" ? await delegationQuery.for("update") : await delegationQuery;
  if (delegation) {
    if (delegation.raceId !== credential.raceId || delegation.capability !== credential.capability ||
      delegation.issuedAt.getTime() > now.getTime() || delegation.expiresAt.getTime() <= now.getTime()) {
      return { status: "unauthorized" };
    }
    if (!await activeUserAccountParentSession(tx, {
      accountId: delegation.accountId, sessionId: delegation.accountSessionId
    }, now, lock)) return { status: "unauthorized" };
    const grantQuery = tx.select().from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.id, delegation.grantId));
    const [grant] = lock === "share" ? await grantQuery.for("share") :
      lock === "update" ? await grantQuery.for("update") : await grantQuery;
    if (!grant || grant.accountId !== delegation.accountId || grant.eventId !== delegation.eventId ||
      (grant.role !== "OWNER" && grant.role !== "ADMIN")) return { status: "unauthorized" };
    if (lock !== "none") {
      const guardQuery = tx.select({ grantId: schema.eventAdministrationGrantGuards.grantId })
        .from(schema.eventAdministrationGrantGuards)
        .where(eq(schema.eventAdministrationGrantGuards.grantId, grant.id));
      const [guard] = lock === "share" ? await guardQuery.for("share") : await guardQuery.for("update");
      if (!guard) return { status: "unauthorized" };
    }
    const [grantRevocation] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id })
      .from(schema.eventAdministrationGrantRevocations)
      .where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id)).limit(1);
    if (grantRevocation) return { status: "unauthorized" };
  }
  return {
    status: "authenticated",
    principal: {
      accessCredentialId: credential.id,
      raceId: credential.raceId,
      capability: credential.capability,
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString()
    }
  };
}

export async function issuePairingAdminAccessCredential(
  db: DbExecutor,
  input: { raceId: string; capability: RaceAdminCapability; label: string; expiresAt: Date },
  options: PairingAdminRuntimeOptions = {}
): Promise<PairingAdminAccessCredentialInstallation> {
  const raceId = uuid(input.raceId, "Lopp-id");
  const policy = CAPABILITY_POLICY[input.capability];
  if (!policy) throw new Error("Capability är ogiltig");
  const label = input.label.trim();
  if (label.length < 1 || label.length > 120) throw new Error("Etiketten måste vara 1–120 tecken");
  const issuedAt = validDate(options.now ?? new Date(), "Utfärdandetiden");
  const expiresAt = validDate(input.expiresAt, "Utgångstiden");
  const lifetime = expiresAt.getTime() - issuedAt.getTime();
  if (lifetime <= 0 || lifetime > policy.maxAccessLifetimeMs) {
    throw new Error(`Credentialen måste gälla högst ${policy.maxAccessLifetimeMs / (60 * 60 * 1000)} timmar`);
  }
  const credentialId = uuid(options.id ?? randomUUID(), "Credential-id");
  const secretBytes = secret(options.secretBytes);
  await db.transaction(async (tx) => {
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, raceId));
    if (!race) throw new Error("Loppet finns inte");
    await tx.insert(schema.pairingAdminAccessCredentials).values({
      id: credentialId, raceId, capability: input.capability, label,
      secretHash: sha256(secretBytes), issuedAt, expiresAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId,
      entityType: policy.auditEntityType,
      entityId: credentialId,
      action: policy.issueAuditAction,
      after: { capability: input.capability, label, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }
    });
  });
  return {
    formatVersion: 1,
    accessCredential: token(policy.accessPrefix, credentialId, secretBytes),
    credentialId, raceId, capability: input.capability, label,
    issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString()
  };
}

export async function revokePairingAdminAccessCredentialInTransaction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: { credentialId: string; capability: RaceAdminCapability; reason?: string },
  now = new Date()
): Promise<{ status: "revoked" | "already-revoked"; credentialId: string; revokedAt: string }> {
  const credentialId = uuid(input.credentialId, "Credential-id");
  const revokedAt = validDate(now, "Spärrtiden");
  const [credential] = await tx.select().from(schema.pairingAdminAccessCredentials)
    .where(eq(schema.pairingAdminAccessCredentials.id, credentialId)).for("update");
  if (!credential || credential.capability !== input.capability) throw new Error("Credentialen finns inte");
  const [created] = await tx.insert(schema.pairingAdminAccessCredentialRevocations).values({
    credentialId, revokedAt, reason: input.reason?.trim() || "OPERATOR_REVOKED"
  }).onConflictDoNothing().returning({ id: schema.pairingAdminAccessCredentialRevocations.id });
  if (!created) {
    const [existing] = await tx.select({ revokedAt: schema.pairingAdminAccessCredentialRevocations.revokedAt })
      .from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, credentialId));
    if (!existing) throw new Error("Credentialspärren kunde inte läsas");
    return { status: "already-revoked" as const, credentialId, revokedAt: existing.revokedAt.toISOString() };
  }
  const policy = CAPABILITY_POLICY[credential.capability];
  await tx.insert(schema.auditEvents).values({
    raceId: credential.raceId,
    entityType: policy.auditEntityType,
    entityId: credentialId,
    action: policy.revokeAuditAction,
    after: { revokedAt: revokedAt.toISOString() }
  });
  return { status: "revoked" as const, credentialId, revokedAt: revokedAt.toISOString() };
}

export async function revokePairingAdminAccessCredential(
  db: Database,
  input: { credentialId: string; capability: RaceAdminCapability; reason?: string },
  now = new Date()
): Promise<{ status: "revoked" | "already-revoked"; credentialId: string; revokedAt: string }> {
  return db.transaction((tx) => revokePairingAdminAccessCredentialInTransaction(tx, input, now));
}

export async function loginPairingAdmin(
  db: Database,
  request: RaceAdminLoginRequest,
  options: PairingAdminLoginOptions
): Promise<PairingAdminLoginResult> {
  const policy = CAPABILITY_POLICY[options.expectedCapability];
  const parsedRequest = policy.loginRequestSchema.safeParse(request);
  const parsedToken = parseToken(
    parsedRequest.success && typeof parsedRequest.data === "object" && parsedRequest.data !== null &&
      "accessCredential" in parsedRequest.data && typeof parsedRequest.data.accessCredential === "string"
      ? parsedRequest.data.accessCredential
      : null,
    policy.accessPrefix
  );
  const now = validDate(options.now ?? new Date(), "Inloggningstiden");
  if (!parsedRequest.success || !UUID_PATTERN.test(options.expectedRaceId)) {
    hashesMatch(Buffer.alloc(32), undefined);
    return { status: "unauthorized" };
  }
  return db.transaction(async (tx) => {
    const query = tx.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, parsedToken?.id ?? "00000000-0000-4000-8000-000000000000"));
    const [credential] = await query.for("update");
    const matches = hashesMatch(parsedToken?.secret ?? Buffer.alloc(32), credential?.secretHash);
    const [revocation] = credential ? await tx.select({ id: schema.pairingAdminAccessCredentialRevocations.id })
      .from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, credential.id)).limit(1) : [];
    if (!credential || !parsedToken || !matches || revocation ||
      credential.raceId !== options.expectedRaceId || credential.capability !== options.expectedCapability ||
      credential.issuedAt.getTime() > now.getTime() || credential.expiresAt.getTime() <= now.getTime()) {
      return { status: "unauthorized" };
    }
    const sessionId = uuid(options.sessionId ?? randomUUID(), "Session-id");
    const sessionSecret = secret(options.sessionSecretBytes);
    const csrfSecret = secret(options.csrfSecretBytes);
    const expiresAt = new Date(Math.min(now.getTime() + policy.maxSessionLifetimeMs, credential.expiresAt.getTime()));
    await tx.insert(schema.pairingAdminSessions).values({
      id: sessionId, accessCredentialId: credential.id,
      sessionSecretHash: sha256(sessionSecret), csrfSecretHash: sha256(csrfSecret),
      issuedAt: now, expiresAt
    });
    return {
      status: "authenticated" as const,
      response: {
        formatVersion: 1, raceId: credential.raceId,
        capability: credential.capability, expiresAt: expiresAt.toISOString()
      },
      sessionToken: token(SESSION_PREFIX, sessionId, sessionSecret),
      csrfToken: csrfSecret.toString("base64url")
    };
  });
}

export async function authenticatePairingAdminSession(
  db: Database,
  input: PairingAdminRequestAuthentication,
  now = new Date()
): Promise<PairingAdminAuthenticationResult> {
  return authorizeSession(db, input, validDate(now, "Autentiseringstiden"), "none");
}

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Mutation-only authorization primitive. The caller must invoke this first in
 * its transaction so locks are always acquired session -> credential -> race.
 */
export async function authenticatePairingAdminSessionForMutation(
  tx: DatabaseTransaction,
  input: PairingAdminRequestAuthentication,
  now = new Date()
): Promise<PairingAdminAuthenticationResult> {
  return authorizeSession(tx, input, validDate(now, "Autentiseringstiden"), "update");
}

/**
 * Read-only authorization primitive. The caller must invoke this first in its
 * transaction so concurrent reads share session/credential locks while
 * logout and credential revocation retain a single serialization point.
 */
export async function authenticatePairingAdminSessionForProtectedRead(
  tx: DatabaseTransaction,
  input: PairingAdminRequestAuthentication,
  now = new Date()
): Promise<PairingAdminAuthenticationResult> {
  try {
    return await tx.transaction((authTx) =>
      authorizeSession(authTx, input, validDate(now, "Autentiseringstiden"), "share"));
  } catch (error) {
    // Roll back only the authentication savepoint, then stop the caller before
    // private projection. Never retry from the outer transaction's old snapshot.
    if (postgresSerializationFailure(error)) return { status: "unauthorized" };
    throw error;
  }
}

function postgresSerializationFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    if ("code" in current && current.code === "40001") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function logoutPairingAdminSession(
  db: Database,
  input: {
    sessionToken: string | null;
    raceId: string;
    capability: RaceAdminCapability;
    csrfCookie: string | null;
    csrfHeader: string | null;
    readBodyIsEmpty?: () => Promise<boolean>;
  },
  now = new Date()
): Promise<PairingAdminLogoutResult> {
  const parsed = parseToken(input.sessionToken, SESSION_PREFIX);
  const loggedOutAt = validDate(now, "Utloggningstiden");
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(schema.pairingAdminSessions)
      .where(eq(schema.pairingAdminSessions.id, parsed?.id ?? "00000000-0000-4000-8000-000000000000")).for("update");
    if (!session || !parsed || !hashesMatch(parsed.secret, session.sessionSecretHash)) return { status: "unauthorized" };
    const [credential] = await tx.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, session.accessCredentialId)).for("update");
    const [credentialRevocation] = credential ? await tx.select({ id: schema.pairingAdminAccessCredentialRevocations.id })
      .from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, credential.id)).limit(1) : [];
    if (!credential || credentialRevocation ||
      session.issuedAt.getTime() > loggedOutAt.getTime() || session.expiresAt.getTime() <= loggedOutAt.getTime() ||
      credential.issuedAt.getTime() > loggedOutAt.getTime() || credential.expiresAt.getTime() <= loggedOutAt.getTime()) {
      return { status: "unauthorized" };
    }
    if (credential.raceId !== input.raceId || credential.capability !== input.capability) {
      return { status: "forbidden" };
    }
    if (!csrfMatches(input.csrfCookie, input.csrfHeader, session.csrfSecretHash)) return { status: "forbidden" };
    if (input.readBodyIsEmpty !== undefined) {
      try {
        if (!await input.readBodyIsEmpty()) return { status: "invalid-request" };
      } catch {
        return { status: "invalid-request" };
      }
    }
    const [existing] = await tx.select({ id: schema.pairingAdminSessionRevocations.id })
      .from(schema.pairingAdminSessionRevocations).where(eq(schema.pairingAdminSessionRevocations.sessionId, session.id));
    if (existing) return { status: "already-logged-out" };
    await tx.insert(schema.pairingAdminSessionRevocations).values({
      sessionId: session.id, revokedAt: loggedOutAt, reason: "USER_LOGOUT"
    });
    return { status: "logged-out" };
  });
}

async function grantMetadata(tx: DbExecutor, grantId: string, now: Date): Promise<PairingAdminGrantMetadata | undefined> {
  const [row] = await tx.select({
    grant: schema.stationPairingGrants,
    redeemedAt: schema.stationPairingRedemptions.redeemedAt,
    revokedAt: schema.stationPairingGrantRevocations.revokedAt
  }).from(schema.stationPairingGrants)
    .leftJoin(schema.stationPairingRedemptions, eq(schema.stationPairingRedemptions.grantId, schema.stationPairingGrants.id))
    .leftJoin(schema.stationPairingGrantRevocations, eq(schema.stationPairingGrantRevocations.grantId, schema.stationPairingGrants.id))
    .where(eq(schema.stationPairingGrants.id, grantId)).limit(1);
  if (!row) return undefined;
  const status = row.redeemedAt ? "REDEEMED" : row.revokedAt ? "REVOKED" :
    row.grant.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "ACTIVE";
  return {
    formatVersion: 1, grantId: row.grant.id, raceId: row.grant.raceId, scope: row.grant.scope, status,
    issuedAt: row.grant.issuedAt.toISOString(), expiresAt: row.grant.expiresAt.toISOString(),
    credentialExpiresAt: row.grant.credentialExpiresAt.toISOString(),
    redeemedAt: row.redeemedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null
  };
}

export async function issuePairingGrantAsAdmin(
  db: Database,
  input: PairingAdminRequestAuthentication & { idempotencyKey: string | null; readBody: () => Promise<unknown> },
  now = new Date()
): Promise<PairingAdminGrantIssueResult> {
  const issuedAt = validDate(now, "Utfärdandetiden");
  return db.transaction(async (tx) => {
    const authorization = await authorizeSession(
      tx,
      { ...input, capability: "PAIR_STATION", requireCsrf: true },
      issuedAt,
      "update"
    );
    if (authorization.status !== "authenticated") return authorization;
    let body: unknown;
    try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
    const parsed = pairingAdminGrantIssueRequestSchema.safeParse(body);
    if (!parsed.success || input.idempotencyKey !== `pairing-grant:${parsed.data.grantId}`) {
      return { status: "invalid-request" };
    }
    const request = parsed.data;
    const expiresAt = new Date(issuedAt.getTime() + GRANT_LIFETIME_MS);
    const credentialExpiresAt = new Date(issuedAt.getTime() + request.credentialLifetimeHours * 60 * 60 * 1000);
    const [created] = await tx.insert(schema.stationPairingGrants).values({
      id: request.grantId, raceId: authorization.principal.raceId, scope: "READOUT",
      secretHash: request.grantSecretHash, issuedAt, expiresAt, credentialExpiresAt,
      issuerCredentialId: authorization.principal.accessCredentialId
    }).onConflictDoNothing().returning({ id: schema.stationPairingGrants.id });
    if (!created) {
      const [existing] = await tx.select().from(schema.stationPairingGrants)
        .where(eq(schema.stationPairingGrants.id, request.grantId)).for("update");
      const durationHours = existing ?
        (existing.credentialExpiresAt.getTime() - existing.issuedAt.getTime()) / (60 * 60 * 1000) : -1;
      const exact = existing?.raceId === authorization.principal.raceId && existing.scope === "READOUT" &&
        existing.secretHash === request.grantSecretHash &&
        existing.issuerCredentialId === authorization.principal.accessCredentialId &&
        durationHours === request.credentialLifetimeHours;
      if (!exact) return { status: "conflict" };
      const metadata = await grantMetadata(tx, request.grantId, issuedAt);
      if (!metadata) throw new Error("Grantet kunde inte läsas");
      return { status: "duplicate", response: { formatVersion: 1, status: "duplicate", grant: metadata } };
    }
    await tx.insert(schema.auditEvents).values({
      raceId: authorization.principal.raceId, entityType: "station_pairing_grant", entityId: request.grantId,
      action: "STATION_PAIRING_GRANT_ISSUED_BY_ADMIN",
      actorKind: "PAIRING_ADMIN_ACCESS_CREDENTIAL", actorId: authorization.principal.accessCredentialId,
      requestId: request.grantId,
      after: { scope: "READOUT", issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(),
        credentialExpiresAt: credentialExpiresAt.toISOString() }
    });
    const metadata = await grantMetadata(tx, request.grantId, issuedAt);
    if (!metadata) throw new Error("Grantet kunde inte läsas");
    return { status: "stored", response: { formatVersion: 1, status: "stored", grant: metadata } };
  });
}

export async function listPairingGrantsAsAdmin(
  db: Database,
  input: PairingAdminRequestAuthentication,
  now = new Date()
): Promise<PairingAdminGrantListResult> {
  const listedAt = validDate(now, "Listningstiden");
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(
      tx, { ...input, capability: "PAIR_STATION" }, listedAt
    );
    if (authorization.status !== "authenticated") return authorization;
    const rows = await tx.select({ id: schema.stationPairingGrants.id }).from(schema.stationPairingGrants)
      .where(eq(schema.stationPairingGrants.raceId, authorization.principal.raceId))
      .orderBy(desc(schema.stationPairingGrants.issuedAt)).limit(1000);
    const grants: PairingAdminGrantMetadata[] = [];
    for (const row of rows) {
      const metadata = await grantMetadata(tx, row.id, listedAt);
      if (metadata) grants.push(metadata);
    }
    return { status: "ok", response: { formatVersion: 1, grants } };
  });
}

export async function revokePairingGrantAsAdmin(
  db: Database,
  input: PairingAdminRequestAuthentication & { grantId: string; readBodyIsEmpty?: () => Promise<boolean> },
  now = new Date()
): Promise<PairingAdminGrantRevokeResult> {
  const revokedAt = validDate(now, "Spärrtiden");
  if (!UUID_PATTERN.test(input.grantId)) return { status: "not-found" };
  return db.transaction(async (tx) => {
    const authorization = await authorizeSession(
      tx,
      { ...input, capability: "PAIR_STATION", requireCsrf: true },
      revokedAt,
      "update"
    );
    if (authorization.status !== "authenticated") return authorization;
    if (input.readBodyIsEmpty !== undefined) {
      try {
        if (!await input.readBodyIsEmpty()) return { status: "invalid-request" };
      } catch {
        return { status: "invalid-request" };
      }
    }
    const [grant] = await tx.select().from(schema.stationPairingGrants)
      .where(eq(schema.stationPairingGrants.id, input.grantId)).for("update");
    if (!grant || grant.raceId !== authorization.principal.raceId) return { status: "not-found" };
    const [created] = await tx.insert(schema.stationPairingGrantRevocations).values({
      grantId: grant.id, revokedAt, reason: "PAIRING_ADMIN_REVOKED"
    }).onConflictDoNothing().returning({ id: schema.stationPairingGrantRevocations.id });
    if (created) {
      await tx.insert(schema.auditEvents).values({
        raceId: grant.raceId, entityType: "station_pairing_grant", entityId: grant.id,
        action: "STATION_PAIRING_GRANT_REVOKED_BY_ADMIN",
        actorKind: "PAIRING_ADMIN_ACCESS_CREDENTIAL", actorId: authorization.principal.accessCredentialId,
        requestId: grant.id, after: { revokedAt: revokedAt.toISOString() }
      });
    }
    const metadata = await grantMetadata(tx, grant.id, revokedAt);
    if (!metadata) throw new Error("Grantet kunde inte läsas");
    const status = created ? "revoked" as const : "already-revoked" as const;
    return { status, response: { formatVersion: 1, status, grant: metadata } };
  });
}
