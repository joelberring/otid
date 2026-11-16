import type { MapColor, MapSymbol, ParsedMap } from "./model";

/**
 * Ägaren 2026-11-16 («halvöppen mark hamnar ovanför tomtmark», «ja» till att föra in den nya färgordningen i befintliga
 * kartor): kartor gjorda ur O-Tids ISOM-mall före 2026-11-16 ritar 402:s och 404:s vita prickar i färgen «Vit», som ligger
 * över olivgrönt (520), så prickarna syns på tomterna. När kartan läses får prickarna en egen vit färg direkt under
 * olivgrönt, som i mallen nu. Bara på skärmen och i O-Tids utskrifter: filen skrivs inte om (en nedladdad fil har kvar sin
 * färgtabell). Andra kartor (egna färgnamn, OCAD-kartor från annat håll) lämnas orörda.
 */
export const DOT_COLOR_NAME = "Vit (prickar)";
const DOTTED = new Set([402, 404]);

export function withDotsUnderOlive(map: ParsedMap): ParsedMap {
  const olive = map.colors.find(color => color.name === "Olivgrön"), white = map.colors.find(color => color.name === "Vit");
  if (!olive || !white || map.colors.some(color => color.name === DOT_COLOR_NAME)) return map;
  const dotted = [...map.symbols.values()].filter((symbol): symbol is Extract<MapSymbol, { kind: "AREA" }> => symbol.kind === "AREA"
    && DOTTED.has(symbol.code.main) && !!symbol.pattern?.elements.some(element => element.color === white.id));
  if (!dotted.length) return map;
  const id = Math.max(...map.colors.map(color => color.id)) + 1;
  // Ritordningen följer `rank` (större ritas först, längre ner): en halv rang under olivgrönt.
  const dots: MapColor = { ...white, id, name: DOT_COLOR_NAME, rank: olive.rank + 0.5 };
  const symbols = new Map(map.symbols);
  for (const symbol of dotted) symbols.set(symbol.id, { ...symbol, pattern: { ...symbol.pattern!,
    elements: symbol.pattern!.elements.map(element => element.color === white.id ? { ...element, color: id } : element) } });
  return { ...map, colors: [...map.colors, dots], symbols };
}
