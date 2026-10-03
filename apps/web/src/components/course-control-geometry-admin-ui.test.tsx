import { readFileSync } from "node:fs";
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseControlGeometryAdmin } from "./course-control-geometry-admin";

describe("CourseControlGeometryAdmin", () => {
  it("is a compact private map-admin panel without public or route data paths", () => {
    const html = renderToStaticMarkup(<CourseControlGeometryAdmin raceId="0198e35a-5f4e-7000-8000-000000000001" />);
    const source = readFileSync(new URL("./course-control-geometry-admin.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(html).toContain("Banans kontrollpositioner");
    expect(source).toContain("/course-control-geometries");
    expect(source).not.toMatch(/\/api\/public|route-upload|latitude|longitude|storeId|objectKey/i);
    expect(css).toContain(".course-control-geometry-point");
  });
});
