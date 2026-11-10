import { describe, expect, it } from "vitest";
import { baseMapOutputs, moreSettings } from "./map-project-laser-panel";

describe("Karttapullautins övriga inställningar", () => {
  it("tar tal inom gränserna, med komma eller punkt", () => {
    expect(moreSettings({ cliff1: "1,2", greenhigh: "3", smoothing: " 0.8 " })).toEqual({ cliff1: 1.2, greenhigh: 3, smoothing: 0.8 });
  });

  it("hoppar över tomma fält, annat än tal, tal utanför gränserna och okända namn", () => {
    expect(moreSettings({ cliff1: "", cliff2: "brant", knolls: "9", undergrowth: "-1", contour_interval: "2.5", okänd: "1" })).toEqual({});
  });

  it("grundkartan: alla delar i ordning, brantlinjerna i stället för de korta strecken när de finns", () => {
    const all = ["karta.png", "karta.pgw", "kurvor.dxf", "formlinjer.dxf", "branter.dxf", "stup.dxf", "knollar.dxf", "fukt.png", "fukt.dxf", "vegetation.dxf",
      "brantlinjer.dxf", "vatten.geojson"];
    expect(baseMapOutputs(all)).toEqual(["kurvor.dxf", "formlinjer.dxf", "brantlinjer.dxf", "knollar.dxf", "vatten.geojson", "fukt.dxf", "vegetation.dxf"]);
    expect(baseMapOutputs(all.filter(name => name !== "brantlinjer.dxf" && name !== "vatten.geojson")))
      .toEqual(["kurvor.dxf", "formlinjer.dxf", "knollar.dxf", "fukt.dxf", "vegetation.dxf", "branter.dxf", "stup.dxf"]);
    expect(baseMapOutputs(["karta.png"])).toEqual([]);
  });
});
