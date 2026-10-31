/**
 * Steg 59: en liten multipart/form-data-läsare för kartfilens uppladdning. Bodyn är redan läst med storleksgräns; delarna
 * blir vyer i samma buffert (ingen kopia av en kartfil på 60 MB). Bara det som webbläsarens FormData skickar stöds:
 * `Content-Disposition: form-data; name="…"; filename="…"` och valfri `Content-Type`.
 */
export interface MultipartPart {
  readonly name: string;
  readonly fileName: string | undefined;
  readonly contentType: string | undefined;
  readonly bytes: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Gränsen ur Content-Type, eller undefined när det inte är multipart/form-data. */
export function multipartBoundary(contentType: string | null): string | undefined {
  if (!contentType) return undefined;
  const [type, ...parameters] = contentType.split(";").map(part => part.trim());
  if (type?.toLowerCase() !== "multipart/form-data") return undefined;
  for (const parameter of parameters) {
    const match = /^boundary=(?:"([^"]{1,70})"|([^\s";]{1,70}))$/i.exec(parameter);
    if (match) return match[1] ?? match[2];
  }
  return undefined;
}

/** Sökning med Nodes inbyggda Buffer.indexOf (snabb även i en kartfil på 60 MB). */
function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).indexOf(needle, from);
}

function headerValue(headers: string, name: string): string | undefined {
  for (const line of headers.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return undefined;
}

function dispositionParameter(disposition: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${name}="((?:[^"\\\\]|\\\\.)*)"`, "i").exec(disposition);
  return match ? match[1]!.replace(/\\(.)/g, "$1") : undefined;
}

/** Delarna i ordning, eller undefined när bodyn inte är giltig multipart. Högst `maxParts` delar. */
export function parseMultipart(body: Uint8Array, boundary: string, maxParts = 8): MultipartPart[] | undefined {
  const delimiter = encoder.encode(`--${boundary}`);
  const separator = encoder.encode(`\r\n--${boundary}`);
  const headerEnd = encoder.encode("\r\n\r\n");
  if (indexOf(body, delimiter, 0) !== 0) return undefined;
  const parts: MultipartPart[] = [];
  let cursor = delimiter.length;
  for (;;) {
    // Efter gränsen: "--" = slut, annars CRLF och delens huvuden.
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) return parts;
    if (body[cursor] !== 0x0d || body[cursor + 1] !== 0x0a) return undefined;
    const start = cursor + 2;
    const end = indexOf(body, headerEnd, start);
    if (end < 0 || end - start > 4096) return undefined;
    const headers = decoder.decode(body.subarray(start, end));
    const disposition = headerValue(headers, "content-disposition");
    const name = disposition && /^form-data\b/i.test(disposition) ? dispositionParameter(disposition, "name") : undefined;
    if (!name) return undefined;
    const content = end + headerEnd.length;
    const next = indexOf(body, separator, content);
    if (next < 0) return undefined;
    parts.push({ name, fileName: dispositionParameter(disposition!, "filename"), contentType: headerValue(headers, "content-type"),
      bytes: body.subarray(content, next) });
    if (parts.length > maxParts) return undefined;
    cursor = next + separator.length;
  }
}
