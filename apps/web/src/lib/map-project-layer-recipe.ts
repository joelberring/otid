import { LAYER_RECIPE_PATHS, layerRecipeSchema, type LayerRecipe } from "@o-tid/contracts";
import { csrf } from "./club-request";
import { LayerFileError } from "./map-project-layer-file";

/**
 * PLAN.md steg M4: receptet för ett hämtat underlag. Det skickas med när bilden läggs in (då är den återskapbar) och används
 * när bilden tagits bort ur förrådet: samma anrop görs igen (servern hämtar bilden åt webbläsaren, eller ortofotot läses ur
 * Lantmäteriets COG) och bilden ersätts i samma underlag.
 */

/** Receptet ur underlagets svar, om det är ett som webbläsaren kan hämta om (laserkörningens återskapas med körningen). */
export function layerRecipeOf(stored: unknown): LayerRecipe | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const rest: Record<string, unknown> = { ...stored as Record<string, unknown> };
  delete rest.createdAt;
  const parsed = layerRecipeSchema.safeParse(rest);
  return parsed.success ? parsed.data : undefined;
}

/** Bilden och världsfilen ur serverns hämtning (markfuktigheten, Skogsstyrelsen, WMS), med samma kropp som första gången. */
export async function fetchRecipeImage(base: string, recipe: Exclude<LayerRecipe, { source: "LM_ORTHO" }>): Promise<{ files: File[]; crs: number }> {
  const token = csrf();
  const response = await fetch(`${base}/sources/${LAYER_RECIPE_PATHS[recipe.source]}`, { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json", ...(token ? { "x-otid-csrf": token } : {}) }, body: JSON.stringify(recipe.request) })
    .catch(() => undefined);
  if (!response?.ok) throw new LayerFileError("UNAVAILABLE");
  const jpeg = (response.headers.get("content-type") ?? "").includes("jpeg");
  const world = decodeURIComponent(response.headers.get("x-otid-world") ?? "");
  const crs = Number(response.headers.get("x-otid-crs") ?? 3006) || 3006;
  return { crs, files: [new File([await response.blob()], jpeg ? "underlag.jpg" : "underlag.png", { type: jpeg ? "image/jpeg" : "image/png" }),
    new File([world], jpeg ? "underlag.jgw" : "underlag.pgw", { type: "text/plain" })] };
}
