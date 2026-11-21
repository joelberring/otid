import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clubs } from "./clubs";
import { bytea } from "./types";

/** Nyhetsflödet «Nytt i O-Tid» (ADR-0230, migration 0134). `clubId` NULL = allmän nyhet. */
export const newsItems = pgTable("news_item", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  clubId: uuid("club_id").references(() => clubs.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  image: bytea("image"),
  imageMediaType: text("image_media_type").$type<"image/webp" | "image/jpeg" | "image/png">(),
  imageWidth: integer("image_width"),
  imageHeight: integer("image_height"),
  imageSha256: text("image_sha256"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});
