import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Översynen 2026-11-10, E4: en sida eller komponent som läser svenska texter (`i18n/sv` eller `i18n/*-sv`) ska också välja språk.
 * Annars blir den kvar på svenska för en besökare som har engelska, och ingen märker det förrän någon provar. Testet är en grov
 * kontroll av källtexten: filen ska läsa en engelsk textfil, använda en språkfunktion eller ha en språkvariabel. En sida som med flit
 * bara är på svenska läggs i `SWEDISH_ONLY` med skälet.
 */
const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const SWEDISH_ONLY: Readonly<Record<string, string>> = {};

const SWEDISH_IMPORT = /from\s+"[^"]*i18n\/(?:sv|[\w-]+-sv)"/;
const LANGUAGE_CHOICE = new RegExp([
  String.raw`from\s+"[^"]*i18n\/[\w-]+-en"`,
  String.raw`\b(?:useTexts|pickTexts|currentLanguage|useLanguage|languageOfRequest)\b`,
  String.raw`\blanguage\b`, String.raw`\benglish\b`,
  String.raw`\ben\s*[?&]`, String.raw`[{,]\s*en\s*[,}:=]`, String.raw`\ben\s*[:=]\s*(?:boolean|await)`
].join("|"));

function pageAndComponentFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "api" || name === "node_modules" ? [] : pageAndComponentFiles(path);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("språket i sidor och komponenter", () => {
  const files = [join(src, "components"), join(src, "app")].flatMap(pageAndComponentFiles).map(path => relative(src, path));

  it("varje fil som läser svenska texter väljer också språk", () => {
    const missing = files.filter(file => {
      const source = readFileSync(join(src, file), "utf8");
      return SWEDISH_IMPORT.test(source) && !LANGUAGE_CHOICE.test(source) && !(file in SWEDISH_ONLY);
    });
    expect(missing).toEqual([]);
  });

  it("en fil i SWEDISH_ONLY som har fått språkval ska tas bort ur listan", () => {
    const stale = Object.keys(SWEDISH_ONLY).filter(file => {
      const source = readFileSync(join(src, file), "utf8");
      return LANGUAGE_CHOICE.test(source);
    });
    expect(stale).toEqual([]);
  });
});
