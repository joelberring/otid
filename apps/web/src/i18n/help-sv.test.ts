import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { helpArticles, helpSv, type HelpView } from "./help-sv";
import { readoutText } from "../readout/text-sv";
import { partyText } from "../readout/party-text-sv";

/**
 * PLAN.md steg 37: hjälpartiklarna citerar knappar och vägar inom ”…”. Varje citat ska finnas som en hel text i
 * UI-texterna (i18n-filerna och avläsningssidans texter), så att hjälpen inte beskriver en knapp som heter något annat.
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

/** Alla synliga UI-texter. Hjälpartiklarna själva räknas inte (ett citat får inte bekräfta sig självt). */
const uiTexts = new Set([
  ...Object.entries(modules).flatMap(([path, module]) => Object.entries(module)
      .filter(([name]) => !(path === "./help-sv.ts" && name === "helpArticles"))
      .flatMap(([, value]) => strings(value))),
  ...strings(readoutText),
  ...strings(partyText)
].map(text => text.trim()));

const quoted = (text: string) => [...text.matchAll(/”([^”]+)”/g)].map(match => match[1]!);
const views: readonly HelpView[] = ["EVENTS", "COURSES", "CLASSES", "ENTRIES", "START", "PUBLISH", "READOUT", "RESULTS", "SETTINGS",
  "READOUT_PAGE", "PARTY"];

describe("hjälpartiklarna", () => {
  const citations = helpArticles.flatMap(article => [article.title, ...article.body.flat()].flatMap(text =>
    quoted(text).map(label => ({ article: article.id, label }))));

  it("citerar bara knappar och vägar som finns i UI-texterna", () => {
    expect(citations.length).toBeGreaterThan(80);
    expect(citations.filter(({ label }) => !uiTexts.has(label)).map(({ article, label }) => `${article}: ${label}`)).toEqual([]);
  });

  it("har citattecken i par", () => {
    const unpaired = helpArticles.flatMap(article => article.body.flat().filter(text => (text.match(/”/g) ?? []).length % 2 !== 0)
      .map(text => `${article.id}: ${text}`));
    expect(unpaired).toEqual([]);
  });

  it("fångar en knapp som inte finns", () => {
    expect(uiTexts.has("Spara bana och klass")).toBe(true);
    expect(uiTexts.has("Spara banan och klassen")).toBe(false);
  });

  it("har unika id, minst en vy och korta texter", () => {
    expect(new Set(helpArticles.map(article => article.id)).size).toBe(helpArticles.length);
    for (const article of helpArticles) {
      expect(article.views.length, article.id).toBeGreaterThan(0);
      const sentences = article.body.filter(block => typeof block === "string").join(" ").split(/(?<=[.:!?])\s+/).filter(Boolean);
      const bullets = article.body.filter(block => typeof block !== "string").flat();
      // 3–8 meningar, eller korta punktlistor.
      expect(sentences.length + bullets.length, article.id).toBeGreaterThanOrEqual(3);
      expect(sentences.length, article.id).toBeLessThanOrEqual(8);
      for (const bullet of bullets) expect(bullet.length, bullet).toBeLessThanOrEqual(160);
    }
  });

  it("har artiklar för varje steg, Mina tävlingar och avläsningssidan", () => {
    for (const view of views) expect(helpArticles.some(article => article.views.includes(view)), view).toBe(true);
  });

  it("panelens egna texter finns", () => {
    expect(helpSv.button).toBe("Hjälp");
  });
});
