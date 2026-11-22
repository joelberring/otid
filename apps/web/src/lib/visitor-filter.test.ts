import { describe, expect, it } from "vitest";
import { visitWorthCounting } from "./visitor-filter";

const CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const headers = (values: Record<string, string>) => new Headers(values);

describe("besöksstatistiken: vilka sidvisningar som räknas", () => {
  it("räknar en vanlig webbläsare", () => {
    expect(visitWorthCounting(headers({ "user-agent": CHROME }))).toBe(true);
  });

  it("räknar inte förhämtningar från Next eller webbläsaren", () => {
    expect(visitWorthCounting(headers({ "user-agent": CHROME, "next-router-prefetch": "1" }))).toBe(false);
    expect(visitWorthCounting(headers({ "user-agent": CHROME, "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(visitWorthCounting(headers({ "user-agent": CHROME, purpose: "prefetch" }))).toBe(false);
  });

  it("räknar inte robotar, hälsokontrollen eller tom webbläsare", () => {
    expect(visitWorthCounting(headers({ "user-agent": "curl/8.5.0" }))).toBe(false);
    expect(visitWorthCounting(headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }))).toBe(false);
    expect(visitWorthCounting(headers({}))).toBe(false);
  });
});
