import { describe, expect, it } from "vitest";
import { RADIO_POLL_INTERVAL_MS } from "@o-tid/application";
import { radioPollDelay } from "./radio-poll-delay";

describe("radioPollDelay", () => {
  it("väntar längre efter databasfel: 20, 40, sedan 60 s", () => {
    expect(radioPollDelay(0)).toBe(RADIO_POLL_INTERVAL_MS);
    expect([1, 2, 3, 4, 10].map(radioPollDelay)).toEqual([20_000, 40_000, 60_000, 60_000, 60_000]);
  });
});
