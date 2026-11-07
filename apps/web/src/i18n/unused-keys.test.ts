import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Städrundan 2026-11-07: varje toppnivånyckel i textobjekten (`export const xSv = { … }`) används någonstans i appen, i
 * komponenterna eller i en annan text. Testerna räknas inte. Nycklarna läses med TypeScripts parser och användningen som
 * ord i källtexten, så att det går fort.
 */
const SRC = join(import.meta.dirname, "..");
const I18N = import.meta.dirname;

/** Textobjekt som läses med en nyckel ur data (`text[raceType]`); deras nycklar syns inte i koden. */
const READ_BY_KEY = new Set(["courseSettingRaceTypeSv"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

interface Key { readonly name: string; readonly object: string; readonly line: number }

/** Toppnivånycklarna i filens exporterade objekt utan typ (`export const x = { … }`, ev. `as const`). */
function topLevelKeys(fileName: string, text: string): Key[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const keys: Key[] = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let value = declaration.initializer;
      if (value && ts.isAsExpression(value)) value = value.expression;
      if (!value || !ts.isObjectLiteralExpression(value) || declaration.type || !ts.isIdentifier(declaration.name)) continue;
      const object = declaration.name.text;
      if (READ_BY_KEY.has(object)) continue;
      for (const property of value.properties) {
        const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
        if (name) keys.push({ name, object, line: file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1 });
      }
    }
  }
  return keys;
}

describe("i18n", () => {
  it("har inga oanvända toppnivånycklar", () => {
    const files = sources(SRC).map(file => ({ file, text: readFileSync(file, "utf8") }));
    const words = new Map<string, number>();
    for (const { text } of files) for (const [word] of text.matchAll(/[A-Za-z_$][\w$]*/g)) words.set(word, (words.get(word) ?? 0) + 1);
    // Definitionen är en förekomst; en till (komponenter, andra texter, samma fil) betyder att nyckeln används.
    const unused = files.filter(({ file }) => file.startsWith(I18N))
      .flatMap(({ file, text }) => topLevelKeys(file, text).map(key => ({ file, ...key })))
      .filter(({ name }) => (words.get(name) ?? 0) <= 1)
      .map(({ file, line, object, name }) => `${relative(SRC, file)}:${line} ${object}.${name}`);
    expect(unused).toEqual([]);
  });
});
