import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { helpArticles } from "./help-sv";
import { helpArticlesEnById, helpArticlesFor, helpEn } from "./help-en";
import { readoutTextEn, partyTextEn } from "../readout/text-en";
import { readoutText } from "../readout/text-sv";
import { partyText } from "../readout/party-text-sv";
import { HELP_LINK, helpArticleTexts, helpBlockTexts, helpTextParts } from "../lib/help-search";

/**
 * Engelska del 27: de engelska hjälpartiklarna citerar knappar och vägar inom ”…” som i de engelska UI-texterna (`*-en.ts`
 * och avläsningens engelska texter). En del som inte är översatt än (banläggningen, klubbarkivet) citeras med den svenska
 * texten som syns; ett svenskt citat är bara tillåtet när texten inte finns på engelska någonstans.
 */
const directory = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(directory).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"));
const modules = Object.fromEntries(await Promise.all(files.map(async file =>
  [file, await import(`./${file.replace(/\.ts$/, "")}`) as Record<string, unknown>] as const)));

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const notUi = (name: string) => /HelpArticles|helpArticles|^helpSynonyms|HelpArticlesEn|helpArticlesEnById/.test(name);
const uiOf = (english: boolean) => new Set(Object.entries(modules).filter(([file]) => file.endsWith("-en.ts") === english)
  .flatMap(([, module]) => Object.entries(module).filter(([name]) => !notUi(name)).flatMap(([, value]) => strings(value)))
  .map(text => text.trim()));
const english = uiOf(true);
for (const text of [...strings(readoutTextEn), ...strings(partyTextEn)]) english.add(text.trim());
const swedish = uiOf(false);
for (const text of [...strings(readoutText), ...strings(partyText)]) swedish.add(text.trim());

/** Knappar i delar som inte är översatta än (banläggningen, klubbarkivet, kontosammanslagningen). */
const SWEDISH_STILL = ["Välj karta från klubbarkivet", "Ladda ned IOF XML (banor)", "Ladda ned .ppen", "Från klubben",
  "Överför till tävlingen …", "Flytta kopplingen och ta bort dubbletten"];

const quoted = (text: string) => [...text.matchAll(/”([^”]+)”/g)].map(match => match[1]!);
const shown = (text: string) => text.replace(HELP_LINK, "$1");
const translated = [...helpArticlesEnById.values()];
const all = helpArticlesFor(helpArticles);

describe("de engelska hjälpartiklarna", () => {
  const citations = translated.flatMap(article => helpArticleTexts(article).flatMap(text =>
    quoted(shown(text)).map(label => ({ article: article.id, label }))));

  it("citerar engelska UI-texter, eller svenska där delen inte är översatt", () => {
    expect(citations.length).toBeGreaterThan(200);
    const missing = citations.filter(({ label }) => !english.has(label) && !swedish.has(label));
    expect(missing.map(({ article, label }) => `${article}: ${label}`)).toEqual([]);
    // Ett svenskt citat ska inte stå kvar när knappen finns på engelska: då är citatet inte översatt.
    const swedishOnly = citations.filter(({ label }) => !english.has(label));
    expect(swedishOnly.map(({ label }) => label)).toEqual(SWEDISH_STILL);
  });

  it("har samma id, vyer och form som de svenska, och citattecken i par", () => {
    for (const article of translated) {
      const original = helpArticles.find(row => row.id === article.id);
      expect(original, article.id).toBeDefined();
      expect(article.views, article.id).toEqual(original!.views);
      expect(article.body.length, article.id).toBe(original!.body.length);
      for (const text of helpArticleTexts(article)) expect((text.match(/”/g) ?? []).length % 2, `${article.id}: ${text}`).toBe(0);
      const items = article.body.filter(block => typeof block !== "string").flatMap(helpBlockTexts);
      expect(items.filter(item => shown(item).length > 160), article.id).toEqual([]);
    }
  });

  it("länkar till artiklar som finns", () => {
    const ids = new Set(all.map(article => article.id));
    const links = translated.flatMap(article => helpArticleTexts(article).flatMap(text => helpTextParts(text)
      .flatMap(part => part.article ? [{ from: article.id, to: part.article }] : [])));
    expect(links.length).toBeGreaterThan(5);
    expect(links.filter(link => !ids.has(link.to) || link.to === link.from)).toEqual([]);
  });

  it("ersätter de svenska artiklarna på samma plats", () => {
    expect(all.map(article => article.id)).toEqual(helpArticles.map(article => article.id));
    expect(all.find(article => article.id === "avlasning")?.title).toBe("Readout with a station");
    expect(helpEn.link("Forks")).toBe("Help: Forks");
  });
});
