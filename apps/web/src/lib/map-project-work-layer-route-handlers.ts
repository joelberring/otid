import {
  createMapProjectSketch, createMapProjectWorkLayer, deleteMapProjectSketch, deleteMapProjectWorkLayer, listMapProjectWorkLayers, updateMapProjectWorkLayer
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/**
 * ADR-0219 (ägaren 2026-11-09, lagren fas 2): arbetslager och skisslager under /api/organizer/map-projects/[projectId]. Samma
 * skydd som projektets övriga anrop (exakt Origin och CSRF på skrivningar, privata svar, 404 för den som inte är medlem).
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);
/** En skiss har högst 2 000 punkter (omkring 60 kB som JSON). */
const SKETCH_MAX_BYTES = 128 * 1024;

/** GET lagren och skisserna (alla medlemmar), POST nytt lager (Föreslå eller mer). */
export async function mapProjectWorkLayersRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectWorkLayers(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectWorkLayer(db, { ...input.proof, projectId, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, layer: result.layer }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

/** PUT namn, symboler eller färg, DELETE lagret (den som skapade det eller ägarna). */
export async function mapProjectWorkLayerRoute(db: Database, request: Request, projectId: string, layerId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(layerId)) return failure("not-found");
  if (request.method === "DELETE") {
    const input = await mutation(request, environment, "none");
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await deleteMapProjectWorkLayer(db, { ...input.proof, projectId, layerId });
      return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateMapProjectWorkLayer(db, { ...input.proof, projectId, layerId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, layer: result.layer }) : failure(result.status);
  });
}

/** POST ny skiss (Föreslå eller mer). */
export async function mapProjectSketchesRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await mutation(request, environment, "json", SKETCH_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectSketch(db, { ...input.proof, projectId, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, sketch: result.sketch }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

/** DELETE skissen (den som ritade den eller ägarna). */
export async function mapProjectSketchRoute(db: Database, request: Request, projectId: string, sketchId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(sketchId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await deleteMapProjectSketch(db, { ...input.proof, projectId, sketchId });
    return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
  });
}
