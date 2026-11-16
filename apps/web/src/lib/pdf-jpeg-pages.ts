/**
 * En PDF med en JPEG-bild per sida (fältutskriften av underlaget för frihandsritning). Bilden fyller sidan; sidans storlek
 * anges i mm. Ett litet eget skrivsätt i stället för ett bibliotek: det är bara bildobjekt och sidor.
 */
export interface JpegPage { readonly jpeg: Uint8Array; readonly widthPx: number; readonly heightPx: number; readonly widthMm: number; readonly heightMm: number }

const POINTS_PER_MM = 72 / 25.4;

export function jpegPagesPdf(pages: readonly JpegPage[], title = "Underlag"): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => { const bytes = typeof part === "string" ? encoder.encode(part) : part; chunks.push(bytes); length += bytes.length; };
  const object = (id: number, body: () => void) => { offsets[id] = length; push(`${id} 0 obj\n`); body(); push("\nendobj\n"); };
  push("%PDF-1.4\n%âãÏÓ\n");
  // 1 katalog, 2 sidorna, 3 info; varje sida har sida, innehåll och bild.
  const pageId = (index: number) => 4 + index * 3;
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(" ")}] >>`));
  const safeTitle = title.replace(/[^\x20-\x7e]/g, "?").replace(/[()\\]/g, "");
  object(3, () => push(`<< /Title (${safeTitle}) /Producer (O-Tid) >>`));
  pages.forEach((page, index) => {
    const id = pageId(index), width = page.widthMm * POINTS_PER_MM, height = page.heightMm * POINTS_PER_MM;
    const content = `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 0 0 cm /Im0 Do Q`;
    object(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    object(id + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push("\nendstream"); });
    object(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      push(page.jpeg); push("\nendstream");
    });
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
