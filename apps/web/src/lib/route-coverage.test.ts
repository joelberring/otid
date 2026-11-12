import { describe, expect, it } from "vitest";
import { raceMapSv } from "../i18n/race-map-sv";
import { routeCoversNothing, timeSpan } from "./route-coverage";

describe("rutt som inte täcker någon sträcka (användartestet 2026-11-12)", () => {
  it("märks bara när löparen har sträckor och ingen täcks", () => {
    expect(routeCoversNothing({ coveredLegs: 0, legs: 6 })).toBe(true);
    expect(routeCoversNothing({ coveredLegs: 1, legs: 6 })).toBe(false);
    expect(routeCoversNothing({ coveredLegs: 0, legs: 0 })).toBe(false);
  });

  it("säger ruttens och loppets tider i tävlingens tidszon", () => {
    const route = timeSpan("2026-10-18T07:00:00.000Z", "2026-10-18T07:40:00.000Z", "Europe/Stockholm");
    const run = timeSpan("2026-11-12T05:43:00.000Z", "2026-11-12T06:13:00.000Z", "Europe/Stockholm");
    expect(route).toBe("2026-10-18 09:00–09:40");
    expect(run).toBe("2026-11-12 06:43–07:13");
    expect(timeSpan("2026-11-12T22:30:00.000Z", "2026-11-12T23:30:00.000Z", "Europe/Stockholm")).toBe("2026-11-12 23:30–2026-11-13 00:30");
    expect(timeSpan(undefined, undefined, "Europe/Stockholm")).toBeUndefined();
    expect(raceMapSv.routes.coversNothing("Ada Löpare", route, run)).toBe("Rutten för Ada Löpare är sparad men täcker ingen sträcka. " +
      "Kontrollera att filen är från rätt dag och att klockans tid stämmer: rutten går 2026-10-18 09:00–09:40, löparens lopp 2026-11-12 06:43–07:13.");
    expect(raceMapSv.routes.coversNothing("Ada Löpare", undefined, undefined)).toBe("Rutten för Ada Löpare är sparad men täcker ingen sträcka. " +
      "Kontrollera att filen är från rätt dag och att klockans tid stämmer.");
  });
});
