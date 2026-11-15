/**
 * QR-kod på papperet (ägaren 2026-11-16): löparna skannar den tryckta kartan och kommer rakt till tävlingens sida, till
 * bingons anmälan eller till O-Tid. Koden ritas som svarta rutor (vektor) på vit botten med tyst zon, felkorrigering M, och
 * adressen kort under den. Adresserna byggs ur serverns publika adress (`PaperLinks`) när arket läggs ut, så att en mall
 * eller en kopierad tävling får sin egen kod; bara "Egen adress" sparas i elementet. Typen står i `paper-items.ts`.
 */
import QRCode from "qrcode";
import type { PaperItemBase } from "./paper-items";
import type { PaperPart } from "./paper-sheet";
import { CourseSettingEditError } from "./types";

export const PAPER_QR_TARGETS = ["RACE", "BINGO", "OTID", "CUSTOM"] as const;
export type PaperQrTarget = typeof PAPER_QR_TARGETS[number];

/**
 * QR-kod: sidan i mm (med den tysta zonen), vart den leder och texten under (saknas = adressen kort, tom = ingen text).
 * `url` bara för CUSTOM (https).
 */
export interface PaperQrCode extends PaperItemBase {
  readonly kind: "QR_CODE";
  readonly sizeMm: number;
  readonly target: PaperQrTarget;
  readonly url?: string | undefined;
  readonly caption?: string | undefined;
}

/** Tävlingens publika adresser när arket läggs ut: O-Tid, tävlingens sida och (när bingon med telefonen är på) bingons. */
export interface PaperLinks {
  readonly site: string;
  readonly race?: string | undefined;
  readonly bingo?: string | undefined;
}

export const PAPER_QR_LIMITS = { minMm: 15, maxMm: 100, defaultMm: 25, urlLength: 300, captionLength: 80 } as const;
/** Tyst zon runt koden i moduler (standardens fyra). */
const QUIET_MODULES = 4;
const CAPTION = { maxEm: 0.1, minMm: 1.2, charEm: 0.55, gap: 0.2, pad: 0.8 } as const;

const invalid = (message: string) => new CourseSettingEditError("INVALID", `Papperet: ${message}`);
const within = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** En egen adress: bara https, högst 300 tecken; undefined om den inte duger. */
export function paperQrCustomUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > PAPER_QR_LIMITS.urlLength || /\s/.test(trimmed)) return undefined;
  let url: URL;
  try { url = new URL(trimmed); } catch { return undefined; }
  if (url.protocol !== "https:" || url.hostname === "" || url.username || url.password) return undefined;
  return url.href.length <= PAPER_QR_LIMITS.urlLength ? url.href : undefined;
}

type Base = Pick<PaperQrCode, "id" | "at" | "relativeTo" | "pages" | "locked" | "hide">;

export function validateQrItem(item: PaperQrCode, base: Base): PaperQrCode {
  if (!within(item.sizeMm, PAPER_QR_LIMITS.minMm, PAPER_QR_LIMITS.maxMm)) throw invalid(`QR-kodens storlek (${PAPER_QR_LIMITS.minMm}–${PAPER_QR_LIMITS.maxMm} mm)`);
  if (!(PAPER_QR_TARGETS as readonly string[]).includes(item.target)) throw invalid("vart QR-koden leder");
  let url: string | undefined;
  if (item.target === "CUSTOM") {
    url = paperQrCustomUrl(item.url);
    if (!url) throw invalid("QR-kodens adress (https://…)");
  }
  if (item.caption !== undefined && (typeof item.caption !== "string" || item.caption.length > PAPER_QR_LIMITS.captionLength || /[\r\n]/.test(item.caption))) {
    throw invalid(`texten under QR-koden (en rad, högst ${PAPER_QR_LIMITS.captionLength} tecken)`);
  }
  return { ...base, kind: "QR_CODE", sizeMm: item.sizeMm, target: item.target, ...(url ? { url } : {}),
    ...(item.caption !== undefined ? { caption: item.caption.trim() } : {}) };
}

/** Tävlingens publika adresser ur serverns publika adress och tävlingens korta kod. */
export function paperLinksFor(origin: string, shortCode: string, bingo: boolean): PaperLinks {
  const site = new URL(origin).origin;
  const race = `${site}/t/${encodeURIComponent(shortCode)}`;
  return { site, race, ...(bingo ? { bingo: `${race}/bingo` } : {}) };
}

