import QRCode from "qrcode";
import type { ReadoutPackage } from "@o-tid/contracts";
import { formatRunningTime, type LocalVerdict } from "./evaluate";
import { readoutText } from "./text-sv";

/**
 * Sträcktidskvitto efter avläsning (PLAN.md steg 21). Byggs helt av det lokala beskedet och avläsningspaketet, så
 * det går att skriva ut utan nät. Placering visas inte: utan nät känner enheten bara sina egna avläsningar, och
 * andra stationer och senare avläsningar ändrar placeringen – QR-koden leder till den aktuella resultatlistan.
 */
const t = readoutText.receipt;

export interface ReceiptRow { readonly index: string; readonly code: string; readonly leg: string; readonly total: string }

export interface Receipt {
  readonly eventName: string;
  /** Loppets namn (om det skiljer sig från tävlingens) och datum. */
  readonly details: string;
  readonly runner?: string;
  /** Klass och klubb. */
  readonly team?: string;
  readonly card: string;
  readonly symbol: string;
  readonly status: string;
  /** Löptid, eller rogainingens summa. */
  readonly result?: string;
  /** Orsak, saknade kontroller, stafett och variant. */
  readonly notes: readonly string[];
  /** Rogaining: kontrollpoäng, straff och tid mot gränsen. */
  readonly lines: readonly { readonly label: string; readonly value: string }[];
  readonly columns: readonly [string, string, string, string];
  readonly rows: readonly ReceiptRow[];
  readonly qr: { readonly url: string; readonly address: string; readonly published: boolean };
  readonly printedAt: string;
}

export interface ReceiptInput {
  readonly verdict: LocalVerdict;
  readonly cardNumber: string;
  readonly pkg: ReadoutPackage;
  /** Webbplatsens adress, t.ex. https://o-tid.se (avläsningen körs från samma adress). */
  readonly origin: string;
  readonly printedAt: Date;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

/**
 * QR-kodens mål: löparens publika resultat när deltagaren finns i paketet, annars tävlingssidans korta adress.
 * Paket sparade före steg 21 saknar länkarna; då leder koden till tävlingens resultatlista.
 */
export function receiptLink(pkg: ReadoutPackage, entryId: string | undefined, origin: string): Receipt["qr"] {
  const base = origin.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const links = pkg.publicLinks;
  if (!links) return { url: `${base}/results/${pkg.raceId}`, address: `${host}/results`, published: true };
  const participant = entryId ? links.participants.find((row) => row.entryId === entryId) : undefined;
  const url = participant ? `${base}/results/${pkg.raceId}/participants/${participant.publicResultId}` : `${base}/t/${links.shortCode}`;
  return { url, address: `${host}/t/${links.shortCode}`, published: links.published };
}

export function buildReceipt({ verdict, cardNumber, pkg, origin, printedAt }: ReceiptInput): Receipt {
  const race = pkg.raceSnapshot.race;
  const symbol = verdict.status === "OK" ? "✓" : verdict.status === "MP" ? "✗" : "?";
  const notes: string[] = [];
  const reason = readoutText.reason[verdict.reason];
  if (verdict.status !== "OK" && reason) notes.push(reason);
  if (verdict.missingControls.length > 0) notes.push(t.missing(verdict.missingControls));
  if (verdict.relay) notes.push(readoutText.relayTeam(verdict.relay.teamNumber, verdict.relay.teamName, verdict.relay.leg, verdict.relay.legCount));
  if (verdict.variant) notes.push(verdict.variant.assigned ? readoutText.variant(verdict.variant.code) : readoutText.variantGuessed(verdict.variant.code));

  const score = verdict.rogaining;
  const lines = score && verdict.elapsedMs !== undefined ? [
    { label: t.controlPoints, value: readoutText.rogainingPoints(score.controlPoints) },
    { label: t.penalty, value: score.penalty > 0 ? `−${readoutText.rogainingPoints(score.penalty)}` : readoutText.rogainingPoints(0) },
    { label: t.time, value: t.timeOfLimit(formatRunningTime(verdict.elapsedMs), formatRunningTime(score.timeLimitMs)) }
  ] : [];
  if (score && score.overtimeMinutes > 0) notes.push(readoutText.rogainingLate(score.overtimeMinutes));

  return {
    eventName: pkg.event.name,
    details: [race.name !== pkg.event.name ? race.name : undefined, formatDate(race.raceDate)].filter(Boolean).join(" · "),
    ...(verdict.name ? { runner: verdict.name } : {}),
    ...(verdict.className || verdict.club ? { team: [verdict.className, verdict.club].filter(Boolean).join(" · ") } : {}),
    card: t.card(cardNumber),
    symbol,
    status: readoutText.verdict[verdict.status],
    ...(score ? { result: readoutText.rogainingTotal(score.total) }
      : verdict.status === "OK" && verdict.elapsedMs !== undefined ? { result: formatRunningTime(verdict.elapsedMs) } : {}),
    notes,
    lines,
    columns: score ? t.rogainingColumns : t.columns,
    rows: score ? rogainingRows(verdict) : splitRows(verdict),
    qr: receiptLink(pkg, verdict.entryId, origin),
    printedAt: t.printedAt(new Intl.DateTimeFormat("sv-SE", { timeZone: pkg.event.timeZone, day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit" }).format(printedAt))
  };
}

/** Sträcktider i stämplad ordning och sist sträckan till mål, när målstämplingen finns. */
function splitRows(verdict: LocalVerdict): ReceiptRow[] {
  const rows: ReceiptRow[] = verdict.splits.map((split, index) => ({ index: String(index + 1), code: String(split.controlCode),
    leg: formatRunningTime(split.legMs), total: formatRunningTime(split.elapsedMs) }));
  if (verdict.elapsedMs !== undefined) {
    const last = verdict.splits.at(-1)?.elapsedMs ?? 0;
    if (verdict.elapsedMs >= last) {
      rows.push({ index: "", code: t.finish, leg: formatRunningTime(verdict.elapsedMs - last), total: formatRunningTime(verdict.elapsedMs) });
    }
  }
  return rows;
}

/** Rogaining: de räknade kontrollerna med poäng och tid från start. */
function rogainingRows(verdict: LocalVerdict): ReceiptRow[] {
  const times = new Map(verdict.splits.map((split) => [split.controlCode, split.elapsedMs]));
  return (verdict.rogaining?.controls ?? []).map((control, index) => {
    const elapsed = times.get(control.controlCode);
    return { index: String(index + 1), code: String(control.controlCode), leg: readoutText.rogainingPoints(control.points),
      total: elapsed === undefined ? "" : formatRunningTime(elapsed) };
  });
}

/**
 * QR-kodens mörka moduler som en SVG-bana (en ruta per modul), med `margin` modulers tyst zon. Skapas med
 * biblioteket `qrcode` (felkorrigering M), samma som tävlingssidans QR-kod, helt i webbläsaren.
 */
export function qrPath(text: string, margin = 2): { size: number; path: string } {
  const modules = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) parts.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return { size: modules.size + margin * 2, path: parts.join("") };
}
