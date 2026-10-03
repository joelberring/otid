import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clearRouteUploadGrantMaterial, createRouteUploadGrantMaterial, routeUploadGrantLink } from "./route-upload-grant-client";

const entryId = "10000000-0000-4000-8000-000000000001";

describe("TASK111 private route grant client material", () => {
  it("keeps the 32-byte bearer secret browser-local until a canonical link is deliberately made", async () => {
    const material = await createRouteUploadGrantMaterial(entryId, 7, new Date("2026-09-20T12:00:00.000Z"));
    expect(material.secret).toHaveLength(32);
    expect(material.secretHash).toBe(createHash("sha256").update(material.secret).digest("hex"));
    expect(material.expiresAt).toBe("2026-09-27T12:00:00.000Z");
    expect(routeUploadGrantLink(material, "https://otid.example")).toMatch(new RegExp(`^https://otid\\.example/route-upload/${material.grantId}/[A-Za-z0-9_-]{43}$`));
    clearRouteUploadGrantMaterial(material);
    expect([...material.secret]).toEqual(new Array(32).fill(0));
  });
});
