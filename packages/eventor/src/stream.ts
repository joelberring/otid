import { fail, parseDocument, type XmlRecord } from "./xml";

/**
 * Läser ett stort Eventor-svar (`CompetitorList`, `OrganisationList`) bit för bit: rotelementet kontrolleras och varje
 * barn med namnet `elementName` tolkas för sig med samma härdade läsning som hela dokument (`parseDocument`). Hela
 * svaret hålls aldrig i minnet som ett träd, så även hela landets löpare (tiotals MB) kan läsas.
 *
 * Elementen hittas med en enkel skanner som räknar nästlade element med samma namn. Text får inte innehålla `<` i XML,
 * så en `<` utanför ett element är alltid en tagg. CDATA och kommentarer mellan elementen avvisas inte, men en CDATA som
 * innehåller en sluttagg ger ett trasigt element och därmed INVALID_XML (aldrig ett tyst fel).
 */
const FORBIDDEN_DECLARATION = /<!\s*(?:DOCTYPE|DTD|ENTITY)\b/i;
/** Ett enskilt element (en löpare, en klubb) är aldrig så här stort. */
const MAX_ELEMENT_CHARS = 1_000_000;

export interface ElementStreamLimits {
  readonly maxElements: number;
}

function startTagPattern(name: string): RegExp {
  return new RegExp(`<${name}(?=[\\s/>])`, "g");
}

function endTagPattern(name: string): RegExp {
  return new RegExp(`</${name}\\s*>`, "g");
}

/** Sista tecknet i taggen som börjar vid `start` (hanterar `>` inom citattecken), eller -1 om taggen inte är hel än. */
function tagEnd(text: string, start: number): number {
  let quote: string | undefined;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote) { if (character === quote) quote = undefined; }
    else if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

/** Text mellan elementen: bara blanktecken, kommentarer och processinstruktioner. */
function onlyInsignificant(text: string): boolean {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").trim() === "";
}

/**
 * Tolkar strömmen av text och anropar `onElement` för varje barn `elementName` till roten `rootName`, i ordning.
 * Ger antalet element. Felen är adapterns koder: INVALID_XML för trasig XML, RESPONSE_TOO_LARGE när gränsen nås.
 */
export async function streamElements(chunks: AsyncIterable<string>, rootName: string, elementName: string,
  limits: ElementStreamLimits, onElement: (element: XmlRecord) => void): Promise<number> {
  let buffer = "";
  let position = 0;
  let state = "prolog" as "prolog" | "body" | "closed";
  let count = 0;
  const start = startTagPattern(elementName);
  const end = endTagPattern(elementName);

  /** Läser så långt bufferten räcker. Ger false när mer text behövs. */
  function step(): boolean {
    if (state === "prolog") {
      const text = buffer.slice(position);
      const match = startTagPattern(rootName).exec(text);
      if (!match) {
        if (FORBIDDEN_DECLARATION.test(text) || text.length > 64_000) fail("INVALID_XML");
        return false;
      }
      const close = tagEnd(text, match.index);
      if (close === -1) return false;
      const prolog = text.slice(0, match.index).replace(/^\ufeff/, "");
      if (FORBIDDEN_DECLARATION.test(prolog) || !onlyInsignificant(prolog)) fail("INVALID_XML");
      state = text[close - 1] === "/" ? "closed" : "body";
      position += close + 1;
      return true;
    }
    if (state === "closed") {
      if (!onlyInsignificant(buffer.slice(position))) fail("INVALID_XML");
      position = buffer.length;
      return false;
    }
    start.lastIndex = position;
    const next = start.exec(buffer);
    // Rotens sluttagg söks bara fram till nästa element, så att ett stort svar i en enda bit inte läses om för varje löpare.
    const between = next ? buffer.slice(position, next.index) : buffer.slice(position);
    const rootMatch = endTagPattern(rootName).exec(between);
    const finished = rootMatch ? { index: position + rootMatch.index, 0: rootMatch[0] } : undefined;
    if (finished) {
      if (!onlyInsignificant(buffer.slice(position, finished.index))) fail("INVALID_XML");
      state = "closed";
      position = finished.index + finished[0].length;
      return true;
    }
    if (!next) {
      // Inget nytt element än: det som står före får bara vara blanktecken (eller en ofullständig tagg på slutet).
      const tail = buffer.slice(position);
      const lastTag = tail.lastIndexOf("<");
      if (!onlyInsignificant(lastTag === -1 ? tail : tail.slice(0, lastTag))) fail("INVALID_XML");
      if (tail.length > MAX_ELEMENT_CHARS) fail("INVALID_XML");
      return false;
    }
    if (!onlyInsignificant(buffer.slice(position, next.index))) fail("INVALID_XML");
    const openEnd = tagEnd(buffer, next.index);
    if (openEnd === -1) return false;
    let segmentEnd: number;
    if (buffer[openEnd - 1] === "/") segmentEnd = openEnd + 1;
    else {
      // Räknar nästlade element med samma namn till den matchande sluttaggen.
      let depth = 1;
      let cursor = openEnd + 1;
      segmentEnd = -1;
      while (depth > 0) {
        start.lastIndex = cursor; end.lastIndex = cursor;
        const nested = start.exec(buffer);
        const closing = end.exec(buffer);
        if (!closing) break;
        if (nested && nested.index < closing.index) {
          const nestedEnd = tagEnd(buffer, nested.index);
          if (nestedEnd === -1) break;
          if (buffer[nestedEnd - 1] !== "/") depth += 1;
          cursor = nestedEnd + 1;
          continue;
        }
        depth -= 1;
        cursor = closing.index + closing[0].length;
        if (depth === 0) segmentEnd = cursor;
      }
      if (segmentEnd === -1) {
        if (buffer.length - next.index > MAX_ELEMENT_CHARS) fail("INVALID_XML");
        return false;
      }
    }
    if (segmentEnd - next.index > MAX_ELEMENT_CHARS) fail("INVALID_XML");
    count += 1;
    if (count > limits.maxElements) fail("RESPONSE_TOO_LARGE");
    onElement(parseDocument(buffer.slice(next.index, segmentEnd), elementName));
    position = segmentEnd;
    return true;
  }

  for await (const chunk of chunks) {
    buffer = buffer.slice(position) + chunk;
    position = 0;
    while (step()) { /* läs vidare */ }
  }
  while (step()) { /* läs vidare */ }
  if (state !== "closed" || !onlyInsignificant(buffer.slice(position))) fail("INVALID_XML");
  return count;
}

/** En hel text som ström (för tester och små svar). */
export async function* textChunks(text: string, size = 64 * 1024): AsyncIterable<string> {
  for (let offset = 0; offset < text.length; offset += size) yield text.slice(offset, offset + size);
  if (text.length === 0) yield "";
}
