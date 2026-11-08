import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MAP_PROJECT_NEW_MAX_SIDE_M, mapProjectNewRequestSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  MAP_READER_VERSION, newMapFile, projectedToMapPoint, readMapFile, wgs84ToProjected, type ProjectedPoint
} from "@o-tid/map-file";
import { areaPolygonProblem } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { addMapProjectMember } from "./map-project-access";
import { storeMapContent, mapStorageQuota } from "./map-content";
import { authenticateUserAccountSessionForMutation } from "./user-account";

const SWEREF99TM = { kind: "EPSG", code: 3006 } as const;

export type MapProjectNewFailure = ClubFailure | { status: "quota" } | { status: "area-too-large" };

/**
 * ADR-0219 (K1, nya kartor): ett eget projekt med en ny tom karta (alla inloggade, ingen klubb). Området räknas om till
 * SWEREF 99 TM; kartans referenspunkt är mitten av områdets omslutande rektangel (avrundad till meter) och området sparas i
 * kartans mm. Kartfilen (`newMapFile`, O-Tids symbolset) är grundfilen som vilken uppladdad fil som helst.
 */
export async function createMapProjectNew(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<MapProjectNewFailure | { status: "created"; replayed: boolean; projectId: string }> {
  const parsed = mapProjectNewRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const accountId = auth.principal.accountId;
    const request = parsed.data;
    const [prior] = await tx.select().from(schema.mapProjects).where(eq(schema.mapProjects.requestId, request.requestId));
    if (prior) {
      return prior.createdBy === accountId && prior.baseSource === "NEW" ? { status: "created", replayed: true, projectId: prior.id } as const
        : { status: "conflict" } as const;
    }
    const projected = request.area.rings.map(ring => ring.map(([x, y]): ProjectedPoint => request.area.crs === "WGS84"
      ? wgs84ToProjected(SWEREF99TM, y, x) : { easting: x, northing: y }));
    const all = projected.flat();
    const minE = Math.min(...all.map(point => point.easting)), maxE = Math.max(...all.map(point => point.easting));
    const minN = Math.min(...all.map(point => point.northing)), maxN = Math.max(...all.map(point => point.northing));
    if (!(maxE - minE > 0 && maxN - minN > 0)) return { status: "invalid-request" } as const;
    if (maxE - minE > MAP_PROJECT_NEW_MAX_SIDE_M || maxN - minN > MAP_PROJECT_NEW_MAX_SIDE_M) return { status: "area-too-large" } as const;
    const refPoint = { easting: Math.round((minE + maxE) / 2), northing: Math.round((minN + maxN) / 2) };
    let bytes: Uint8Array;
    try {
      bytes = newMapFile({ symbolSet: request.symbolSet, scale: request.scale, refPoint, declinationDegrees: request.declination,
        notes: `${request.name}. Ny karta från O-Tid.` });
    } catch {
      // Utanför Sverige eller en skala normen inte har.
      return { status: "invalid-request" } as const;
    }
    const georef = readMapFile(bytes, "ny.omap").georeference!;
    const area = projected.map(ring => ring.map(point => {
      const at = projectedToMapPoint(georef, point);
      return { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 };
    }));
    if (areaPolygonProblem(area)) return { status: "invalid-request" } as const;
    const stored = await storeMapContent(tx, bytes, accountId, now, mapStorageQuota());
    if (stored.status === "quota") return stored;
    const projectId = randomUUID();
    await tx.insert(schema.mapProjects).values({ id: projectId, clubId: null, name: request.name, baseVersionId: null,
      baseFileName: `${fileStem(request.name)}.omap`, baseSource: "NEW", baseSha256: stored.sha256, baseFormat: "OMAP",
      readerVersion: MAP_READER_VERSION, status: "OPEN", seq: 0, createdBy: accountId, createdAt: now, requestId: request.requestId, area });
    await addMapProjectMember(tx, { projectId, accountId, role: "OWNER", addedBy: accountId, now });
    return { status: "created", replayed: false, projectId } as const;
  });
}

/** Projektets namn som filnamn: tecken som inte får finnas i filnamn byts mot bindestreck. */
function fileStem(name: string): string {
  const printable = [...name].map(char => char.charCodeAt(0) < 32 ? "-" : char).join("");
  return printable.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 190) || "Karta";
}
