import { mapProjectForestImageRequestSchema, type ForestImageProduct } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { validOsmBox } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubProof } from "./club-access";
import { imageDimensions } from "./image-dimensions";
import { requireMapProject } from "./map-project-access";
import { moistureRequestBox, type MoistureFailure } from "./map-project-moisture";

/**
 * Ägaren 2026-11-11 («reglage så att man kan tända/släcka bakgrundsinfo från Skogsstyrelsen»): Skogsstyrelsens öppna
 * kartbilder (ArcGIS REST, `export` och `exportImage`) för rutan i SWEREF 99 TM, som underlag i projektet: utförda
 * avverkningar, avverkningsanmälningar och nyckelbiotoper. Bilden och världsfilen som svar, som för
 * markfuktigheten; inget sparas här.
 */
const PRODUCTS: Readonly<Record<ForestImageProduct, { readonly service: string; readonly image: boolean }>> = {
  CLEAR_CUTS: { service: "Geodataportal/GeodataportalVisaUtfordavverkning/MapServer", image: false },
  NOTIFIED: { service: "Geodataportal/GeodataportalVisaAvverkningsanmalan/MapServer", image: false },
  KEY_BIOTOPES: { service: "Geodataportal/GeodataportalVisaNyckelbiotop/MapServer", image: false }
};
// Trädhöjden (geodata.skogsstyrelsen.se/…/Publikt/Tradhojd_3_0) kräver inloggning (401, provat 2026-11-11) och är inte med.
export const FOREST_IMAGE_ATTRIBUTION = "© Skogsstyrelsen";
const FETCHES_PER_HOUR = 30;
const MAX_BYTES = 40 * 1024 * 1024;

export interface ForestImageRuntime { readonly geodataportal: string; readonly publikt: string; readonly fetch?: typeof fetch }
export function forestImageRuntimeFromEnvironment(environment: Record<string, string | undefined>): ForestImageRuntime {
  const base = environment.OTID_SKS_REST_URL?.trim();
  return { geodataportal: base || "https://geodpags.skogsstyrelsen.se/arcgis/rest/services", publikt: base || "https://geodata.skogsstyrelsen.se/arcgis/rest/services" };
}

export async function fetchMapProjectForestImage(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: ForestImageRuntime,
  now = new Date()): Promise<MoistureFailure | { status: "ok"; png: Uint8Array; world: string; crs: 3006; attribution: string }> {
  const parsed = mapProjectForestImageRequestSchema.safeParse(input.request);
  const allowed = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    if (!validOsmBox(parsed.data.box)) return { status: "too-large" } as const;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: access.accountId, limit: FETCHES_PER_HOUR, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok" } as const;
  });
  if (allowed.status !== "ok") return allowed;
  const box = moistureRequestBox(parsed.data!.box);
  const product = PRODUCTS[parsed.data!.product];
  const base = product.service.startsWith("Publikt/") ? runtime.publikt : runtime.geodataportal;
  const query = new URLSearchParams({ bbox: [box.minE, box.minN, box.maxE, box.maxN].join(","), bboxSR: "3006", imageSR: "3006",
    size: `${box.width},${box.height}`, format: product.image ? "png" : "png32", transparent: "true", f: "image" });
  try {
    const response = await (runtime.fetch ?? fetch)(`${base}/${product.service}/${product.image ? "exportImage" : "export"}?${query}`,
      { redirect: "error", signal: AbortSignal.timeout(60_000), headers: { "user-agent": "O-Tid kartprojekt" } });
    if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return { status: "too-large" };
    if (imageDimensions(bytes)?.mediaType !== "image/png") return { status: "unavailable", detail: "format" };
    return { status: "ok", png: bytes, world: box.world, crs: 3006, attribution: FOREST_IMAGE_ATTRIBUTION };
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
