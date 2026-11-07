/**
 * ADR-0219: sha256 utan väntan (FIPS 180-4), för läsarnas objekthashar och skrivarens kontroll av grundfilen. WebCrypto
 * räknar bara asynkront och läsarna är synkrona. Egen kod efter standarden.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Gemensamt arbetsminne; funktionerna nedan är synkrona och återanvänder det. */
const W = new Uint32Array(64);
const STATE = new Uint32Array(8);
const TAIL = new Uint8Array(128);

function compress(data: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) {
    const j = offset + 4 * i;
    W[i] = (data[j]! << 24) | (data[j + 1]! << 16) | (data[j + 2]! << 8) | data[j + 3]!;
  }
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15]!, b = W[i - 2]!;
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
  }
  let a = STATE[0]!, b = STATE[1]!, c = STATE[2]!, d = STATE[3]!, e = STATE[4]!, f = STATE[5]!, g = STATE[6]!, h = STATE[7]!;
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  STATE[0] = STATE[0]! + a; STATE[1] = STATE[1]! + b; STATE[2] = STATE[2]! + c; STATE[3] = STATE[3]! + d;
  STATE[4] = STATE[4]! + e; STATE[5] = STATE[5]! + f; STATE[6] = STATE[6]! + g; STATE[7] = STATE[7]! + h;
}

/** sha256 av `data[start, end)` som hex med gemener. */
export function sha256Hex(data: Uint8Array, start = 0, end = data.length): string {
  STATE.set([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const length = end - start;
  let at = start;
  for (; at + 64 <= end; at += 64) compress(data, at);
  const rest = end - at;
  TAIL.fill(0);
  TAIL.set(data.subarray(at, end));
  TAIL[rest] = 0x80;
  const blocks = rest + 9 <= 64 ? 1 : 2;
  const bits = length * 8;
  const last = blocks * 64;
  // Längden i bitar som 64-bitarstal (big-endian); filerna är långt under 2^53 bitar.
  const high = Math.floor(bits / 0x100000000);
  TAIL[last - 8] = high >>> 24; TAIL[last - 7] = high >>> 16; TAIL[last - 6] = high >>> 8; TAIL[last - 5] = high;
  TAIL[last - 4] = bits >>> 24; TAIL[last - 3] = bits >>> 16; TAIL[last - 2] = bits >>> 8; TAIL[last - 1] = bits;
  compress(TAIL, 0);
  if (blocks === 2) compress(TAIL, 64);
  let out = "";
  for (let i = 0; i < 8; i++) {
    const word = STATE[i]!;
    out += HEX[word >>> 24]! + HEX[(word >>> 16) & 0xff]! + HEX[(word >>> 8) & 0xff]! + HEX[word & 0xff]!;
  }
  return out;
}

const ENCODER = new TextEncoder();
let scratch = new Uint8Array(1 << 16);

/** sha256 av `text[start, end)` kodad som UTF-8. */
export function sha256OfText(text: string, start = 0, end = text.length): string {
  const needed = (end - start) * 3;
  if (needed > scratch.length) scratch = new Uint8Array(Math.max(needed, scratch.length * 2));
  const { written } = ENCODER.encodeInto(text.slice(start, end), scratch);
  return sha256Hex(scratch, 0, written);
}
