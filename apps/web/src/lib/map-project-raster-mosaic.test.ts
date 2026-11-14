import { describe, expect, it } from "vitest";
import { rasterChoices, stageMosaic } from "./map-project-raster-mosaic";

const part = (c: number, f: number, width = 100, height = 50) => ({ width, height, toMap: { a: 0.5, b: 0, c, d: 0, e: -0.5, f } });

describe("etappernas bilder som en", () => {
  it("lägger delarna efter varandra och flyttar origo till hörnet", () => {
    // Andra etappen ligger 40 bildpunkter till höger och 30 längre upp (y uppåt på kartan, nedåt i bilden).
    const mosaic = stageMosaic([part(10, 100), part(30, 115)]);
    expect(mosaic).toMatchObject({ width: 140, height: 80, offsets: [[0, 30], [40, 0]] });
    expect(mosaic!.toMap).toMatchObject({ a: 0.5, e: -0.5, c: 10, f: 115 });
  });
  it("avrundar en liten förskjutning och vägrar olika skala eller en för stor bild", () => {
    expect(stageMosaic([part(0, 0), part(20.1, 0)])!.offsets).toEqual([[0, 0], [40, 0]]);
    expect(stageMosaic([part(0, 0), { ...part(10, 0), toMap: { ...part(10, 0).toMap, a: 1 } }])).toBeUndefined();
    expect(stageMosaic([part(0, 0, 5000, 5000), part(2500, 0, 5000, 5000)])).toBeUndefined();
  });
  it("visar en körning i etapper som ett val före etapperna", () => {
    const rows = [{ layerId: "a", name: "Hela – etapp 1 av 2 – berg" }, { layerId: "b", name: "Hela – etapp 2 av 2 – berg" }, { layerId: "c", name: "Liten – berg" }];
    const choices = rasterChoices(rows);
    expect(choices.map(choice => choice.id)).toEqual(["etapper:Hela – berg", "a", "b", "c"]);
    expect(choices[0]!.members.map(member => member.layerId)).toEqual(["a", "b"]);
  });
});
