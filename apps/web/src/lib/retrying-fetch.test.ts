import { describe, expect, it, vi } from "vitest";
import { canRetry, fetchWithRetry } from "./retrying-fetch";

const ok = () => new Response("{}", { status: 200 });
const post = (headers: Record<string, string>, body: unknown) =>
  ({ method: "POST", headers, body: JSON.stringify(body) }) satisfies RequestInit;

describe("automatiska omförsök", () => {
  it("försöker bara om anrop som säkert kan skickas igen", () => {
    expect(canRetry()).toBe(true);
    expect(canRetry({ method: "GET" })).toBe(true);
    expect(canRetry(post({ "idempotency-key": "entry-card-change:abc" }, {}))).toBe(true);
    expect(canRetry(post({}, { formatVersion: 1, requestId: "8b2b0c56-0000-4000-8000-000000000000" }))).toBe(true);
    expect(canRetry(post({}, { formatVersion: 1 }))).toBe(false);
    expect(canRetry({ method: "DELETE" })).toBe(false);
  });

  it("skickar om ett säkert anrop efter nätfel och ger svaret", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok());
    const response = await fetchWithRetry("/x", post({ "idempotency-key": "k" }, {}), { delays: [0, 0], fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("ger upp efter två omförsök och lämnar felet vidare", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWithRetry("/x", { method: "GET" }, { delays: [0, 0], fetchImpl })).rejects.toBeInstanceOf(TypeError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("skickar om vid 503 men inte vid 409", async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(ok());
    expect((await fetchWithRetry("/x", {}, { delays: [0, 0], fetchImpl: unavailable })).status).toBe(200);
    const conflict = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 409 }));
    expect((await fetchWithRetry("/x", {}, { delays: [0, 0], fetchImpl: conflict })).status).toBe(409);
    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it("skickar aldrig om en skrivning utan idempotensnyckel eller ett avbrutet anrop", async () => {
    const failing = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWithRetry("/x", post({}, { a: 1 }), { delays: [0, 0], fetchImpl: failing })).rejects.toBeInstanceOf(TypeError);
    expect(failing).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    const aborted = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("aborted"));
    await expect(fetchWithRetry("/x", { signal: controller.signal }, { delays: [0, 0], fetchImpl: aborted })).rejects.toBeInstanceOf(TypeError);
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
