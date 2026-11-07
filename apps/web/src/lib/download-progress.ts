/**
 * ADR-0218: en stor kartfil (flera MB) hämtas med förlopp, så att banläggningen kan säga "Hämtar kartfilen … 40 %" i
 * stället för att visa en tom yta. Utan känd längd (eller utan ström) läses svaret som vanligt och förloppet är okänt.
 */
export async function readWithProgress(response: Response, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("content-length"));
  if (!onProgress || !response.body || !Number.isSafeInteger(total) || total <= 0) return response.arrayBuffer();
  const reader = response.body.getReader();
  let buffer = new Uint8Array(total);
  let received = 0;
  let reported = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Längre än utlovat (borde inte hända): bufferten växer i stället för att något kastas bort.
    if (received + value.byteLength > buffer.byteLength) {
      const bigger = new Uint8Array(Math.max(received + value.byteLength, buffer.byteLength * 2));
      bigger.set(buffer.subarray(0, received));
      buffer = bigger;
    }
    buffer.set(value, received);
    received += value.byteLength;
    // Hela procent räcker; React ska inte ritas om för varje bit.
    const percent = Math.min(100, Math.floor((received / total) * 100));
    if (percent !== reported) { reported = percent; onProgress(percent / 100); }
  }
  return received === buffer.byteLength ? buffer.buffer : buffer.slice(0, received).buffer;
}
