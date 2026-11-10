import { describe, expect, it } from "vitest";
import { moreSettings } from "./map-project-laser-panel";

describe("Karttapullautins övriga inställningar", () => {
  it("tar tal inom gränserna, med komma eller punkt", () => {
    expect(moreSettings({ cliff1: "1,2", greenhigh: "3", smoothing: " 0.8 " })).toEqual({ cliff1: 1.2, greenhigh: 3, smoothing: 0.8 });
  });

  it("hoppar över tomma fält, annat än tal, tal utanför gränserna och okända namn", () => {
    expect(moreSettings({ cliff1: "", cliff2: "brant", knolls: "9", undergrowth: "-1", contour_interval: "2.5", okänd: "1" })).toEqual({});
  });
});
