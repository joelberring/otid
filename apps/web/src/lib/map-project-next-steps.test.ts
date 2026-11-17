import { describe, expect, it } from "vitest";
import type { MapProjectView } from "@o-tid/contracts";
import { mapProjectSteps } from "./map-project-next-steps";

const view = (source: MapProjectView["base"]["source"], changedObjects: number, outputs = 0) =>
  ({ base: { source } as MapProjectView["base"], changedObjects, outputs: Array.from({ length: outputs }, () => ({}) as MapProjectView["outputs"][number]) });

describe("kartprojektets nästa steg", () => {
  it("en ny tom karta börjar med underlaget", () => {
    expect(mapProjectSteps(view("NEW", 0))).toEqual({ done: { base: false, draw: false, export: false, courses: false }, next: "base" });
  });
  it("en befintlig karta har underlaget och börjar med att rita", () => {
    expect(mapProjectSteps(view("UPLOAD", 0))).toEqual({ done: { base: true, draw: false, export: false, courses: false }, next: "draw" });
    expect(mapProjectSteps(view("ARCHIVE", 0)).next).toBe("draw");
  });
  it("med ändrade objekt är nästa steg att kontrollera och exportera", () => {
    expect(mapProjectSteps(view("NEW", 12))).toEqual({ done: { base: true, draw: true, export: false, courses: false }, next: "export" });
  });
  it("med en ny kartversion är nästa steg banorna, som aldrig blir klara här", () => {
    expect(mapProjectSteps(view("UPLOAD", 3, 1))).toEqual({ done: { base: true, draw: true, export: true, courses: false }, next: "courses" });
  });
});
