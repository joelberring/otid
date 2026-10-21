import { describe, expect, it } from "vitest";
import type { HelpArticle } from "../i18n/help-sv";
import { helpArticles } from "../i18n/help-sv";
import { foldForSearch, listHelpArticles } from "./help-search";

const articles: HelpArticle[] = [
  { id: "a", title: "Läs om avläsningar", views: ["READOUT"], body: ["Tryck på ”Läs om”."] },
  { id: "b", title: "Lottning", views: ["START"], body: ["Välj ”Visa lottning”.", ["Fri start", "Minutstart"]] },
  { id: "c", title: "Öppna Kvar i skogen", views: ["READOUT", "RESULTS"], body: ["Listan över löpare i skogen."] }
];

describe("sökningen i hjälpen", () => {
  it("bortser från versaler och å, ä och ö", () => {
    expect(foldForSearch("ÅÄÖ åäö Øæ")).toBe("aao aao oa");
    expect(listHelpArticles(articles, "START", "LASA").here).toEqual([]);
    expect(listHelpArticles(articles, "START", "las om").rest.map(row => row.id)).toEqual(["a"]);
    expect(listHelpArticles(articles, "START", "läs OM").rest.map(row => row.id)).toEqual(["a"]);
    expect(listHelpArticles(articles, "START", "oppna").rest.map(row => row.id)).toEqual(["c"]);
  });

  it("söker i rubrik, text och punktlistor och kräver alla ord", () => {
    expect(listHelpArticles(articles, "START", "minutstart").here.map(row => row.id)).toEqual(["b"]);
    expect(listHelpArticles(articles, "START", "skogen löpare").rest.map(row => row.id)).toEqual(["c"]);
    expect(listHelpArticles(articles, "START", "skogen lottning")).toEqual({ here: [], rest: [] });
  });

  it("visar vyns artiklar först, sedan resten", () => {
    const { here, rest } = listHelpArticles(articles, "READOUT");
    expect(here.map(row => row.id)).toEqual(["a", "c"]);
    expect(rest.map(row => row.id)).toEqual(["b"]);
  });

  it("hittar riktiga artiklar på vanliga ord", () => {
    const ids = (query: string) => { const { here, rest } = listHelpArticles(helpArticles, "EVENTS", query);
      return [...here, ...rest].map(row => row.id); };
    expect(ids("okand bricka")).toContain("okand-bricka");
    expect(ids("CP210x")).toEqual(["avlasning"]);
    expect(ids("LOTTNING")).toContain("start");
    expect(ids("funktionar")).toContain("funktionarer");
  });
});
