import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteUploadForm } from "./route-upload-form";

describe("TASK112 privat GPX-kvittens", () => {
  it("waits for the token-free status lookup without server-side identifiers", () => {
    const html = renderToStaticMarkup(<RouteUploadForm />);
    expect(html).toContain("Kontrollerar den privata uppladdningslänken");
    expect(html).not.toMatch(/grantId|uploadId|storeId|versionId|objectKey|bearer/i);
  });
});
