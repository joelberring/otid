/** ADR-0207: skrivarnas gemensamma svar före kontrollen. */
import type { ByteEdit, MapRevisionRefusal, MapRevisionRefusalCode, ObjectLocator } from "./change-set";

export interface WriteOutcome {
  readonly bytes: Uint8Array;
  readonly edits: readonly ByteEdit[];
  readonly addedObjects: readonly { readonly id: string; readonly locator: ObjectLocator }[];
}

export type WriteResult = { readonly ok: true; readonly value: WriteOutcome } | { readonly ok: false; readonly refusals: readonly MapRevisionRefusal[] };

export function refusal(code: MapRevisionRefusalCode, message: string, change?: number): MapRevisionRefusal {
  return change === undefined ? { code, message } : { code, message, change };
}

/** Ändringens nummer i meddelanden (1, 2, 3 …). */
export const changeLabel = (index: number) => `Ändring ${index + 1}`;
