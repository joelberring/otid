import { describe, expect, it } from "vitest";
import { moreSettings, OTIDGEO_MORE_SETTINGS, PULLAUTIN_MORE_SETTINGS } from "./map-project-laser-panel";

describe("Laserpanelens avancerade inställningar", () => {
  it("tar tal inom gränserna, med komma eller punkt, för både pullautin och otidgeo", () => {
    expect(moreSettings({ cliff1: "1,2", greenhigh: "3", smoothing: " 0.8 " })).toEqual({ cliff1: 1.2, greenhigh: 3, smoothing: 0.8 });
    expect(moreSettings({ smooth_m: "1,35", taubin: "2", min_loop_area: "30", min_clearance: "1,4", formline_gap: "7,8", formline_max_slope: "16,5", veg_smooth: "0,65" }, OTIDGEO_MORE_SETTINGS))
      .toEqual({ smooth_m: 1.35, taubin: 2, min_loop_area: 30, min_clearance: 1.4, formline_gap: 7.8, formline_max_slope: 16.5, veg_smooth: 0.65 });
  });

  it("hoppar över tomma fält, annat än tal, tal utanför gränserna och okända namn", () => {
    expect(moreSettings({ cliff1: "", cliff2: "brant", knolls: "9", undergrowth: "-1", contour_interval: "2.5", okänd: "1" })).toEqual({});
    expect(moreSettings({ smooth_m: "0,4", taubin: "7", min_loop_area: "301", min_clearance: "5", formline_gap: "1", formline_max_slope: "40", veg_smooth: "4" }, OTIDGEO_MORE_SETTINGS))
      .toEqual({});
  });

  it("skiljer på fältlistorna för otidgeo och pullautin", () => {
    expect(moreSettings({ smooth_m: "1,5", smoothing: "1,2" }, OTIDGEO_MORE_SETTINGS)).toEqual({ smooth_m: 1.5 });
    expect(moreSettings({ smooth_m: "1,5", smoothing: "1,2" }, PULLAUTIN_MORE_SETTINGS)).toEqual({ smoothing: 1.2 });
  });
});
