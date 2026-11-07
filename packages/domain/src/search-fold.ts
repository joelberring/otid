/** Bokstäver som inte delas upp av Unicode-normaliseringen. */
const FOLD: Readonly<Record<string, string>> = { "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ð": "d", "þ": "th", "ł": "l", "đ": "d", "ı": "i" };

/**
 * Text för sökning och jämförelse: gemener, utan accenter och utan inledande och avslutande blanksteg. å, ä → a, ö → o,
 * é → e, ø → o, æ → ae, ß → ss. "  Åsa Öberg " → "asa oberg", så att "asa" hittar "Åsa" och "oberg" hittar "Öberg".
 */
export function foldForSearch(value: string): string {
  return value.toLocaleLowerCase("sv-SE").normalize("NFD").replace(/\p{M}+/gu, "")
    .replace(/[øæœßðþłđı]/g, letter => FOLD[letter] ?? letter).trim();
}
