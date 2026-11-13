import { describe, expect, it } from "vitest";
import { wmsFailure } from "./wms-failure";

describe("fel från WMS-hämtningen blir rätt status och kod", () => {
  const answer = async (result: { status: string; code?: string }) => { const response = wmsFailure(result); return [response.status, (await response.json() as { error: string }).error]; };

  it("det användaren kan ändra är 422 med en egen kod", async () => {
    for (const code of ["NOT_HTTPS", "BAD_URL", "PRIVATE_ADDRESS", "NOT_WMS", "NO_LAYER", "NO_SWEREF", "IMAGE_TOO_LARGE", "TOO_MANY_TILES", "NO_FORMAT"]) {
      expect(await answer({ status: "wms", code })).toEqual([422, `WMS_${code}`]);
    }
  });

  it("en tjänst som inte svarar eller svarar fel är 502, kvoten slut är 422 och behörighet följer klubbens fel", async () => {
    expect(await answer({ status: "wms", code: "UNREACHABLE" })).toEqual([502, "WMS_UNREACHABLE"]);
    expect(await answer({ status: "wms", code: "NOT_IMAGE" })).toEqual([502, "WMS_NOT_IMAGE"]);
    expect(await answer({ status: "throttled" })).toEqual([422, "SOURCE_THROTTLED"]);
    expect(wmsFailure({ status: "forbidden" }).status).toBe(403);
    expect(wmsFailure({ status: "not-found" }).status).toBe(404);
  });
});
