import { describe, expect, it, vi } from "vitest";
import { copyPublicLink, publicLinkUrl, sharePublicLink } from "./public-link-share";

describe("TASK149 public link sharing", () => {
  it("creates an exact same-origin URL and hands it to Web Share", async () => {
    const share = vi.fn(async () => undefined);
    await expect(sharePublicLink({ origin: "https://otid.example", share }, "/results/race/route-comparison?first=one&second=two&third=three", "Jämför deltagarrutter"))
      .resolves.toBe("SHARED");
    expect(share).toHaveBeenCalledWith({ title: "Jämför deltagarrutter", url: "https://otid.example/results/race/route-comparison?first=one&second=two&third=three" });
    expect(() => publicLinkUrl("https://otid.example", "https://other.example/path")).toThrow("PUBLIC_LINK_PATH_INVALID");
    expect(() => publicLinkUrl("https://otid.example", "/\\other.example/path")).toThrow("PUBLIC_LINK_PATH_INVALID");
  });

  it("copies the exact route when Web Share is unavailable and fails without leaking a source", async () => {
    const copy = vi.fn(async () => undefined);
    await expect(copyPublicLink({ origin: "https://otid.example", copy }, "/results/race/participants/result/route")).resolves.toBe("COPIED");
    expect(copy).toHaveBeenCalledWith("https://otid.example/results/race/participants/result/route");
    await expect(copyPublicLink({ origin: "https://otid.example", copy: vi.fn(async () => { throw new Error("private clipboard detail"); }) }, "/results/race/participants/result/route"))
      .resolves.toBe("COPY_UNAVAILABLE");
  });

  it("keeps a cancelled native share separate from a missing platform capability", async () => {
    await expect(sharePublicLink({ origin: "https://otid.example" }, "/results/race/participants/result/route", "Deltagarens rutt"))
      .resolves.toBe("SHARE_UNAVAILABLE");
    await expect(sharePublicLink({ origin: "https://otid.example", share: vi.fn(async () => { throw new Error("cancelled"); }) }, "/results/race/participants/result/route", "Deltagarens rutt"))
      .resolves.toBe("SHARE_CANCELLED");
  });
});
