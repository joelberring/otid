import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";

/**
 * Steg 68 (ADR-0182): träningsgrupper – gruppen, ledare och medlemmar, synligheten, nya tillfällen och upprepning,
 * kartbiblioteket med avtal och kartans avtal på tävlingen. Alla skrivningar är idempotenta på `requestId` där en rad skapas.
 */
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const optionalText = (max: number) => z.string().trim().max(max).transform(value => value === "" ? null : value).nullable();

export const groupCodeSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/);
export const groupNameSchema = z.string().trim().min(1).max(120);
export const groupPageVisibilitySchema = z.enum(["LINK", "MEMBERS"]);
export const groupNameDisplaySchema = z.enum(["FIRST", "FULL", "NONE"]);
export const groupStatsVisibilitySchema = z.enum(["LEADERS", "MEMBERS"]);
export const groupPointsModeSchema = z.enum(["NONE", "ATTENDANCE", "PLACEMENT"]);
export const groupMemberRoleSchema = z.enum(["LEADER", "MEMBER"]);

export const groupCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, name: groupNameSchema, code: groupCodeSchema
}).strict();

export const groupSettingsRequestSchema = z.object({
  formatVersion: z.literal(1),
  name: groupNameSchema,
  pageVisibility: groupPageVisibilitySchema,
  nameDisplay: groupNameDisplaySchema,
  statsVisibility: groupStatsVisibilitySchema,
  pointsMode: groupPointsModeSchema,
  /** Gruppens mall: en av gruppens tävlingar, eller null = förra tillfället. */
  templateRaceId: uuidSchema.nullable()
}).strict();

export const groupMemberAddRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, email: accountEmailSchema, role: groupMemberRoleSchema
}).strict();

export const groupMemberRemoveRequestSchema = z.object({ formatVersion: z.literal(1), memberId: uuidSchema }).strict();

export const mapAgreementSchema = z.object({
  ownership: z.enum(["CLUB", "EXTERNAL"]),
  ownerKind: z.enum(["CLUB", "MUNICIPALITY", "MAPPER", "OTHER"]).nullable(),
  ownerName: optionalText(200),
  agreement: optionalText(2000),
  validUntil: z.iso.date().nullable(),
  contact: optionalText(200),
  trainingOnly: z.boolean(),
  feePerPrint: z.boolean(),
  noPublicDisplay: z.boolean()
}).strict();

/** Ny träning ur gruppens mall, förra tillfället eller en vald tävling i gruppen; med upprepning skapas alla i förväg. */
export const groupSessionCreateRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuidSchema,
  source: z.enum(["TEMPLATE", "PREVIOUS", "RACE"]),
  sourceRaceId: uuidSchema.nullable(),
  eventName: z.string().trim().min(2).max(160),
  raceDate: z.iso.date(),
  startTime: time.nullable(),
  /** En karta ur gruppens bibliotek i stället för källans. */
  mapId: uuidSchema.nullable(),
  includeCourseSetting: z.boolean(),
  publish: z.boolean(),
  /** Upprepning: varje veckodag (ISO 1–7) från `raceDate` till och med `lastDate`. */
  repeat: z.object({ weekday: z.number().int().min(1).max(7), lastDate: z.iso.date() }).strict().nullable(),
  /** Kartans avtal har gått ut eller gäller bara träning: ledaren har sett varningen och går vidare medvetet. */
  acknowledgeAgreement: z.boolean()
}).strict();

export const groupMapSaveRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, raceId: uuidSchema, name: groupNameSchema, includeCourseSetting: z.boolean(),
  agreement: mapAgreementSchema
}).strict();

export const groupMapUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: groupNameSchema, agreement: mapAgreementSchema
}).strict();

export const raceGroupAttachRequestSchema = z.object({ formatVersion: z.literal(1), groupId: uuidSchema.nullable() }).strict();

export const raceMapAgreementAcknowledgeRequestSchema = z.object({ formatVersion: z.literal(1), acknowledge: z.boolean() }).strict();

