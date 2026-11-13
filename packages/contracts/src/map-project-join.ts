import { z } from "zod";
import { uuidSchema } from "./ids";
import { passwordResetTokenSchema } from "./account";
import { mapProjectRoleSchema, type MapProjectRole } from "./map-project";

/**
 * Ägaren 2026-11-13: bjud in till ett kartprojekt utan e-post. (a) Klubbmedlemmar läggs till direkt; (b) en länk med en vald roll
 * som den som har länken öppnar inloggad för att gå med. Samma behörighet som e-postinbjudan (ägarna); ingen ny rolltyp.
 */
/** Länken gäller så här länge (som inbjudningslänkarna, ADR-0206). */
export const MAP_PROJECT_JOIN_LINK_LIFETIME_DAYS = 14;
/** Så många öppna länkar får ett projekt ha samtidigt. */
export const MAP_PROJECT_JOIN_LINKS_MAX = 20;
/** Så många klubbmedlemmar visas åt gången i listan. */
export const MAP_PROJECT_CLUB_MEMBERS_LIMIT = 50;
/** En länk ger aldrig Ägare (den rollen delas ut till en namngiven person). */
export const mapProjectJoinRoleSchema = z.enum(["EDIT", "SUGGEST", "READ"]);

const instantSchema = z.iso.datetime({ offset: true });

export const mapProjectClubMemberAddRequestSchema = z.object({
  formatVersion: z.literal(1), accountId: uuidSchema, role: mapProjectRoleSchema
}).strict();

export const mapProjectJoinLinkCreateRequestSchema = z.object({ formatVersion: z.literal(1), role: mapProjectJoinRoleSchema }).strict();
export const mapProjectJoinLinkRevokeRequestSchema = z.object({ formatVersion: z.literal(1), linkId: uuidSchema }).strict();
/** Länksidan frågar, och tar emot, med nyckeln i kroppen (aldrig i adressen). */
export const mapProjectJoinTokenRequestSchema = z.object({ formatVersion: z.literal(1), token: passwordResetTokenSchema }).strict();

export const mapProjectJoinLinkViewSchema = z.discriminatedUnion("status", [
  z.object({ formatVersion: z.literal(1), status: z.literal("valid"), projectName: z.string().min(1).max(300), role: mapProjectJoinRoleSchema,
    inviterName: z.string().min(1).max(120).nullable(), expiresAt: instantSchema }).strict(),
  /** Okänd, borttagen, gammal eller avsändaren får inte längre hantera medlemmar: samma svar. */
  z.object({ formatVersion: z.literal(1), status: z.literal("invalid") }).strict()
]);

export const mapProjectClubMembersResponseSchema = z.object({
  formatVersion: z.literal(1), clubs: z.array(z.string().max(300)).max(200),
  members: z.array(z.object({ accountId: uuidSchema, name: z.string().max(120), clubNames: z.array(z.string().max(300)).max(200) }).strict()).max(200)
}).strict();
/** Svaret när en länk skapats: nyckeln står bara här. */
export const mapProjectJoinLinkCreatedSchema = z.object({
  formatVersion: z.literal(1), linkId: uuidSchema, token: passwordResetTokenSchema, expiresAt: instantSchema
}).strict();

/** En klubbmedlem som kan läggas till: namn och klubben/klubbarna som delas, aldrig e-postadress. */
export interface MapProjectClubMemberView { accountId: string; name: string; clubNames: string[] }
export interface MapProjectClubMembersResponse { formatVersion: 1; clubs: string[]; members: MapProjectClubMemberView[] }
/** En öppen länk i listan Medlemmar; nyckeln sparas bara som hash och visas bara när länken skapas. */
export interface MapProjectJoinLinkView { linkId: string; role: MapProjectRole; createdAt: string; expiresAt: string }

export type MapProjectJoinLinkInfo = z.infer<typeof mapProjectJoinLinkViewSchema>;
