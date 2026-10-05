import { describe, expect, it } from "vitest";
import { DEVICE_BATCH_MAX_BODY_BYTES, readBoundedDeviceBatchJson } from "./readout-batch-body";

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("https://otid.example/api/admin/races/x/administrator/readouts", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body
  });
}

describe("avläsningens batch läses med gräns", () => {
  it("avvisar för stor deklaration utan att läsa kroppen", async () => {
    let pulls = 0;
    const unread = {
      headers: new Headers({ "content-type": "application/json", "content-length": String(DEVICE_BATCH_MAX_BODY_BYTES + 1) }),
      get body() { pulls += 1; throw new Error("body lästes"); }
    } as unknown as Request;
    await expect(readBoundedDeviceBatchJson(unread)).rejects.toMatchObject({ status: 413 });
    expect(pulls).toBe(0);
  });

  it("avvisar fel typ, olika längd, tom kropp, trasig UTF-8 och trasig JSON", async () => {
    await expect(readBoundedDeviceBatchJson(request("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    for (const candidate of [request("{}", { "content-length": "3" }), request(null), request(new Uint8Array([0xff])), request("{")]) {
      await expect(readBoundedDeviceBatchJson(candidate)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("läser exakt 4 MiB men avbryter vid en byte till utan deklaration", async () => {
    const exact = new Uint8Array(DEVICE_BATCH_MAX_BODY_BYTES);
    exact[0] = 0x22;
    exact.fill(0x20, 1, exact.length - 1);
    exact[exact.length - 1] = 0x22;
    await expect(readBoundedDeviceBatchJson(request(exact))).resolves.toBe(" ".repeat(exact.length - 2));
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(DEVICE_BATCH_MAX_BODY_BYTES + 1)); },
      cancel() { cancelled = true; }
    });
    const overflow = { headers: new Headers({ "content-type": "application/json" }), body } as unknown as Request;
    await expect(readBoundedDeviceBatchJson(overflow)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});
