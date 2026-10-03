import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteUploadGrantAdmin } from "./route-upload-grant-admin";

describe("TASK111 ruttlänksadministration", () => {
  it("renders a compact private grant shell without a generated bearer link", () => {
    const html = renderToStaticMarkup(<RouteUploadGrantAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Skapa uppladdningslänk");
    expect(html).toContain("Utfärdade uppladdningslänkar");
    expect(html).not.toMatch(/route-upload\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}|secretHash|storeId|versionId/i);
  });
});
