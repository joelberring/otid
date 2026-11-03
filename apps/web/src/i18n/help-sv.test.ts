import { readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { helpArticles, helpSv, type HelpView } from "./help-sv";
import { clubArchiveSv } from "./club-archive-sv";
import { collaborationSv } from "./course-setting-collaboration-sv";
import { readoutText } from "../readout/text-sv";
import { partyText } from "../readout/party-text-sv";
import { HELP_LINK, helpArticleTexts, helpBlockTexts, helpTextParts } from "../lib/help-search";

/**
 * PLAN.md steg 37 och grenen hjalp-banlaggning: hjälpartiklarna citerar knappar, flikar och vägar inom ”…”. Varje citat
 * ska finnas som en hel text i UI-texterna (i18n-filerna och avläsningssidans texter), så att ett nytt namn på en knapp
 * eller flik fäller testet tills hjälpen är rättad. Länkarna mellan artiklarna ska gå till artiklar som finns, och varje
 * flik i banläggningen och klubbarkivet ska ha artiklar.
 */
const files = readdirSync(dirname(fileURLToPath(import.meta.url))).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"));
const modules = Object.fromEntries(await Promise.all(files.map(async file =>
  [`./${file}`, await import(`./${file.replace(/\.ts$/, "")}`) as Record<string, unknown>] as const)));

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Hjälpens egna artiklar och synonymer räknas inte som UI-texter (ett citat får inte bekräfta sig självt). */
const notUi = (name: string) => /^helpArticles$|HelpArticles$|^helpSynonyms$/.test(name);
const uiTexts = new Set([
  ...Object.values(modules).flatMap(module => Object.entries(module).filter(([name]) => !notUi(name)).flatMap(([, value]) => strings(value))),
  ...strings(readoutText),
  ...strings(partyText)
].map(text => text.trim()));

const quoted = (text: string) => [...text.matchAll(/”([^”]+)”/g)].map(match => match[1]!);
/** Texten som den syns (länkarnas markering borta). */
const shown = (text: string) => text.replace(HELP_LINK, "$1");
const ids = new Set(helpArticles.map(article => article.id));

const views: readonly HelpView[] = ["EVENTS", "COURSES", "CLASSES", "ENTRIES", "START", "PUBLISH", "READOUT", "RESULTS", "SETTINGS",
  "READOUT_PAGE", "PARTY", "COURSE_SETTING", "CS_START", "CS_FIELD", "CS_PRINT_PAGE", "CS_DESCRIPTIONS_PAGE", "CONTROL_MAP", "ROUTE_CHOICE"];

describe("hjälpartiklarna", () => {
  const citations = helpArticles.flatMap(article => helpArticleTexts(article).flatMap(text =>
    quoted(shown(text)).map(label => ({ article: article.id, label }))));

  it("citerar bara knappar, flikar och vägar som finns i UI-texterna", () => {
    expect(citations.length).toBeGreaterThan(400);
    expect(citations.filter(({ label }) => !uiTexts.has(label)).map(({ article, label }) => `${article}: ${label}`)).toEqual([]);
  });

  it("har citattecken i par och inga länkar inom citat", () => {
    const texts = helpArticles.flatMap(article => helpArticleTexts(article).map(text => ({ article: article.id, text })));
    expect(texts.filter(({ text }) => (text.match(/”/g) ?? []).length % 2 !== 0).map(({ article, text }) => `${article}: ${text}`)).toEqual([]);
    expect(texts.filter(({ text }) => quoted(text).some(label => label.includes("](#"))).map(({ article }) => article)).toEqual([]);
  });

  it("fångar en knapp eller flik som inte finns", () => {
    expect(uiTexts.has("Spara bana och klass")).toBe(true);
    expect(uiTexts.has("Spara banan och klassen")).toBe(false);
    expect(uiTexts.has("Utskrift")).toBe(true);
    expect(uiTexts.has("Utskrifter")).toBe(false);
  });

  it("länkar bara till artiklar som finns, och aldrig till sig själv", () => {
    const links = helpArticles.flatMap(article => helpArticleTexts(article).flatMap(text => helpTextParts(text)
      .flatMap(part => part.article ? [{ from: article.id, to: part.article, text: part.text }] : [])));
    expect(links.length).toBeGreaterThan(30);
    expect(links.filter(link => !ids.has(link.to) || link.to === link.from || !link.text.trim()).map(link => `${link.from} → ${link.to}`)).toEqual([]);
  });

  it("varje ? vid en knapp (HelpLink i komponenterna) går till en artikel som finns", () => {
    const components = fileURLToPath(new URL("../components", import.meta.url));
    const sources = readdirSync(components, { recursive: true, encoding: "utf8" }).filter(file => file.endsWith(".tsx"))
      .map(file => readFileSync(`${components}/${file}`, "utf8"));
    const used = sources.flatMap(source => [...source.matchAll(/<HelpLink article="([^"]+)"/g)].map(match => match[1]!));
    expect(new Set(used).size).toBeGreaterThanOrEqual(5);
    expect(used.filter(id => !ids.has(id))).toEqual([]);
  });

  it("har unika id, minst en vy och korta texter", () => {
    expect(ids.size).toBe(helpArticles.length);
    // 3–8 meningar i styckena, och korta punkter och steg (högst 160 tecken som de syns).
    const problems = helpArticles.flatMap(article => {
      const sentences = article.body.filter(block => typeof block === "string").join(" ").split(/(?<=[.:!?])\s+/).filter(Boolean);
      const items = article.body.filter(block => typeof block !== "string").flatMap(helpBlockTexts);
      return [
        ...(article.views.length === 0 ? [`${article.id}: ingen vy`] : []),
        ...(sentences.length + items.length < 3 ? [`${article.id}: för kort`] : []),
        ...(sentences.length > 8 ? [`${article.id}: ${sentences.length} meningar`] : []),
        ...items.filter(item => shown(item).length > 160).map(item => `${article.id}: ${shown(item).length} tecken: ${item}`)
      ];
    });
    expect(problems).toEqual([]);
  });

  it("Kom igång är numrerade listor med 5–8 steg som länkar vidare", () => {
    const started = helpArticles.filter(article => article.id.startsWith("kom-igang-"));
    expect(started.map(article => article.id)).toEqual(["kom-igang-traning", "kom-igang-purple-pen"]);
    for (const article of started) {
      const steps = article.body.flatMap(block => typeof block === "object" && "steps" in block ? block.steps : []);
      expect(steps.length, article.id).toBeGreaterThanOrEqual(5);
      expect(steps.length, article.id).toBeLessThanOrEqual(8);
      expect(steps.filter(step => helpTextParts(step).some(part => part.article)).length, article.id).toBeGreaterThanOrEqual(5);
    }
  });

  it("har artiklar för varje steg, sida, flik i banläggningen och flik i klubbarkivet", () => {
    const tabViews = Object.keys(collaborationSv.drawer.tabs).map(tab => `CS_${tab.toUpperCase()}` as HelpView);
    const archiveViews = Object.keys(clubArchiveSv.tabs).map(tab => `ARCHIVE_${tab.toUpperCase()}` as HelpView);
    expect(tabViews).toContain("CS_PRINT");
    expect(archiveViews).toContain("ARCHIVE_IMPORT");
    for (const view of [...views, ...tabViews, ...archiveViews, "ARCHIVE_ENTRY" as const]) {
      expect(helpArticles.some(article => article.views.includes(view)), view).toBe(true);
    }
  });

  it("panelens egna texter finns", () => {
    expect(helpSv.button).toBe("Hjälp");
    expect(helpSv.film).toBe("Se filmen (1 min)");
    expect(helpSv.link("Gaffling och slinga")).toBe("Hjälp: Gaffling och slinga");
  });
});
