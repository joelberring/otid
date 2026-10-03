import type { SiCardData, SiStationRecord } from "./decode";
import { resolveSiTime, type ResolveTimeOptions } from "./time";

/**
 * Avläsning med absoluta tider. Formen stämmer med domänens
 * `EvaluationReadout` (bricknummer som text, ISO-tider), så att den kan gå
 * direkt till resultatmotorn utan att detta paket beror på domänpaketet.
 */
export interface NormalizedSiReadout {
  readonly cardNumber: string;
  readonly cardType: SiCardData["cardType"];
  readonly startPunchedAt?: string;
  readonly finishPunchedAt?: string;
  readonly checkPunchedAt?: string;
  readonly clearPunchedAt?: string;
  readonly punches: readonly { readonly code: number; readonly punchedAt: string }[];
  /** SI5-stämplingar 31–36 som bara har kontrollkod. Tas inte med i `punches`. */
  readonly untimedPunchCodes: readonly number[];
}

export function normalizeCard(card: SiCardData, options: ResolveTimeOptions): NormalizedSiReadout {
  const iso = (record: SiStationRecord | undefined): string | undefined =>
    record ? resolveSiTime(record.time, options).toISOString() : undefined;
  const punches: { code: number; punchedAt: string }[] = [];
  const untimed: number[] = [];
  for (const punch of card.punches) {
    if (punch.time) punches.push({ code: punch.code, punchedAt: resolveSiTime(punch.time, options).toISOString() });
    else untimed.push(punch.code);
  }
  const start = iso(card.start);
  const finish = iso(card.finish);
  const check = iso(card.check);
  const clear = iso(card.clear);
  return {
    cardNumber: String(card.cardNumber),
    cardType: card.cardType,
    ...(start ? { startPunchedAt: start } : {}),
    ...(finish ? { finishPunchedAt: finish } : {}),
    ...(check ? { checkPunchedAt: check } : {}),
    ...(clear ? { clearPunchedAt: clear } : {}),
    punches,
    untimedPunchCodes: untimed
  };
}
