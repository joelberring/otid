/**
 * Skriver `src/description-symbols.data.ts` ur Purple Pens `symbols.xml` (BSD, Peter Golde; se NOTICE.md). Körs för hand
 * när Purple Pen får nya symboler eller översättningar, och utdata committas:
 *
 *   pnpm exec tsx scripts/generate-description-symbols.ts <sökväg till PurplePenCore/symbols.xml>
 *
 * Med tas alla symboler (ritningar för båda standarderna) och namn och texter för språken i `LANGUAGES`. Där Purple Pen
 * saknar svenska för en symbol fyller `SWEDISH` i (O-Tids egna, markerade nedan).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SymbolData, SymbolTextData } from "../src/description-symbols";
import { parseSymbolsXml } from "./symbols-xml";

export const LANGUAGES = ["sv", "en", "nb-NO", "fi", "de"];

/** O-Tids svenska för 2018-symboler som saknar svenska i Purple Pen (namn, text, plural). */
const SWEDISH: Readonly<Record<string, readonly [string, string, string]>> = {
  "2.10": ["Skyttegrav", "skyttegraven", "skyttegravarna"],
  "5.25": ["Rabatt / förbjudet område", "rabatten", "rabatterna"],
  "5.26": ["Järnväg", "järnvägen", "järnvägarna"],
  "15.6": ["Vänd kartan", "vänd kartan", "vänd kartan"]
};

function withSwedish(symbol: SymbolData): SymbolData {
  const extra = SWEDISH[symbol.id];
  if (!extra || symbol.names.sv !== undefined) return symbol;
  const [name, text, plural] = extra;
  const texts: SymbolTextData[] = [...symbol.texts, { lang: "sv", text }];
  if (symbol.kind === "D") texts.push({ lang: "sv", text: plural, plural: true });
  return { ...symbol, names: { ...symbol.names, sv: name }, texts };
}

function main(): void {
  const source = process.argv[2];
  if (!source) throw new Error("Ange sökvägen till symbols.xml");
  const xml = readFileSync(source, "utf8");
  const data = parseSymbolsXml(xml, LANGUAGES);
  const symbols = data.symbols.map(withSwedish);
  const hash = createHash("sha256").update(xml).digest("hex").slice(0, 16);
  const lines = [
    "/**",
    " * GENERERAD av scripts/generate-description-symbols.ts ur Purple Pens symbols.xml (BSD, Peter Golde; se NOTICE.md).",
    ` * Källans sha256 (16 första): ${hash}. Språk: ${LANGUAGES.join(", ")}. Ändra inte för hand.`,
    " */",
    'import type { SymbolDbData } from "./description-symbols";',
    "",
    "export const SYMBOL_DATA: SymbolDbData = {",
    `  languages: ${JSON.stringify(data.languages)},`,
    "  symbols: [",
    ...symbols.map(symbol => `    ${JSON.stringify(symbol)},`),
    "  ]",
    "};",
    ""
  ];
  const target = join(dirname(fileURLToPath(import.meta.url)), "../src/description-symbols.data.ts");
  writeFileSync(target, lines.join("\n"));
  console.info(`Skrev ${symbols.length} symboler och ${data.languages.length} språk till ${target}`);
}

main();
