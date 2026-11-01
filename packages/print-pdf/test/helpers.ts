/** Testernas hjälp: typsnitten, kartfilen och en strukturell läsning av PDF:en med pdf-lib (inga externa verktyg). */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "../src";

const here = new URL("../", import.meta.url);

export function fontFiles(): FontFiles {
  return Object.fromEntries(FONT_VARIANTS.map(variant => [variant, new Uint8Array(readFileSync(new URL(`fonts/${FONT_FILE_NAMES[variant]}`, here)))])) as unknown as FontFiles;
}

export function fixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../fixtures/${path}`, here)));
}

export interface ParsedPdf {
  readonly document: PDFDocument;
  readonly pages: { readonly size: [number, number]; readonly content: string; readonly resources: PDFDict }[];
  /** Färgrymderna per resursnamn: plåtarna, typ och alternativets C1 (för /Separation). */
  readonly colorSpaces: Map<string, { kind: "Separation" | "DeviceN"; names: string[]; c1?: number[]; functionType: number; code?: string }>;
  readonly extGStates: Map<string, Record<string, unknown>>;
  readonly forms: Map<string, string>;
  readonly fonts: { readonly base: string; readonly embedded: boolean }[];
}

function resolve(document: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? document.context.lookup(value) : value;
}

export function streamText(stream: PDFRawStream): string {
  const filter = stream.dict.get(PDFName.of("Filter"));
  const bytes = filter ? inflateSync(stream.contents) : Buffer.from(stream.contents);
  return Buffer.from(bytes).toString("latin1");
}

const nameOf = (value: PDFObject | undefined) => value instanceof PDFName ? value.decodeText() : String(value);

/** PDF:en läst tillbaka: sidornas innehåll, färgrymderna, ExtGState, utsnitten och typsnitten. */
export async function parsePdf(bytes: Uint8Array): Promise<ParsedPdf> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = document.getPages().map(page => {
    const contents = resolve(document, page.node.get(PDFName.of("Contents")));
    const content = contents instanceof PDFRawStream ? streamText(contents) : "";
    return { size: [page.getWidth(), page.getHeight()] as [number, number], content, resources: resolve(document, page.node.get(PDFName.of("Resources"))) as PDFDict };
  });
  const colorSpaces: ParsedPdf["colorSpaces"] = new Map();
  const extGStates: ParsedPdf["extGStates"] = new Map();
  const forms = new Map<string, string>();
  const resources = pages[0]?.resources;
  const dict = (key: string) => resources ? resolve(document, resources.get(PDFName.of(key))) as PDFDict | undefined : undefined;
  for (const [key, value] of dict("ColorSpace")?.entries() ?? []) {
    const array = resolve(document, value) as PDFArray;
    const kind = nameOf(array.get(0)) as "Separation" | "DeviceN";
    const names = kind === "Separation" ? [nameOf(array.get(1))] : (resolve(document, array.get(1)) as PDFArray).asArray().map(nameOf);
    const fn = resolve(document, array.get(3));
    const fnDict = fn instanceof PDFRawStream ? fn.dict : fn as PDFDict;
    const functionType = (fnDict.get(PDFName.of("FunctionType")) as PDFNumber).asNumber();
    const c1 = fnDict.get(PDFName.of("C1")) as PDFArray | undefined;
    colorSpaces.set(key.decodeText(), { kind, names, functionType, ...(c1 ? { c1: c1.asArray().map(item => (item as PDFNumber).asNumber()) } : {}),
      ...(fn instanceof PDFRawStream ? { code: streamText(fn) } : {}) });
  }
  for (const [key, value] of dict("ExtGState")?.entries() ?? []) {
    const state = resolve(document, value) as PDFDict;
    extGStates.set(key.decodeText(), Object.fromEntries(state.entries().map(([name, item]) => [name.decodeText(), item.toString()])));
  }
  for (const [key, value] of dict("XObject")?.entries() ?? []) {
    const stream = resolve(document, value);
    if (stream instanceof PDFRawStream && nameOf(stream.dict.get(PDFName.of("Subtype"))) === "Form") forms.set(key.decodeText(), streamText(stream));
  }
  const fonts: { base: string; embedded: boolean }[] = [];
  for (const [, value] of dict("Font")?.entries() ?? []) {
    const font = resolve(document, value) as PDFDict;
    const descendants = resolve(document, font.get(PDFName.of("DescendantFonts"))) as PDFArray | undefined;
    const cid = descendants ? resolve(document, descendants.get(0)) as PDFDict : font;
    const descriptor = resolve(document, cid.get(PDFName.of("FontDescriptor"))) as PDFDict | undefined;
    fonts.push({ base: nameOf(font.get(PDFName.of("BaseFont"))), embedded: Boolean(descriptor?.get(PDFName.of("FontFile2")) ?? descriptor?.get(PDFName.of("FontFile3"))) });
  }
  return { document, pages, colorSpaces, extGStates, forms, fonts };
}

/** Färgrymden (resursnamnet) för en plåt. */
export function spaceFor(pdf: ParsedPdf, plate: string): string | undefined {
  return [...pdf.colorSpaces].find(([, space]) => space.kind === "Separation" && space.names[0] === plate)?.[0];
}
