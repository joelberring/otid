import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clubInvitations } from "./clubs";
import { trainingGroupInvitations } from "./groups";
import { mapProjectInvitations } from "./map-projects";
import { racePersonInvitations } from "./planning";

/**
 * ADR-0206 (migration 0073): en länk till en sparad inbjudan, mejlad (`MAIL`) eller kopierad av administratören (`LINK`).
 * Exakt en av de fyra inbjudningarna (kartprojektets sedan 0089, ADR-0219). Bara hashen av nyckeln sparas; mottagaren bara som HMAC (för spärren).
 */
export type InvitationLinkDelivery = "MAIL" | "LINK";

export const invitationLinks = pgTable("invitation_link", {
  id: uuid("id").primaryKey(),
  clubInvitationId: uuid("club_invitation_id").references(() => clubInvitations.id),
  raceInvitationId: uuid("race_invitation_id").references(() => racePersonInvitations.id),
  groupInvitationId: uuid("group_invitation_id").references(() => trainingGroupInvitations.id),
  mapProjectInvitationId: uuid("map_project_invitation_id").references(() => mapProjectInvitations.id),
  tokenHash: text("token_hash").notNull(),
  recipientKey: text("recipient_key").notNull(),
  /**
   * Kontot som skickade eller kopierade länken. Utan främmande nyckel sedan migration 0088 (som K4): borttagningen av ett konto
   * följer nycklarna och tog annars bort länkarna i mejl som kontot skickat. Kan alltså peka på ett konto som inte finns.
   */
  issuedBy: uuid("issued_by").notNull(),
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