export type GroupCreateRequest = z.infer<typeof groupCreateRequestSchema>;
export type GroupSettingsRequest = z.infer<typeof groupSettingsRequestSchema>;
export type GroupMemberAddRequest = z.infer<typeof groupMemberAddRequestSchema>;
export type MapAgreement = z.infer<typeof mapAgreementSchema>;
export type GroupSessionCreateRequest = z.infer<typeof groupSessionCreateRequestSchema>;
export type GroupMapSaveRequest = z.infer<typeof groupMapSaveRequestSchema>;
export type GroupPageVisibility = z.infer<typeof groupPageVisibilitySchema>;
export type GroupNameDisplay = z.infer<typeof groupNameDisplaySchema>;
export type GroupStatsVisibility = z.infer<typeof groupStatsVisibilitySchema>;
export type GroupPointsMode = z.infer<typeof groupPointsModeSchema>;
export type GroupMemberRole = z.infer<typeof groupMemberRoleSchema>;

export type MapAgreementIssueCode = "EXPIRED" | "NO_PUBLIC_DISPLAY" | "TRAINING_ONLY" | "FEE_PER_PRINT";

/** Gruppens inställningar som ledarna ser dem. */
export interface GroupSettings {
  name: string; code: string; pageVisibility: GroupPageVisibility; nameDisplay: GroupNameDisplay; statsVisibility: GroupStatsVisibility;
  pointsMode: GroupPointsMode; templateRaceId: string | null;
}

export interface GroupSummary { groupId: string; name: string; code: string; role: GroupMemberRole; sessions: number }

/**
 * En ledare eller medlem. ADR-0189 beslut 9: `pending` = sparad för adressen och väntar på att någon loggar in med den (då är
 * `accountId` och `displayName` null och `memberId` inbjudans id); svaret är detsamma oavsett om adressen har ett konto.
 */
export interface GroupMember { memberId: string; accountId: string | null; email: string; displayName: string | null; role: GroupMemberRole;
  addedAt: string; pending: boolean }

export interface GroupSession {
  raceId: string; eventId: string; eventName: string; raceName: string; raceDate: string; raceType: string; firstStartTime: string | null;
  shortCode: string; published: boolean; seriesId: string | null; entries: number; hasResults: boolean;
}

export interface GroupSeries { seriesId: string; weekday: number; startTime: string; firstDate: string; lastDate: string; undoneAt: string | null;
  sessions: number }

export interface GroupLibraryMap extends MapAgreement {
  mapId: string; name: string; fileName: string; width: number; height: number; georeferenced: boolean;
  source: { fileName: string; format: string; scale: number } | null; courseSetting: boolean; createdAt: string; updatedAt: string;
}

export interface GroupSeasonRow { key: string; givenName: string; familyName: string; attended: number; points: number }

/** Ledarnas vy av gruppen (Mina tävlingar → gruppen). Namnen här är fullständiga: bara ledarna ser vyn. */
export interface GroupLeaderView {
  formatVersion: 1; groupId: string; viewer: { accountId: string; role: "LEADER" }; settings: GroupSettings; members: GroupMember[];
  sessions: GroupSession[]; series: GroupSeries[]; maps: GroupLibraryMap[]; season: { sessions: number; rows: GroupSeasonRow[] };
  today: string; timeZone: string;
}

/** Gruppsidan (/g/<kod>), med namnen enligt gruppens inställning. */
export interface GroupPublicSession { raceId: string; eventName: string; raceName: string; raceDate: string; firstStartTime: string | null;
  shortCode: string | null; hasResults: boolean }
export interface GroupPublicResult { className: string; givenName: string; familyName: string; status: string; position: number | null;
  elapsedMs: number | null }
export interface GroupPublicView {
  formatVersion: 1; name: string; code: string; nameDisplay: GroupNameDisplay; pageVisibility: GroupPageVisibility;
  viewer: "PUBLIC" | "MEMBER" | "LEADER";
  upcoming: GroupPublicSession[]; latest: (GroupPublicSession & { results: GroupPublicResult[] }) | null; archive: GroupPublicSession[];
  /** Dagens tillfälle med självanmälan öppen, om något. */
  today: GroupPublicSession | null;
  season: { pointsMode: GroupPointsMode; rows: GroupSeasonRow[] } | null;
}

/** Kartans avtal på tävlingen, som arbetsytan visar det. */
export interface RaceMapAgreementView extends MapAgreement {
  mapName: string; issues: MapAgreementIssueCode[]; publicUseBlocked: boolean; acknowledgedAt: string | null; raceDate: string;
}
