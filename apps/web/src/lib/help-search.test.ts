import { describe, expect, it } from "vitest";
import type { HelpArticle, HelpView } from "../i18n/help-sv";
import { helpArticles } from "../i18n/help-sv";
import { foldForSearch, helpArticleText, helpTextParts, listHelpArticles } from "./help-search";

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

  it("ordnar efter vyernas ordning när sidan har flera (fliken först, sedan banläggningen i stort)", () => {
    const { here, rest } = listHelpArticles(articles, ["RESULTS", "START"]);
    expect(here.map(row => row.id)).toEqual(["c", "b"]);
    expect(rest.map(row => row.id)).toEqual(["a"]);
    // Banläggningens flik Utskrift: utskriftens artiklar först, sedan det som gäller hela banläggningen.
    const print = listHelpArticles(helpArticles, ["CS_PRINT", "COURSE_SETTING"]).here.map(row => row.id);
    expect(print.slice(0, 5)).toEqual(["utskrift", "beskrivning-pa-kartan", "papperet", "bl-farger", "pdf-tryck"]);
    expect(print).toContain("sparande");
    expect(print.indexOf("sparande")).toBeGreaterThan(print.indexOf("pdf-tryck"));
  });

  it("ställer artiklar som är skrivna för vyn (vyn först i artikelns lista) först inom vyn", () => {
    const rows: HelpArticle[] = [
      { id: "beskrivning", title: "Beskrivning", views: ["CS_DESCRIPTION", "CS_FIELD"], body: ["a.", "b.", "c."] },
      { id: "falt", title: "Fältläget", views: ["CS_FIELD"], body: ["a.", "b.", "c."] }
    ];
    expect(listHelpArticles(rows, ["CS_FIELD"]).here.map(row => row.id)).toEqual(["falt", "beskrivning"]);
    expect(listHelpArticles(helpArticles, ["CS_FIELD", "CS_PRINT", "COURSE_SETTING"]).here[0]?.id).toBe("faltlaget");
    expect(listHelpArticles(helpArticles, ["CS_START", "COURSE_SETTING"]).here.slice(0, 3).map(row => row.id))
      .toEqual(["kom-igang-traning", "kom-igang-purple-pen", "banlaggning-start"]);
    expect(listHelpArticles(helpArticles, ["COURSES"]).here[0]?.id).toBe("banor");
    expect(listHelpArticles(helpArticles, ["READOUT_PAGE"]).here[0]?.id).toBe("avlasning");
    expect(listHelpArticles(helpArticles, ["EVENTS"]).here[0]?.id).toBe("skapa-tavling");
  });

  it("ställer en efterfrågad artikel först (länk eller ? vid en knapp)", () => {
    const { here } = listHelpArticles(articles, "READOUT", "", { first: "b" });
    expect(here.map(row => row.id)).toEqual(["b", "a", "c"]);
    const views: HelpView[] = ["ROUTE_CHOICE"];
    expect(listHelpArticles(helpArticles, views, "", { first: "vagval-kalibrering" }).here[0]?.id).toBe("vagval-kalibrering");
  });

  it("hittar synonymer: kartdef, ppen, gafflingar, hänga och tryck", () => {
    const ids = (query: string, view: HelpView = "EVENTS") => { const { here, rest } = listHelpArticles(helpArticles, view, query);
      return [...here, ...rest].map(row => row.id); };
    expect(ids("kartdef")).toContain("kontrollbeskrivning");
    expect(ids("kartdef")).toContain("beskrivning-pa-kartan");
    expect(ids("ppen")).toContain("purple-pen");
    // Rubriken "Purple Pen, OCAD och IOF XML" träffar på synonymen före texter som bara nämner .ppen.
    expect(ids("ppen", "READOUT").slice(0, 2)).toContain("purple-pen");
    expect(ids("gafflingar")).toContain("gaffling");
    expect(ids("varianter")).toContain("gaffling");
    expect(ids("hänga")).toContain("faltlaget");
    expect(ids("utsättning")).toContain("faltlaget");
    expect(ids("tryck")).toContain("utskrift");
    expect(ids("tryck")).toContain("pdf-tryck");
    // "Tryck på ”…”" (en knapp) räknas inte som tryck.
    expect(ids("tryck")).not.toContain("funktionarer");
    expect(ids("tryck")).not.toContain("skapa-tavling");
  });

  it("ställer träffar i rubriken före träffar på en synonym", () => {
    const { here, rest } = listHelpArticles(helpArticles, "EVENTS", "utskrift");
    const all = [...here, ...rest].map(row => row.id);
    expect(all.indexOf("utskrift")).toBeLessThan(all.indexOf("pdf-tryck"));
  });

  it("hittar riktiga artiklar på vanliga ord", () => {
    const ids = (query: string) => { const { here, rest } = listHelpArticles(helpArticles, "EVENTS", query);
      return [...here, ...rest].map(row => row.id); };
    expect(ids("okand bricka")).toContain("okand-bricka");
    expect(ids("CP210x")).toEqual(["avlasning"]);
    expect(ids("LOTTNING")).toContain("start");
    expect(ids("funktionar")).toContain("funktionarer");
    expect(ids("archive-import")).toEqual([]);
    expect(ids("importnyckel")).toEqual(["arkiv-import"]);
  });

  it("läser länkar i texten och söker i länkens text", () => {
    expect(helpTextParts("Se [Gaffling och slinga](#gaffling) och mer.")).toEqual([
      { text: "Se " }, { text: "Gaffling och slinga", article: "gaffling" }, { text: " och mer." }]);
    expect(helpTextParts("Ingen länk [här].")).toEqual([{ text: "Ingen länk [här]." }]);
    const article: HelpArticle = { id: "x", title: "X", views: ["EVENTS"], body: ["Se [Vägval](#vagval).", { steps: ["Ett ”steg”."] }] };
    expect(helpArticleText(article)).toBe("X Se Vägval. Ett steg.");
  });
});
