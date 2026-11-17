/**
 * PNG med palett (färgtyp 3) och genomskinlighet per färg (tRNS), packad med webbläsarens `CompressionStream("deflate")`.
 * För bilder med få färger, som de täta kurvorna i kartan: canvasens egen PNG blir RGBA och för en kurvbild över 2,6 km²
 * 19 MB, med palett några få MB, vilket betyder mycket för en telefon i skogen.
 */
export interface PaletteColor { readonly rgb: readonly [number, number, number]; readonly alpha: number }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `indices`: en byte per bildpunkt, rad för rad; `palette[i]` är färgen för index i (högst 256). */
export async function indexedPng(width: number, height: number, indices: Uint8Array, palette: readonly PaletteColor[]): Promise<Uint8Array> {
  const raw = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row += 1) raw.set(indices.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = 3; header[10] = 0; header[11] = 0; header[12] = 0;
  const plte = new Uint8Array(palette.length * 3), trns = new Uint8Array(palette.length);
  palette.forEach((color, index) => { plte.set(color.rgb, index * 3); trns[index] = color.alpha; });
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("PLTE", plte), chunk("tRNS", trns),
    chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/**
 * RGBA → index i en palett av `colors` med `levels` steg av genomskinlighet (index 0 = helt genomskinligt). Varje bildpunkt
 * får den närmaste färgen och det närmaste steget; kantutjämningen blir kvar som några steg.
 */
export function quantize(rgba: Uint8ClampedArray, colors: readonly (readonly [number, number, number])[], levels = 4): { indices: Uint8Array; palette: PaletteColor[] } {
  const palette: PaletteColor[] = [{ rgb: [0, 0, 0], alpha: 0 }];
  for (const rgb of colors) for (let level = 1; level <= levels; level += 1) palette.push({ rgb, alpha: Math.round(255 * level / levels) });
  const indices = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < indices.length; p += 1) {
    const alpha = rgba[p * 4 + 3]!, level = Math.round(alpha / 255 * levels);
    if (level === 0) continue;
    let best = 0, distance = Infinity;
    colors.forEach(([r, g, b], index) => {
      const d = (rgba[p * 4]! - r) ** 2 + (rgba[p * 4 + 1]! - g) ** 2 + (rgba[p * 4 + 2]! - b) ** 2;
      if (d < distance) { distance = d; best = index; }
    });
    indices[p] = 1 + best * levels + level - 1;
  }
  return { indices, palette };
}
