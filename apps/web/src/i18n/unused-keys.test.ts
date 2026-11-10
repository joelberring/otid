import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Städrundan 2026-11-07, skärpt i översynen 2026-11-10 (F1): varje nyckel i de svenska textobjekten (`export const xSv = { … }`),
 * också de nästlade, används någonstans i appen. Testerna räknas inte. Nycklarna läses med TypeScripts parser och användningen
 * som ord i källtexten, så att det går fort. Den förra versionen räknade den engelska textens definition som en användning och
 * såg därför aldrig en nyckel som fanns på båda språken.
 */
const SRC = join(import.meta.dirname, "..");
const I18N = import.meta.dirname;

/** Textobjekt som läses med en nyckel ur data (`text[raceType]`); deras nycklar syns inte i koden. */
const READ_BY_KEY = new Set(["courseSettingRaceTypeSv"]);

/** Texter som är skrivna före koden som ska använda dem, eller som bara hjälpens citat letar upp. Ta bort raden när det inte längre stämmer. */
const WAITING_FOR_CODE = new Set([
  // Hjälpen citerar "Senast öppnad" och hjälptesten kontrollerar att citatet finns som UI-text; knappen visar `lastOpened(datum)`.
  "lastOpenedLabel"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

interface Key { readonly name: string; readonly path: string; readonly object: string; readonly line: number }

/**
 * Nycklarna i filens exporterade objekt utan typ (`export const x = { … }`, ev. `as const`), på alla nivåer. Kodnycklar i
 * VERSALER (`BLA`, `C_ATTACK`) och nycklar under ett objekt som läses med en nyckel ur data (`text.modes[mode]`) hoppas över: de
 * slås upp dynamiskt och syns inte som ord i koden.
 */
function keysOf(fileName: string, text: string, dynamic: ReadonlySet<string>): Key[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const keys: Key[] = [];
  const walk = (node: ts.ObjectLiteralExpression, trail: readonly string[], object: string) => {
    for (const property of node.properties) {
      const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
      if (!name) continue;
      let value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
      while (value && ts.isAsExpression(value)) value = value.expression;
      if (value && ts.isObjectLiteralExpression(value)) { if (!dynamic.has(name)) walk(value, [...trail, name], object); continue; }
      if (/^[a-z][A-Za-z0-9]*$/.test(name)) keys.push({ name, path: [...trail, name].join("."), object, line: file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1 });
    }
  };
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let value = declaration.initializer;
      if (value && ts.isAsExpression(value)) value = value.expression;
      if (!value || !ts.isObjectLiteralExpression(value) || declaration.type || !ts.isIdentifier(declaration.name)) continue;
      if (READ_BY_KEY.has(declaration.name.text)) continue;
      walk(value, [], declaration.name.text);
    }
  }
  return keys;
}

describe("i18n", () => {
  it("har inga oanvända nycklar, på någon nivå", () => {
    const files = sources(SRC).map(file => ({ file, text: readFileSync(file, "utf8") }));
    // En nyckel används när ordet står i koden utanför textfilerna, eller läses med punkt i en textfil (`sv.nyckel`, `text.nyckel`). Den
    // engelska textens egna definitioner räknas inte: de finns alltid, också för en nyckel som ingen läser.
    const outside = new Set<string>(), member = new Set<string>(), dynamic = new Set<string>();
    for (const { file, text } of files) {
      const inI18n = file.startsWith(I18N);
      if (!inI18n) for (const [word] of text.matchAll(/[A-Za-z_$][\w$]*/g)) outside.add(word);
      for (const [, word] of text.matchAll(/\.([A-Za-z_$][\w$]*)/g)) member.add(word!);
      for (const [, word] of text.matchAll(/\.([A-Za-z_$][\w$]*)\s*\[/g)) dynamic.add(word!);
      for (const [, word] of text.matchAll(/Object\.(?:keys|values|entries)\(\s*[\w$.]*?\.?([A-Za-z_$][\w$]*)\s*\)/g)) dynamic.add(word!);
    }
    const unused = files.filter(({ file }) => file.startsWith(I18N) && !file.endsWith("-en.ts"))
      .flatMap(({ file, text }) => keysOf(file, text, dynamic).map(key => ({ file, ...key })))
      .filter(({ name }) => !outside.has(name) && !member.has(name) && !WAITING_FOR_CODE.has(name))
      .map(({ file, line, object, path }) => `${relative(SRC, file)}:${line} ${object}.${path}`);
    expect(unused).toEqual([]);
  });
});
