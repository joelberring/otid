import { z } from "zod";
import { uuidSchema } from "./ids";
import type { ClubRole } from "./club-archive";

/**
 * ADR-0208: kartrevideringen i klubbarkivet. Ändringarna prövas i sig av `@o-tid/map-revision` (`editProblem`); här är
 * anropens kuvert. Synken är ett anrop: egna ändringar in, allt som ändrats sedan `since` ut.
 */
export const MAP_REVISION_SYNC_MAX_EDITS = 200;
export const MAP_REVISION_SYNC_MAX_BYTES = 4 * 1024 * 1024;
/** Högst så många ändringar i loggen per revidering (skydd mot en klient som skickar utan slut). */
export const MAP_REVISION_MAX_EDITS = 100_000;

export const mapRevisionTitleSchema = z.string().trim().min(1).max(120);

export const mapRevisionCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, baseVersionId: uuidSchema, title: mapRevisionTitleSchema
}).strict();

export const mapRevisionStatusRequestSchema = z.object({ formatVersion: z.literal(1), status: z.enum(["OPEN", "CLOSED"]) }).strict();

export const mapRevisionSyncRequestSchema = z.object({
  formatVersion: z.literal(1),
  /** Telefonens eller datorns id (slumpat en gång per webbläsare). */
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  since: z.number().int().min(0),
  edits: z.array(z.unknown()).max(MAP_REVISION_SYNC_MAX_EDITS)
}).strict();

export const mapRevisionVersionRequestSchema = z.object({ formatVersion: z.literal(1), requestId: uuidSchema }).strict();

export type MapRevisionCreateRequest = z.infer<typeof mapRevisionCreateRequestSchema>;
export type MapRevisionSyncRequest = z.infer<typeof mapRevisionSyncRequestSchema>;

export type MapRevisionStatus = "OPEN" | "CLOSED";

export interface MapRevisionSummary {
  revisionId: string; title: string; status: MapRevisionStatus;
  base: { versionId: string; mapId: string; mapName: string; fileName: string; format: "OCD" | "OMAP"; versionDate: string | null };
  createdAt: string; closedAt: string | null;
  /** Antal objekt som inte är som i grundfilen. */
  changedObjects: number;
  result: { versionId: string; fileName: string } | null;
}

export interface MapRevisionParticipantView {
  accountId: string; displayName: string; role: ClubRole | null; edits: number; lastSeenAt: string | null; lastEditAt: string | null;
}

export interface MapRevisionView {
  formatVersion: 1;
  clubId: string; clubName: string;
  revision: MapRevisionSummary & { sha256: string; byteLength: number; readerVersion: number };
  viewer: { accountId: string; role: ClubRole; canEdit: boolean; canCreateVersion: boolean };
  participants: MapRevisionParticipantView[];
  /** Kartans senaste version om den inte är grundversionen (grundfilen har ändrats på annat håll). */
  newerVersion: { versionId: string; fileName: string; versionDate: string | null; uploadedAt: string } | null;
}

export interface MapRevisionList { formatVersion: 1; revisions: MapRevisionSummary[] }

/** Objektets läge på servern som det skickas (samma som `ServerObject` i `@o-tid/map-revision`). */
export interface MapRevisionObjectWire {
  key: string; ref: unknown; state: unknown; lastEditId: string; version: number; seq: number; authorId: string; at: string;
}

export type MapRevisionEditResultWire =
  | { editId: string; status: "APPLIED" | "DUPLICATE"; object: MapRevisionObjectWire }
  | { editId: string; status: "CONFLICT"; current: MapRevisionObjectWire | null }
  | { editId: string; status: "REJECTED"; reason: string };

export interface MapRevisionSyncResponse {
  formatVersion: 1; seq: number; status: MapRevisionStatus; results: MapRevisionEditResultWire[]; objects: MapRevisionObjectWire[];
}

export interface MapRevisionLogEntry {
  editId: string; key: string; kind: string; status: "APPLIED" | "CONFLICT"; authorId: string; editedAt: string; receivedAt: string;
}

export interface MapRevisionLog { formatVersion: 1; entries: MapRevisionLogEntry[]; truncated: boolean }

/** Skrivarens svar när en ny kartversion inte gick att skapa (visas som det är). */
export type MapRevisionWriteProblem =
  | "NO_CHANGES" | "NEWER_VERSION" | "WRITER_UNAVAILABLE" | "WRITER_REFUSED" | "VERIFICATION_FAILED" | "CLOSED" | "QUOTA";

export interface MapRevisionVersionResponse {
  formatVersion: 1;
  versionId: string; fileName: string; note: string; changes: number;
  verification: string[];
}

export interface MapRevisionVersionProblem { formatVersion: 1; error: MapRevisionWriteProblem; detail: string | null }
