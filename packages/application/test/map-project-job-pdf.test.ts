import { describe, expect, it } from "vitest";
import { mapPdfPaper } from "../src/map-project-job-pdf";

describe("hela kartan som PDF: pappret (ägaren 2026-11-15)", () => {
  it("väljer det minsta A-pappret, liggande för breda kartor", () => {
    expect(mapPdfPaper(250, 150)).toMatchObject({ size: "A4", landscape: true, widthMm: 297, heightMm: 210 });
    expect(mapPdfPaper(150, 250)).toMatchObject({ size: "A4", landscape: false, widthMm: 210, heightMm: 297 });
    expect(mapPdfPaper(380, 260)).toMatchObject({ size: "A3", landscape: true });
  });
  it("ger ett eget papper med marginal när kartan är större än A0", () => {
    expect(mapPdfPaper(2000, 1500)).toMatchObject({ size: null, widthMm: 2020, heightMm: 1520 });
  });
});
