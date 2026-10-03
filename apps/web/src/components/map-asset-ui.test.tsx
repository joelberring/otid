import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapAssetAdmin } from "./map-asset-admin";
import { MapGeoreferenceAdmin } from "./map-georeference-admin";
import { PublicMapViewer } from "./public-map-viewer";

const raceId = "10000000-0000-4000-8000-000000000001";

describe("TASK106 kartsläppets användargränssnitt", () => {
  it("renders the private admin shell without storage identifiers", () => {
    const html = renderToStaticMarkup(<MapAssetAdmin raceId={raceId} />);
    expect(html).toContain("Ladda upp en renderbar PNG- eller JPEG-karta");
    expect(html).toContain("PNG- eller JPEG-fil");
    expect(html).toContain("Lagrade kartor");
    expect(html).not.toMatch(/bucket|storeId|versionId|objectKey/i);
  });

  it("renders a responsive public viewer through only the public race path", () => {
    const html = renderToStaticMarkup(<PublicMapViewer raceId={raceId} title="Skärgårdshelgen lång" />);
    expect(html).toContain(`/api/public/races/${raceId}/map`);
    expect(html).toContain("Zooma in");
    expect(html).toContain("Visa hela kartan");
    expect(html).not.toMatch(/bucket|storeId|versionId|objectKey/i);
  });

  it("keeps the private calibration form separate from public map and route paths", () => {
    const html = renderToStaticMarkup(<MapGeoreferenceAdmin raceId={raceId} />);
    expect(html).toContain("Kalibrera en privat PNG/JPEG-karta");
    expect(html).not.toMatch(/api\/public|gpx|route|livelox|objectKey|bucket|storeId|versionId/i);
  });
});
