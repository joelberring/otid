/**
 * En liten XML-läsare och -skrivare utan DOM (går i Web Worker och Node). Räcker för .ppen: element, attribut, text,
 * CDATA och teckenreferenser. Kommentarer, deklarationer och DOCTYPE hoppas över (kommentarerna räknas).
 */
import { CourseSettingEditError } from "./types";

export interface XmlElement {
  name: string;
  attrs: [string, string][];
  /** Text och element i ordning. Blanktecken mellan element sparas inte. */
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

export interface XmlParseResult {
  readonly root: XmlElement;
  readonly comments: number;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

function decode(text: string, at: number): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    const value = ENTITIES[body];
    if (value === undefined) throw invalid(`okänd entitet ${match}`, at);
    return value;
  });
}

function invalid(message: string, at: number): CourseSettingEditError {
  return new CourseSettingEditError("INVALID", `Ogiltig XML (tecken ${at}): ${message}`);
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

/** Läs ett XML-dokument. Kastar `CourseSettingEditError("INVALID")` vid fel. */
export function parseXml(input: string): XmlParseResult {
  const source = (input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input).replace(/\r\n?/g, "\n");
  let pos = 0;
  let comments = 0;
  let root: XmlElement | undefined;
  const stack: XmlElement[] = [];

  const readName = (): string => {
    NAME.lastIndex = pos;
    const match = NAME.exec(source);
    if (!match) throw invalid("väntade ett namn", pos);
    pos += match[0].length;
    return match[0];
  };
  const skipSpace = () => { while (pos < source.length && /\s/.test(source[pos]!)) pos++; };
  const addText = (text: string) => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      if (text.trim() !== "") throw invalid("text utanför rotelementet", pos);
      return;
    }
    const last = parent.children[parent.children.length - 1];
    if (typeof last === "string") parent.children[parent.children.length - 1] = last + text;
    else parent.children.push(text);
  };

  while (pos < source.length) {
    const lt = source.indexOf("<", pos);
    if (lt < 0) { addText(decode(source.slice(pos), pos)); break; }
    if (lt > pos) addText(decode(source.slice(pos, lt), pos));
    pos = lt;
    if (source.startsWith("<!--", pos)) {
      const end = source.indexOf("-->", pos + 4);
      if (end < 0) throw invalid("kommentaren tar aldrig slut", pos);
      comments++;
      pos = end + 3;
    } else if (source.startsWith("<![CDATA[", pos)) {
      const end = source.indexOf("]]>", pos + 9);
      if (end < 0 || stack.length === 0) throw invalid("felaktig CDATA", pos);
      addText(source.slice(pos + 9, end));
      pos = end + 3;
    } else if (source.startsWith("<?", pos)) {
      const end = source.indexOf("?>", pos + 2);
      if (end < 0) throw invalid("deklarationen tar aldrig slut", pos);
      pos = end + 2;
    } else if (source.startsWith("<!", pos)) {
      const end = source.indexOf(">", pos + 2);
      if (end < 0 || stack.length > 0) throw invalid("felaktig DOCTYPE", pos);
      pos = end + 1;
    } else if (source.startsWith("</", pos)) {
      pos += 2;
      const name = readName();
      skipSpace();
      if (source[pos] !== ">") throw invalid("väntade >", pos);
      pos++;
      const open = stack.pop();
      if (!open || open.name !== name) throw invalid(`</${name}> stänger fel element`, pos);
    } else {
      pos++;
      const element: XmlElement = { name: readName(), attrs: [], children: [] };
      for (;;) {
        skipSpace();
        const c = source[pos];
        if (c === ">" || c === "/") break;
        if (c === undefined) throw invalid("elementet tar aldrig slut", pos);
        const name = readName();
        skipSpace();
        if (source[pos] !== "=") throw invalid(`väntade = efter ${name}`, pos);
        pos++;
        skipSpace();
        const quote = source[pos];
        if (quote !== "\"" && quote !== "'") throw invalid("väntade citattecken", pos);
        const end = source.indexOf(quote, pos + 1);
        if (end < 0) throw invalid("attributet tar aldrig slut", pos);
        const raw = source.slice(pos + 1, end);
        if (raw.includes("<")) throw invalid("< i attribut", pos);
        if (element.attrs.some(([n]) => n === name)) throw invalid(`attributet ${name} två gånger`, pos);
        element.attrs.push([name, decode(raw.replace(/[\n\t]/g, " "), pos)]);
        pos = end + 1;
      }
      const selfClosing = source[pos] === "/";
      pos += selfClosing ? 1 : 0;
      if (source[pos] !== ">") throw invalid("väntade >", pos);
      pos++;
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else if (root) throw invalid("mer än ett rotelement", pos);
      else root = element;
      if (!selfClosing) stack.push(element);
    }
  }
  if (stack.length > 0) throw invalid(`<${stack[stack.length - 1]!.name}> stängs aldrig`, pos);
  if (!root) throw invalid("inget rotelement", 0);
  stripWhitespace(root);
  return { root, comments };
}

/** Text som bara är blanktecken mellan element tas bort (indrag i filen). */
function stripWhitespace(element: XmlElement): void {
  if (element.children.some(child => typeof child !== "string")) {
    element.children = element.children.filter(child => typeof child !== "string" || child.trim() !== "");
  }
  for (const child of element.children) if (typeof child !== "string") stripWhitespace(child);
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) =>
  escapeText(text).replace(/"/g, "&quot;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;").replace(/\t/g, "&#x9;");

/** Skriv ett element. `indent` null = på en rad (för `RawXml`), annars indrag med två blanksteg som Purple Pen. */
export function serializeXml(element: XmlElement, indent: string | null = null): string {
  const attrs = element.attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join("");
  if (element.children.length === 0) return `<${element.name}${attrs}${indent === null ? "/>" : " />"}`;
  const hasElements = element.children.some(child => typeof child !== "string");
  if (indent === null || !hasElements) {
    const inner = element.children.map(child => typeof child === "string" ? escapeText(child) : serializeXml(child, null)).join("");
    return `<${element.name}${attrs}>${inner}</${element.name}>`;
  }
  const inner = element.children
    .map(child => `\n${indent}  ${typeof child === "string" ? escapeText(child) : serializeXml(child, `${indent}  `)}`)
    .join("");
  return `<${element.name}${attrs}>${inner}\n${indent}</${element.name}>`;
}

export function attr(element: XmlElement, name: string): string | undefined {
  return element.attrs.find(([n]) => n === name)?.[1];
}

export function textOf(element: XmlElement): string {
  return element.children.map(child => typeof child === "string" ? child : textOf(child)).join("");
}

export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => typeof child !== "string");
}

export function el(name: string, attrs: [string, string][] = [], children: XmlNode[] = []): XmlElement {
  return { name, attrs, children };
}
