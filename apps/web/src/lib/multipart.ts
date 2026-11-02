/**
 * Steg 59, ADR-0189 beslut 2: en liten multipart/form-data-läsare för kartfilens uppladdning som läser bodyn som en ström.
 * Varje del lämnas till anroparen som en ström av bitar (`chunks`), så att en kartfil på 60 MB aldrig ligger i minnet i ett
 * stycke; läsaren håller bara den bit som inte kan vara början på nästa gräns. Bara det som webbläsarens FormData skickar
 * stöds: `Content-Disposition: form-data; name="…"; filename="…"` och valfri `Content-Type`.
 */
export interface MultipartPart {
  readonly name: string;
  readonly fileName: string | undefined;
  readonly contentType: string | undefined;
  /** Delens innehåll i bitar. Läses en gång; det som inte läses hoppas över. */
  readonly chunks: AsyncIterable<Uint8Array>;
}

/** Ogiltig multipart (`invalid`) eller mer än gränsen (`too-large`). */
export class MultipartError extends Error {
  constructor(readonly kind: "invalid" | "too-large") { super(kind === "too-large" ? "Bodyn är för stor" : "Ogiltig multipart"); }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_MAX = 4096;

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

/** Läser strömmen i bitar med en total storleksgräns. */
class StreamBuffer {
  buffer: Buffer = Buffer.alloc(0);
  private total = 0;
  private ended = false;
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>, private readonly maxBytes: number) {}

  /** Läser nästa bit till bufferten. Falskt när strömmen är slut. */
  async more(): Promise<boolean> {
    if (this.ended) return false;
    const { done, value } = await this.reader.read();
    if (done) { this.ended = true; return false; }
    this.total += value.byteLength;
    if (this.total > this.maxBytes) throw new MultipartError("too-large");
    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    return true;
  }

  /** Minst `length` byte i bufferten (eller fel när strömmen tar slut innan). */
  async need(length: number): Promise<void> {
    while (this.buffer.length < length) if (!await this.more()) throw new MultipartError("invalid");
  }
}

/**
 * Läser delarna i ordning och lämnar var och en till `handle`. Fel i bodyn ger `MultipartError`. Högst `maxParts` delar och
 * `maxBytes` byte totalt; strömmen avbryts direkt när en gräns passeras.
 */
export async function forEachMultipartPart(body: ReadableStream<Uint8Array> | null, boundary: string,
  options: { maxBytes: number; maxParts: number }, handle: (part: MultipartPart) => Promise<void>): Promise<void> {
  if (!body) throw new MultipartError("invalid");
  const reader = body.getReader();
  const input = new StreamBuffer(reader, options.maxBytes);
  const delimiter = encoder.encode(`--${boundary}`);
  const separator = encoder.encode(`\r\n--${boundary}`);
  try {
    await input.need(delimiter.length);
    if (input.buffer.indexOf(delimiter) !== 0) throw new MultipartError("invalid");
    input.buffer = input.buffer.subarray(delimiter.length);
    let count = 0;
    for (;;) {
      // Efter gränsen: "--" = slut, annars CRLF och delens huvuden.
      await input.need(2);
      if (input.buffer[0] === 0x2d && input.buffer[1] === 0x2d) return;
      if (input.buffer[0] !== 0x0d || input.buffer[1] !== 0x0a) throw new MultipartError("invalid");
      input.buffer = input.buffer.subarray(2);
      let end: number;
      while ((end = input.buffer.indexOf("\r\n\r\n")) < 0) {
        if (input.buffer.length > HEADER_MAX || !await input.more()) throw new MultipartError("invalid");
      }
      if (end > HEADER_MAX) throw new MultipartError("invalid");
      const headers = decoder.decode(input.buffer.subarray(0, end));
      input.buffer = input.buffer.subarray(end + 4);
      const disposition = headerValue(headers, "content-disposition");
      const name = disposition && /^form-data\b/i.test(disposition) ? dispositionParameter(disposition, "name") : undefined;
      if (!name) throw new MultipartError("invalid");
      if (++count > options.maxParts) throw new MultipartError("invalid");
      let finished = false;
      async function* chunks(): AsyncGenerator<Uint8Array> {
        for (;;) {
          const next = input.buffer.indexOf(separator);
          if (next >= 0) {
            if (next > 0) yield input.buffer.subarray(0, next);
            input.buffer = input.buffer.subarray(next + separator.length);
            finished = true;
            return;
          }
          // Allt utom det som kan vara början på gränsen kan lämnas ut.
          const keep = separator.length - 1;
          if (input.buffer.length > keep) {
            const ready = input.buffer.subarray(0, input.buffer.length - keep);
            input.buffer = input.buffer.subarray(input.buffer.length - keep);
            yield ready;
          }
          if (!await input.more()) throw new MultipartError("invalid");
        }
      }
      await handle({ name, fileName: dispositionParameter(disposition!, "filename"), contentType: headerValue(headers, "content-type"),
        chunks: chunks() });
      // Det som anroparen inte läste hoppas över (en ny läsare fortsätter där den förra slutade).
      if (!finished) for await (const ignored of chunks()) void ignored;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Läser en del i minnet med en gräns (för små delar, som kartfilens metadata). */
export async function partBytes(chunks: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    length += chunk.byteLength;
    if (length > maxBytes) throw new MultipartError("too-large");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
