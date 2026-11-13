import { fetchMapProjectWmsImage, readMapProjectWmsCapabilities, wmsRuntime, type WmsRuntime } from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson } from "./security-policy";
import { wmsFailure } from "./wms-failure";

/**
 * Ortofoto från en öppen WMS-tjänst (adressen anges av användaren; servern hämtar bara publika https-adresser).
 * POST …/sources/wms/capabilities svarar med tjänstens lager, POST …/sources/wms/image med en bildruta (bilden som svar,
 * världsfilen, koordinatsystemet och rutans nummer och antal i huvudena).
 */
export async function mapProjectWmsCapabilitiesRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: WmsRuntime = wmsRuntime()): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readMapProjectWmsCapabilities(db, { ...input.proof, projectId, request: input.body }, runtime);
    return result.status === "ok" ? privateJson(result.response) : wmsFailure(result);
  });
}

export async function mapProjectWmsImageRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: WmsRuntime = wmsRuntime()): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await fetchMapProjectWmsImage(db, { ...input.proof, projectId, request: input.body }, runtime);
    if (result.status !== "ok") return wmsFailure(result);
    const headers = new Headers(privateHeaders);
    headers.set("content-type", result.mediaType);
    headers.set("x-otid-world", encodeURIComponent(result.world));
    headers.set("x-otid-crs", String(result.crs));
    headers.set("x-otid-tile", String(result.tile));
    headers.set("x-otid-tiles", String(result.tiles));
    return new Response(new Uint8Array(result.image), { status: 200, headers });
  });
}
