import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * ADR-0197: papperet i utskriften. Bilderna (logotyper) laddas upp en gång per innehåll (PNG eller JPEG, högst 2 MB) och
 * dokumentet pekar på dem med sha256. Mallarna för papperet sparas också i kontots bibliotek för andra tävlingar; mallens
 * form kontrolleras av `@o-tid/course-setting` (`validatePaperTemplate`).
 */
export const PAPER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAPER_TEMPLATE_MAX_BYTES = 64 * 1024;

export const paperImageSchema = z.object({
  formatVersion: z.literal(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mediaType: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000)
}).strict();
export type PaperImageResponse = z.infer<typeof paperImageSchema>;

export const paperLibraryTemplateSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(80),
  updatedAt: z.string(),
  template: z.object({ schemaVersion: z.number().int(), id: z.string() }).loose()
}).strict();

export const paperLibrarySchema = z.object({
  formatVersion: z.literal(1),
  templates: z.array(paperLibraryTemplateSchema).max(200)
}).strict();
export type PaperLibrary = z.infer<typeof paperLibrarySchema>;

export const paperLibrarySaveRequestSchema = z.object({
  formatVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  template: z.object({ schemaVersion: z.number().int(), id: z.string() }).loose()
}).strict();
export type PaperLibrarySaveRequest = z.infer<typeof paperLibrarySaveRequestSchema>;
