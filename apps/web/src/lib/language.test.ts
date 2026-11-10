import { describe, expect, it } from "vitest";
import { languageFrom, languageHref, pickTexts, languageOfRequest } from "./language";

/** Idéerna 2026-11-08: språket ur kakan, annars engelska bara när webbläsaren inte nämner svenska eller nordiska språk. */
describe("språket", () => {
  it("språket för ett anrop: kakan bland andra kakor, annars webbläsaren", () => {
    const request = (headers: Record<string, string>) => new Request("https://tid.example/api", { headers });
    expect(languageOfRequest(request({ cookie: "otid-session=x; otid-lang=en", "accept-language": "sv-SE" }))).toBe("en");
    expect(languageOfRequest(request({ "accept-language": "en-GB" }))).toBe("en");
    expect(languageOfRequest(request({}))).toBe("sv");
  });

  it("kakan går före webbläsaren; nordiska språk någonstans i listan ger svenska", () => {
    expect(languageFrom("en", "sv-SE")).toBe("en");
    expect(languageFrom("sv", "de-DE")).toBe("sv");
    expect(languageFrom(undefined, "en-US,en;q=0.9,sv;q=0.8")).toBe("sv");
    expect(languageFrom(undefined, "en-GB,en;q=0.9")).toBe("en");
    expect(languageFrom(undefined, "nb-NO")).toBe("sv");
    expect(languageFrom("fr", "de")).toBe("en");
    expect(languageFrom(undefined, undefined)).toBe("sv");
    expect(languageFrom(undefined, "*")).toBe("sv");
  });

  it("väljer texten och bygger adressen tillbaka", () => {
    const sv = { hello: "Hej", count: (n: number) => `${n} st` } as const;
    expect(pickTexts("en", sv, { hello: "Hello", count: n => `${n} pcs` }).count(2)).toBe("2 pcs");
    expect(pickTexts("sv", sv, { hello: "Hello", count: n => `${n} pcs` }).hello).toBe("Hej");
    expect(languageHref("en", "/results/1?x=2")).toBe("/sprak?till=en&tillbaka=%2Fresults%2F1%3Fx%3D2");
    expect(languageHref("sv", "//evil.example")).toBe("/sprak?till=sv&tillbaka=%2F");
  });
});
