import { bigint, boolean, date, index, integer, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * ADR-0216 (migration 0085): serverns veckorapport och larm till superadmin. Inga personuppgifter: bara storlekar, antal och
 * vilka slags larm som skickats till hur många.
 */
export type ServerNoticeKind = "WEEKLY_REPORT" | "DISK" | "MAP_QUOTA" | "BACKUP" | "HEALTH" | "MEMORY";

/** En mätning per varv (förval var 15:e minut) för trenden, prognosen och belastningstopparna. */
export const serverSamples = pgTable("server_sample", {
  sampledAt: timestamp("sampled_at", { withTimezone: true }).primaryKey(),
  diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }),
  diskFreeBytes: bigint("disk_free_bytes", { mode: "number" }),
  databaseBytes: bigint("database_bytes", { mode: "number" }).notNull(),
  mapBytes: bigint("map_bytes", { mode: "number" }).notNull(),
  backupBytes: bigint("backup_bytes", { mode: "number" }),
  loadMax: real("load_max"),
  loadMaxAt: timestamp("load_max_at", { withTimezone: true }),
  memoryTotalBytes: bigint("memory_total_bytes", { mode: "number" }),
  memoryAvailableMinBytes: bigint("memory_available_min_bytes", { mode: "number" })
});

/**
 * Läget per sorts larm och när veckorapporten senast skickades. Läses och skrivs med rå SQL (`server-status.ts`, låsning
 * med `for update`); tabellen står här för schemats skull.
 * @public
 */
export const serverNotices = pgTable("server_notice", {
  kind: text("kind").$type<ServerNoticeKind>().primaryKey(),
  activeSince: timestamp("active_since", { withTimezone: true }),
  alerted: boolean("alerted").notNull().default(false),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  detail: text("detail")
});

/** Det som skickats: larm, löst och veckorapporter. */
export const serverNoticeLog = pgTable("server_notice_log", {
  id: uuid("id").primaryKey(),
  kind: text("kind").$type<ServerNoticeKind>().notNull(),
  status: text("status").$type<"ALERT" | "RESOLVED" | "REPORT">().notNull(),
  detail: text("detail"),
  recipients: integer("recipients").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull()
}, (table) => [index("server_notice_log_sent_idx").on(table.sentAt)]);

/**
 * Besöksstatistiken (migration 0138): dygnets slumpade salt (finns bara under dygnet, svensk tid), dygnets hashar per steg
 * (HMAC av adress och webbläsare, för att räkna unika) och antalet per dag och steg som finns kvar. Läses och skrivs med rå SQL
 * (`visitor-stats.ts`); tabellerna står här för schemats skull.
 * @public
 */
export const visitorDaySalts = pgTable("visitor_day_salt", {
  day: date("day").primaryKey(),
  salt: text("salt").notNull()
});

/** @public */
export const visitorHits = pgTable("visitor_hit", {
  day: date("day").notNull(),
  step: text("step").notNull(),
  hash: text("hash").notNull()
}, (table) => [primaryKey({ columns: [table.day, table.step, table.hash] })]);

/** @public */
export const visitorDayCounts = pgTable("visitor_day_count", {
  day: date("day").notNull(),
  step: text("step").notNull(),
  visitors: integer("visitors").notNull()
}, (table) => [primaryKey({ columns: [table.day, table.step] })]);
