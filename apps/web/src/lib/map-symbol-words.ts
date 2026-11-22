/**
 * Ägaren 2026-11-22 («finns alla standardsymboler med, t.ex. surdrag?»): sökningen bland symbolerna matchar nummer och ISOM:s
 * namn. Kartritarnas vardagsord står här per symbol (huvudnummer eller nummer med decimal), så att «surdrag» hittar 309.
 */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  "101": ["kurva", "nivåkurva"], "102": ["indexkurva", "femmeterskurva"], "103": ["formlinje", "stödkurva"],
  "109": ["knoll", "kulle"], "112": ["grop"], "201": ["stup", "bergvägg", "klippa"], "202": ["bergbrant"],
  "204": ["sten", "block"], "208": ["blockmark"], "214": ["häll", "berg i dagen", "kalt berg"],
  "301": ["sjö", "hav", "vatten"], "302": ["grunt vatten"], "304": ["å", "älv"], "305": ["bäck"], "306": ["dike"],
  "307": ["kärr", "myr"], "308": ["kärr", "myr", "mosse"], "309": ["surdrag", "smalt kärr"], "310": ["fuktstråk", "fuktig mark"],
  "401": ["gult", "äng", "gärde", "hygge"], "402": ["gult med prickar"], "403": ["ljusgult", "hygge", "ödemark"],
  "404": ["ljusgult med prickar", "hygge med träd"], "405": ["vitt", "skog"], "406": ["ljusgrönt", "grönt", "sly"],
  "407": ["ränder", "undervegetation"], "408": ["mellangrönt", "grönt"], "410": ["mörkgrönt", "grönt"], "411": ["oframkomligt"],
  "412": ["åker", "odlat"], "416": ["vegetationsgräns", "skogsgräns"], "501": ["asfalt", "hårdgjort", "torg"],
  "502": ["motorväg"], "503": ["bilväg"], "504": ["traktorväg", "skogsväg"], "505": ["väg", "gångväg"], "506": ["stig"],
  "507": ["otydlig stig"], "508": ["rågång", "kraftgata"], "513": ["mur"], "516": ["stängsel", "gärdsgård"],
  "520": ["tomt", "tomtmark", "kvartersmark", "privat", "förbjudet"], "521": ["hus", "byggnad"]
};

/** Om symbolen med numret `code` (t.ex. «309» eller «501.1») har ett vardagsord som innehåller `needle` (gemener). */
export function symbolWordMatches(code: string, needle: string): boolean {
  if (!needle) return false;
  const words = WORDS[code] ?? WORDS[code.split(".")[0]!] ?? [];
  return words.some(word => word.includes(needle));
}
