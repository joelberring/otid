import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clubs } from "./clubs";

/** ADR-0221 (migration 0109): klubbens terminsplanering, de planerade träningarna och uppgifterna. */
export const clubTerms = pgTable("club_term", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id").notNull()
});

export const clubPlanSessions = pgTable("club_plan_session", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  termId: uuid("term_id").notNull().references(() => clubTerms.id),
  sessionDate: date("session_date").notNull(),
  startTime: text("start_time"),
  title: text("title").notNull(),
  place: text("place").notNull().default(""),
  note: text("note").notNull().default(""),
  clubMapId: uuid("club_map_id"),
  trainingGroupId: uuid("training_group_id"),
  responsibleAccountId: uuid("responsible_account_id"),
  raceId: uuid("race_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  requestId: uuid("request_id").notNull()
});

export const clubPlanTasks = pgTable("club_plan_task", {
  id: uuid("id").primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => clubPlanSessions.id),
  title: text("title").notNull(),
  assigneeAccountId: uuid("assignee_account_id"),
  assigneeEmail: text("assignee_email"),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id").notNull()
});
