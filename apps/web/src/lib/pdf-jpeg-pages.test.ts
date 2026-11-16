import { describe, expect, it } from "vitest";
import { jpegPagesPdf } from "./pdf-jpeg-pages";

describe("jpegPagesPdf", () => {
  it("skriver en giltig struktur med en bild per sida och rätt xref", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = jpegPagesPdf([{ jpeg, widthPx: 10, heightPx: 20, widthMm: 210, heightMm: 297 }, { jpeg, widthPx: 10, heightPx: 20, widthMm: 297, heightMm: 210 }], "Prov åäö");
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(text).toContain("/Filter /DCTDecode");
    // Varje post i xref pekar på början av sitt objekt.
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(start).split("\n").slice(3).filter(line => / 00000 n $/.test(line)).map(line => Number(line.slice(0, 10)));
    entries.forEach((offset, index) => expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`)));
  });
});
