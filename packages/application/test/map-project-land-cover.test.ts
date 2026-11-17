import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng, rgbaPng } from "../src/map-project-job-labels";
import { nmdCodes, nmdColorMap, readLandCover } from "../src/map-project-land-cover";

/** Ägaren 2026-11-17 («kör NMD»): Naturvårdsverkets visningstjänst läst tillbaka till klasskoder med färgkartan. */
const legend = { Legend: [{ rules: [{ symbolizers: [{ Raster: { colormap: { entries: [
  { label: "111 Tallskog på fastmark", quantity: "111", color: "#6E8C05" }, { label: "213 Fastmattemyr, mager", quantity: "213", color: "#F57AB6" },
  { label: "200 Öppen våtmark", quantity: "200", color: "#C29ED7" }, { label: "224 Gräsdominerad våtmark", quantity: "224", color: "#C29ED7" },
  ...Array.from({ length: 10 }, (_, k) => ({ label: `${300 + k}`, quantity: String(300 + k), color: `#0000${(16 + k).toString(16).toUpperCase()}` }))
] } } }] }] }] };

/** En PNG med palett (8 bitar) och genomskinlighet för index 2. */
function palettePng(width: number, height: number, indices: number[], palette: number[]): Uint8Array {
  const chunk = (type: string, body: Uint8Array) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0); out.write(type, 4, "ascii"); Buffer.from(body).copy(out, 8); out.writeUInt32BE(0, 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 3;
  const raw = Buffer.alloc(height * (width + 1));
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) raw[row * (width + 1) + 1 + column] = indices[row * width + column]!;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("PLTE", Uint8Array.from(palette)), chunk("tRNS", Uint8Array.from([255, 255, 0])),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

describe("NMD ur visningstjänsten", () => {
  it("färgkartan: varje färg till sin klass, den första vinner när två delar färg", () => {
    const colors = nmdColorMap(legend);
    expect(colors.get("#F57AB6")).toBe(213);
    expect(colors.get("#C29ED7")).toBe(200);
    expect(nmdColorMap({ nothing: true }).size).toBe(0);
  });
  it("en palettbild avkodas med genomskinlighet, och okända färger räknas", () => {
    const png = palettePng(3, 1, [0, 1, 2], [0x6e, 0x8c, 0x05, 0xf5, 0x7a, 0xb6, 1, 2, 3]);
    const image = decodeRgbaPng(png)!;
    expect([...image.data.subarray(0, 8)]).toEqual([0x6e, 0x8c, 0x05, 255, 0xf5, 0x7a, 0xb6, 255]);
    expect(image.data[11]).toBe(0);
    const unknown = rgbaPng(1, 1, Uint8Array.from([9, 9, 9, 255]));
    expect(nmdCodes(decodeRgbaPng(unknown)!.data, 1, nmdColorMap(legend))).toEqual({ codes: Uint16Array.from([0]), unknown: 1 });
  });
  it("hämtar färgkartan och bilden för rutan i 10 m-rutor och ger klasskoderna", async () => {
    const asked: string[] = [];
    const fake = (async (input: string | URL) => {
      const url = new URL(String(input));
      asked.push(url.searchParams.get("request") ?? "");
      if (url.searchParams.get("request") === "GetLegendGraphic") return new Response(JSON.stringify(legend), { headers: { "content-type": "application/json" } });
      const width = Number(url.searchParams.get("width")), height = Number(url.searchParams.get("height"));
      const rgba = new Uint8Array(width * height * 4);
      for (let p = 0; p < width * height; p += 1) rgba.set(p % 2 ? [0xf5, 0x7a, 0xb6, 255] : [0x6e, 0x8c, 0x05, 255], p * 4);
      return new Response(Buffer.from(rgbaPng(width, height, rgba)), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const result = await readLandCover({ south: 59.20, west: 18.10, north: 59.21, east: 18.12 }, { url: "https://nmd.test/ows", fetch: fake });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(asked).toEqual(["GetLegendGraphic", "GetMap"]);
    expect(result.cell).toBe(10);
    expect(result.minX % 10).toBe(0); expect(result.maxY % 10).toBe(0);
    const bytes = Buffer.from(result.codes, "base64");
    expect(bytes.length).toBe(result.width * result.height * 2);
    expect([bytes.readUInt16LE(0), bytes.readUInt16LE(2)]).toEqual([111, 213]);
    expect(result.unknown).toBe(0);
  });
  it("en tjänst som svarar fel ger «unavailable»", async () => {
    const fake = (async () => new Response("nej", { status: 503 })) as unknown as typeof fetch;
    expect(await readLandCover({ south: 59.2, west: 18.1, north: 59.21, east: 18.12 }, { url: "https://nmd.test/ows", fetch: fake })).toEqual({ status: "unavailable", detail: "http-503" });
  });
});
