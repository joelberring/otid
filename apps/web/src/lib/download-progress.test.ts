import { describe, expect, it } from "vitest";
import { readWithProgress } from "./download-progress";

function chunked(bytes: Uint8Array, size: number, length?: number): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.byteLength) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + size)); offset += size;
  } });
  return new Response(body, { headers: length === undefined ? {} : { "content-length": String(length) } });
}

describe("hämtning med förlopp (ADR-0218)", () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);

  it("ger hela filen och förloppet i hela procent upp till 100", async () => {
    const seen: number[] = [];
    const result = new Uint8Array(await readWithProgress(chunked(bytes, 100, 1000), fraction => seen.push(fraction)));
    expect([...result]).toEqual([...bytes]);
    expect(seen).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it("klarar ett svar utan längd, en felaktig längd och utan förloppsfunktion", async () => {
    const seen: number[] = [];
    expect([...new Uint8Array(await readWithProgress(chunked(bytes, 64), fraction => seen.push(fraction)))]).toEqual([...bytes]);
    expect(seen).toEqual([]);
    expect([...new Uint8Array(await readWithProgress(chunked(bytes, 300, 500), () => undefined))]).toEqual([...bytes]);
    expect([...new Uint8Array(await readWithProgress(chunked(bytes, 300, 2000), () => undefined))]).toEqual([...bytes]);
    expect([...new Uint8Array(await readWithProgress(chunked(bytes, 300, 1000)))]).toEqual([...bytes]);
  });
});