/** Adresserna som de sparades med ett utskriftsjobb (okända fält tas bort); undefined om de saknas eller inte är https/http-adresser. */
export function validPaperLinks(value: unknown): PaperLinks | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const links = value as Record<string, unknown>;
  const web = (url: unknown) => {
    if (typeof url !== "string" || url.length > PAPER_QR_LIMITS.urlLength) return undefined;
    try { return ["https:", "http:"].includes(new URL(url).protocol) ? url : undefined; } catch { return undefined; }
  };
  const site = web(links.site), race = web(links.race), bingo = web(links.bingo);
  return site ? { site, ...(race ? { race } : {}), ...(bingo ? { bingo } : {}) } : undefined;
}

/** Adressen som QR-koden leder till, eller undefined när den inte är känd (ingen tävling, bingon av). */
export function paperQrUrl(item: Pick<PaperQrCode, "target" | "url">, links: PaperLinks | undefined): string | undefined {
  switch (item.target) {
    case "CUSTOM": return item.url;
    case "OTID": return links?.site;
    case "RACE": return links?.race;
    case "BINGO": return links?.bingo;
  }
}

/** Adressen kort, utan protokoll och avslutande snedstreck: "otid.berring.se/t/x1y2z3". */
export function shortPaperAddress(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
  } catch { return url; }
}

const captionOf = (item: PaperQrCode, url: string | undefined) => item.caption ?? (url ? shortPaperAddress(url) : "");

const cache = new Map<string, { size: number; dark: Uint8Array }>();

/** Kodens moduler (felkorrigering M): sidan i moduler och 1 = svart, rad för rad. */
export function paperQrModules(url: string): { size: number; dark: Uint8Array } {
  const hit = cache.get(url);
  if (hit) return hit;
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const out = { size: modules.size, dark: Uint8Array.from(modules.data, value => value ? 1 : 0) };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(url, out);
  return out;
}

function captionMm(item: PaperQrCode, caption: string): number {
  if (caption === "") return 0;
  const fit = (item.sizeMm - 2 * CAPTION.pad) / (caption.length * CAPTION.charEm);
  return Math.max(CAPTION.minMm, Math.min(item.sizeMm * CAPTION.maxEm, fit));
}

export function qrSize(item: PaperQrCode, links: PaperLinks | undefined): { width: number; height: number } {
  const caption = captionOf(item, paperQrUrl(item, links));
  const text = captionMm(item, caption);
  return { width: item.sizeMm, height: item.sizeMm + (text > 0 ? CAPTION.gap + text * 1.2 + CAPTION.pad / 2 : 0) };
}

/**
 * Vit botten, koden som svarta rutor (en rad i taget, sammanslagna) och texten under. Utan känd adress: en ram med "QR-kod"
 * i stället för en kod som leder fel.
 */
export function qrParts(item: PaperQrCode, at: { x: number; y: number }, links: PaperLinks | undefined): PaperPart[] {
  const url = paperQrUrl(item, links);
  const size = qrSize(item, links);
  const parts: PaperPart[] = [{ kind: "rect", x: at.x, y: at.y, width: size.width, height: size.height, fill: "WHITE", ...(url ? {} : { stroke: 0.25 }) }];
  if (!url) {
    parts.push({ kind: "text", text: "QR-kod", at: { x: at.x + item.sizeMm / 2, y: at.y + item.sizeMm / 2 + 1 }, heightMm: Math.min(4, item.sizeMm / 6), bold: true, align: "center" });
  } else {
    const { size: n, dark } = paperQrModules(url);
    const module = item.sizeMm / (n + 2 * QUIET_MODULES);
    const left = at.x + QUIET_MODULES * module, top = at.y + QUIET_MODULES * module;
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    for (let row = 0; row < n; row += 1) {
      let col = 0;
      while (col < n) {
        if (!dark[row * n + col]) { col += 1; continue; }
        const start = col;
        while (col < n && dark[row * n + col]) col += 1;
        rects.push({ x: left + start * module, y: top + row * module, width: (col - start) * module, height: module });
      }
    }
    parts.push({ kind: "cells", rects, modules: n });
  }
  const caption = captionOf(item, url);
  const text = captionMm(item, caption);
  if (text > 0) parts.push({ kind: "text", text: caption, at: { x: at.x + item.sizeMm / 2, y: at.y + item.sizeMm + CAPTION.gap + text * 0.95 }, heightMm: text, bold: false, align: "center" });
  return parts;
}
