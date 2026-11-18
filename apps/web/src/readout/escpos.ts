import type { Receipt } from "./receipt";

/**
 * Kvittot som ESC/POS för en kvittoskrivare över Bluetooth (t.ex. SPORTidents SI Printer 2). Samma innehåll som
 * `ReceiptView` (webbläsarens utskrift), som text: 32 tecken per rad på 58 mm, 48 på 80 mm. Teckentabellen är
 * Windows-1252 (ESC t 16), så åäö, øæ, ü och é skrivs rätt. QR-koden ritar skrivaren själv (GS ( k).
 * Provat mot SI Printer 2 (HS6602M) 2026-11-18.
 */

const ESC = 0x1b, GS = 0x1d, FS = 0x1c;

const INIT = [ESC, 0x40];
/** Kinesiskt läge av (många billiga skrivare startar i det), sedan Windows-1252. */
const CODE_PAGE = [FS, 0x2e, ESC, 0x74, 16];
const align = (where: "left" | "center") => [ESC, 0x61, where === "center" ? 1 : 0];
const bold = (on: boolean) => [ESC, 0x45, on ? 1 : 0];
/** Dubbel höjd (namnet) eller vanlig storlek. */
const tall = (on: boolean) => [GS, 0x21, on ? 0x01 : 0x00];
const feed = (lines: number) => [ESC, 0x64, lines];

/** Windows-1252 där den skiljer sig från Latin-1 (0x80–0x9F). */
const CP1252_EXTRA: Readonly<Record<string, number>> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "Š": 0x8a, "š": 0x9a, "Ž": 0x8e, "ž": 0x9e, "Œ": 0x8c, "œ": 0x9c, "Ÿ": 0x9f
};

/** Text som Windows-1252; tecken som saknas blir "?" (kontrolltecken blir mellanslag). */
export function encodeCp1252(text: string): number[] {
  const out: number[] = [];
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (code === 0x0a) out.push(code);
    else if (code < 0x20 || code === 0x7f) out.push(0x20);
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(CP1252_EXTRA[char] ?? 0x3f);
  }
  return out;
}

/** Radbryter vid mellanslag; ord som är längre än raden delas. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let rest = word; rest.length > 0;) {
      const room = line ? width - line.length - 1 : width;
      if (rest.length <= room) { line = line ? `${line} ${rest}` : rest; rest = ""; }
      else if (line) { lines.push(line); line = ""; }
      else { lines.push(rest.slice(0, width)); rest = rest.slice(width); }
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** Vänster och höger på samma rad; ryms de inte står det högra på en egen rad. */
function spread(left: string, right: string, width: number): string[] {
  if (left.length + 1 + right.length <= width) return [left + " ".repeat(width - left.length - right.length) + right];
  return [...wrap(left, width), right.padStart(width)];
}

/** GS ( k: QR-kod (modell 2, felkorrigering M) som skrivaren ritar. */
function qr(data: string, moduleSize: number): number[] {
  const bytes = encodeCp1252(data);
  const store = bytes.length + 3;
  return [GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31,
    GS, 0x28, 0x6b, store & 0xff, store >> 8, 0x31, 0x50, 0x30, ...bytes,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30];
}

export interface EscPosTexts { readonly noSplits: string; readonly scan: string; readonly footer: string }

/** Kvittot som bytes att skicka till skrivaren. `paperMm` 58 ger 32 tecken per rad, 80 ger 48. */
export function receiptToEscPos(receipt: Receipt, options: { paperMm: 58 | 80; text: EscPosTexts }): Uint8Array {
  const width = options.paperMm === 58 ? 32 : 48;
  const out: number[] = [...INIT, ...CODE_PAGE];
  const lines = (texts: readonly string[]) => { for (const text of texts) out.push(...encodeCp1252(text), 0x0a); };
  const block = (text: string) => lines(wrap(text, width));

  out.push(...align("center"), ...bold(true));
  block(receipt.eventName);
  out.push(...bold(false));
  block(receipt.details);
  out.push(0x0a, ...align("left"));

  if (receipt.runner) { out.push(...bold(true), ...tall(true)); block(receipt.runner); out.push(...tall(false), ...bold(false)); }
  if (receipt.team) block(receipt.team);
  block(receipt.card);
  out.push(0x0a);

  out.push(...bold(true));
  lines(spread(receipt.status, receipt.result ?? "", width));
  out.push(...bold(false));
  for (const note of receipt.notes) block(note);
  for (const line of receipt.lines) lines(spread(line.label, line.value, width));
  out.push(0x0a);

  if (receipt.rows.length === 0) block(options.text.noSplits);
  else {
    // Nr, kontroll, sträcka, tid: 4 + 8 + 10 + 10 = 32 (58 mm) eller 6 + 12 + 15 + 15 = 48 (80 mm).
    const widths = width === 32 ? [4, 8, 10, 10] : [6, 12, 15, 15];
    const row = (cells: readonly string[]) => cells.map((cell, index) =>
      index === 0 ? cell.slice(0, widths[0]).padEnd(widths[0]!) : cell.slice(0, widths[index]).padStart(widths[index]!)).join("");
    out.push(...bold(true));
    lines([row(receipt.columns)]);
    out.push(...bold(false));
    lines(receipt.rows.map((r) => row([r.index, r.code, r.leg, r.total])));
  }
  out.push(0x0a);

  out.push(...align("center"), ...qr(receipt.qr.url, width === 32 ? 5 : 6), 0x0a);
  block(options.text.scan);
  block(receipt.qr.address);
  block(`${receipt.printedAt} · ${options.text.footer}`);
  out.push(...align("left"), ...feed(4));
  return Uint8Array.from(out);
}
