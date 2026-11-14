import { MAP_PROJECT_LAYER_MEDIA_TYPES } from "@o-tid/contracts";
import { describe, expect, it } from "vitest";
import { imageDimensions, webpDimensions } from "../src/image-dimensions";

/** Ägaren 2026-11-14 (migration 0122): geo-arbetarens bilder att titta på får vara WebP. Huvudena är skrivna av cwebp 1.2.1. */
describe("WebP-bildens mått", () => {
  const hex = (text: string) => Uint8Array.from(text.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
  it("läser måtten ur de tre slagen av WebP", () => {
    // 300 × 211 med alfa (VP8X), 123 × 77 utan (VP8) och förlustfri (VP8L): filernas första 32 byte.
    expect(webpDimensions(hex("524946461073000057454250565038580a000000100000002b0100d20000414c"))).toEqual({ mediaType: "image/webp", width: 300, height: 211 });
    expect(webpDimensions(hex("524946467608000057454250565038206a0800009029009d012a7b004d003e6d"))).toEqual({ mediaType: "image/webp", width: 123, height: 77 });
    expect(webpDimensions(hex("5249464678010000574542505650384c6c0100002f7a001300cd0044d2fede33"))).toEqual({ mediaType: "image/webp", width: 123, height: 77 });
  });
  it("säger nej till annat, och uppladdade bilder prövas som förut utan WebP", () => {
    const webp = hex("524946461073000057454250565038580a000000100000002b0100d20000414c");
    expect(webpDimensions(webp.subarray(0, 20))).toBeUndefined();
    expect(webpDimensions(hex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"))).toBeUndefined();
    // Fel startkod i en VP8-bild.
    expect(webpDimensions(hex("524946467608000057454250565038206a08000090290000012a7b004d003e6d"))).toBeUndefined();
    expect(imageDimensions(webp)).toBeUndefined();
  });
  it("underlagens typer är de tre som koden skriver", () => {
    expect([...MAP_PROJECT_LAYER_MEDIA_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(MAP_PROJECT_LAYER_MEDIA_TYPES.every(type => /^image\/[a-z0-9.+-]{1,40}$/.test(type))).toBe(true);
  });
});
