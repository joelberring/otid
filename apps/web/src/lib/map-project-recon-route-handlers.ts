import {
  addMapProjectTrackPart, changeMapProjectChecks, createMapProjectNote, createMapProjectTrack, deleteMapProjectNote, deleteMapProjectTrack,
  listMapProjectChecks, listMapProjectNotes, listMapProjectTracks, mapProjectTrackPoints, readMapProjectNotePhoto, updateMapProjectNote,
  updateMapProjectTrack
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson } from "./security-policy";

/**
 * ADR-0219 tillägget om rekningen (K3): spåren, bekräftelserna och notiserna under /api/organizer/map-projects/[projectId]. Samma skydd som
 * projektets övriga anrop (exakt Origin och CSRF på skrivningar, privata svar utan cache, 404 för den som inte är medlem).
 * Spåren är personuppgifter: aldrig publika och aldrig via delade länkar.
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);
/** En del med 2 000 punkter är omkring 100 kB som JSON. */
const TRACK_PART_MAX_BYTES = 256 * 1024;
const CHECKS_MAX_BYTES = 512 * 1024;
/** En notis med ett foto på 2 MB i base64. */
const NOTE_MAX_BYTES = 3 * 1024 * 1024;

/** GET projektets spår (alla medlemmar), POST nytt eget spår. */
export async function mapProjectTracksRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectTracks(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectTrack(db, { ...input.proof, projectId, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, track: result.track }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

/** GET spårets punkter, PUT byt namn (eget), DELETE ta bort (eget). */
export async function mapProjectTrackRoute(db: Database, request: Request, projectId: string, trackId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(trackId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await mapProjectTrackPoints(db, { ...input.proof, projectId, trackId });
      return result.status === "ok" ? privateJson(result.points) : failure(result.status);
    });
  }
  if (request.method === "DELETE") {
    const input = await mutation(request, environment, "none");
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await deleteMapProjectTrack(db, { ...input.proof, projectId, trackId });
      return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateMapProjectTrack(db, { ...input.proof, projectId, trackId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, track: result.track }) : failure(result.status);
  });
}

/** POST en del av ett eget spår. */
export async function mapProjectTrackPartsRoute(db: Database, request: Request, projectId: string, trackId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(trackId)) return failure("not-found");
  const input = await mutation(request, environment, "json", TRACK_PART_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await addMapProjectTrackPart(db, { ...input.proof, projectId, trackId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, track: result.track }) : failure(result.status);
  });
}

/** GET bekräftelserna (alla medlemmar), POST bekräfta och ta bort bekräftelser (Föreslå eller mer). */
export async function mapProjectChecksRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectChecks(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", CHECKS_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await changeMapProjectChecks(db, { ...input.proof, projectId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, set: result.set, cleared: result.cleared }) : failure(result.status);
  });
}

/** GET projektets notiser (alla medlemmar), POST ny notis (Föreslå eller mer; ett för stort foto ger 413). */
export async function mapProjectNotesRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectNotes(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", NOTE_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectNote(db, { ...input.proof, projectId, request: input.body });
    if (result.status === "too-large") return privateJson({ formatVersion: 1, error: "TOO_LARGE" }, 413);
    return result.status === "created" ? privateJson({ formatVersion: 1, note: result.note }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

/** PUT klar eller öppen igen, DELETE ta bort (den som skrev notisen eller ägarna). */
export async function mapProjectNoteRoute(db: Database, request: Request, projectId: string, noteId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(noteId)) return failure("not-found");
  if (request.method === "DELETE") {
    const input = await mutation(request, environment, "none");
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await deleteMapProjectNote(db, { ...input.proof, projectId, noteId });
      return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateMapProjectNote(db, { ...input.proof, projectId, noteId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, note: result.note }) : failure(result.status);
  });
}

/** GET notisens foto (alla medlemmar), som banläggningens notiser: privat, ingen typgissning, sandlåda. */
export async function mapProjectNotePhotoRoute(db: Database, request: Request, projectId: string, noteId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId) || !validId(noteId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readMapProjectNotePhoto(db, { ...input.proof, projectId, noteId });
    if (result.status !== "ok") return failure(result.status);
    return new Response(new Uint8Array(result.photo), { headers: { ...privateHeaders, "content-type": result.mediaType,
      "content-length": String(result.photo.byteLength), "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  });
}
