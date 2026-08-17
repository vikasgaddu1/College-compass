import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/**
 * Per-school personal notes. One row per school slug (upserted).
 *  - rating: 0 (unrated) or 1-5 stars — the applicant's own gut score
 *  - status: "considering" | "shortlist" | "backup" | "ruled_out" | null
 *  - pros / cons: newline-separated short bullets the applicant enters
 *  - notes: freeform Markdown-ish text
 *  - visited: whether the applicant has toured campus
 *  - tags: comma-separated labels
 *  - questions_for_visit: list of questions to ask on the visit
 *  - updated_at: epoch millis, refreshed on any write
 */
export const schoolNotes = sqliteTable("school_notes", {
  slug: text("slug").primaryKey(),
  rating: integer("rating").notNull().default(0),
  status: text("status"),
  pros: text("pros").notNull().default(""),
  cons: text("cons").notNull().default(""),
  notes: text("notes").notNull().default(""),
  visited: integer("visited").notNull().default(0),
  tags: text("tags").notNull().default(""),
  questions_for_visit: text("questions_for_visit").notNull().default(""),
  updated_at: integer("updated_at").notNull().default(0),
});

export type SchoolNote = typeof schoolNotes.$inferSelect;
export type UpsertSchoolNote = Partial<Omit<SchoolNote, "slug" | "updated_at">> & { slug: string };
