/**
 * Små byte-funktioner utan Node (ADR-0204): samma kod i kommandot och i webbläsaren. `Buffer` finns inte i webbläsaren.
 */
export function concatBytes(chunks: readonly Uint8Array[], length?: number): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(length === undefined ? total : Math.min(length, total));
  let at = 0;
  for (const chunk of chunks) {
    if (at >= out.byteLength) break;
    const part = chunk.byteLength > out.byteLength - at ? chunk.subarray(0, out.byteLength - at) : chunk;
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

/** Base64 (samma som `Buffer.toString("base64")`), i bitar så att stora filer inte spränger argumentlistan. */
export function base64OfBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.byteLength; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

let table: Uint32Array | undefined;

/** CRC-32 (zip), fortsätter från `value`. Används i webbläsaren; kommandot har zlib:s. */
export function crc32(chunk: Uint8Array, value = 0): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = (value ^ 0xffffffff) >>> 0;
  for (let index = 0; index < chunk.byteLength; index++) crc = table[(crc ^ chunk[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** En ReadableStream som bitar (Safari saknar `for await` på strömmar). */
export async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
