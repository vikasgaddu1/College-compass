import { users, schoolNotes } from '@shared/schema';
import type { User, InsertUser, SchoolNote, UpsertSchoolNote } from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Ensure tables exist even without a migration step.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS school_notes (
    slug TEXT PRIMARY KEY,
    rating INTEGER NOT NULL DEFAULT 0,
    status TEXT,
    pros TEXT NOT NULL DEFAULT '',
    cons TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    visited INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '',
    questions_for_visit TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`);

export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  listNotes(): Promise<SchoolNote[]>;
  getNote(slug: string): Promise<SchoolNote | undefined>;
  upsertNote(patch: UpsertSchoolNote): Promise<SchoolNote>;
  deleteNote(slug: string): Promise<void>;
  clearAllNotes(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async getUserByUsername(username: string) {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  async createUser(insertUser: InsertUser) {
    return db.insert(users).values(insertUser).returning().get();
  }

  async listNotes() {
    return db.select().from(schoolNotes).all();
  }
  async getNote(slug: string) {
    return db.select().from(schoolNotes).where(eq(schoolNotes.slug, slug)).get();
  }
  async upsertNote(patch: UpsertSchoolNote): Promise<SchoolNote> {
    const existing = await this.getNote(patch.slug);
    const now = Date.now();
    if (existing) {
      const updated = { ...existing, ...patch, updated_at: now, slug: patch.slug };
      db.update(schoolNotes).set(updated).where(eq(schoolNotes.slug, patch.slug)).run();
      return updated;
    }
    const row: SchoolNote = {
      slug: patch.slug,
      rating: patch.rating ?? 0,
      status: patch.status ?? null,
      pros: patch.pros ?? "",
      cons: patch.cons ?? "",
      notes: patch.notes ?? "",
      visited: patch.visited ?? 0,
      tags: patch.tags ?? "",
      questions_for_visit: patch.questions_for_visit ?? "",
      updated_at: now,
    };
    db.insert(schoolNotes).values(row).run();
    return row;
  }
  async deleteNote(slug: string) {
    db.delete(schoolNotes).where(eq(schoolNotes.slug, slug)).run();
  }
  async clearAllNotes() {
    db.delete(schoolNotes).run();
  }
}

export const storage = new DatabaseStorage();
