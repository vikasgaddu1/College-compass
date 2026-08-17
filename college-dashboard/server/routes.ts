import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // List every note
  app.get("/api/notes", async (_req, res) => {
    const rows = await storage.listNotes();
    res.json(rows);
  });

  // Get a single note
  app.get("/api/notes/:slug", async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const row = await storage.getNote(slug);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });

  // Upsert (partial update) — the body is a patch, slug comes from URL
  app.put("/api/notes/:slug", async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      const patch = { ...req.body, slug };
      const row = await storage.upsertNote(patch);
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "bad request" });
    }
  });

  // Delete
  app.delete("/api/notes/:slug", async (req: Request, res: Response) => {
    await storage.deleteNote(String(req.params.slug));
    res.json({ ok: true });
  });

  // Nuke all — used by "clear notebook"
  app.delete("/api/notes", async (_req, res) => {
    await storage.clearAllNotes();
    res.json({ ok: true });
  });

  return httpServer;
}
