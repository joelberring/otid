const POLYNOMIAL = 0x8005;
const TOP_BIT = 0x8000;

/**
 * SPORTidents 16-bitars kontrollsumma för utökat protokoll.
 *
 * Summan beräknas över kommando, längd och data (inte STX/ETX). Datan läses
 * som 16-bitars ord (stor ände först). De två första byten är startvärde och
 * resten skiftas in bit för bit, med två avslutande nollbyte som utfyllnad.
 */
export function crc16(bytes: Uint8Array): number {
  if (bytes.length < 2) return 0;
  let crc = (bytes[0]! << 8) | bytes[1]!;
  const rest = bytes.length - 2;
  if (rest === 0) return crc;
  const paddedLength = rest % 2 === 0 ? rest + 2 : rest + 1;
  for (let index = 0; index < paddedLength; index += 2) {
    const high = bytes[2 + index] ?? 0;
    const low = bytes[3 + index] ?? 0;
    let word = (high << 8) | low;
    for (let bit = 0; bit < 16; bit += 1) {
      const carry = (crc & TOP_BIT) !== 0;
      crc = (crc << 1) & 0xffff;
      if ((word & TOP_BIT) !== 0) crc += 1;
      if (carry) crc ^= POLYNOMIAL;
      word = (word << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}
