import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { sleep } from "../../../scripts/abortable-sleep.ts";

describe("abortable-sleep", () => {
  it("tar bort sin lyssnare på signalen när tiden gått ut", async () => {
    const controller = new AbortController();
    for (let index = 0; index < 50; index += 1) await sleep(1, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("tar bort sin lyssnare när väntan väcks i förtid", async () => {
    const controller = new AbortController();
    let wake: (() => void) | undefined;
    const waiting = sleep(60_000, controller.signal, finish => { wake = finish; });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    wake?.();
    await waiting;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("slutar vänta direkt när signalen avbryts, och vid redan avbruten signal", async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await waiting;
    await sleep(60_000, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
