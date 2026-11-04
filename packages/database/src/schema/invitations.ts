import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { clubInvitations } from "./clubs";
import { trainingGroupInvitations } from "./groups";
import { racePersonInvitations } from "./planning";

/**
 * ADR-0206 (migration 0073): en länk till en sparad inbjudan, mejlad (`MAIL`) eller kopierad av administratören (`LINK`).
 * Exakt en av de tre inbjudningarna. Bara hashen av nyckeln sparas; mottagaren bara som HMAC (för spärren).
 */
export type InvitationLinkDelivery = "MAIL" | "LINK";

export const invitationLinks = pgTable("invitation_link", {
  id: uuid("id").primaryKey(),
  clubInvitationId: uuid("club_invitation_id").references(() => clubInvitations.id),
  raceInvitationId: uuid("race_invitation_id").references(() => racePersonInvitations.id),
  groupInvitationId: uuid("group_invitation_id").references(() => trainingGroupInvitations.id),
  tokenHash: text("token_hash").notNull(),
  recipientKey: text("recipient_key").notNull(),
  issuedBy: uuid("issued_by").notNull().references(() => userAccounts.id),
  delivery: text("delivery").$type<InvitationLinkDelivery>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  replacedAt: timestamp("replaced_at", { withTimezone: true })
}, (table) => [
  uniqueIndex("invitation_link_token_hash_key").on(table.tokenHash),
  index("invitation_link_issuer_idx").on(table.issuedBy, table.createdAt),
  index("invitation_link_recipient_idx").on(table.recipientKey, table.createdAt)
]);
