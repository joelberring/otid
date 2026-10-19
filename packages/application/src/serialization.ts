import { createHash } from "node:crypto";
import { UUID_PATTERN, canonicalJsonBytes, evaluationResultSchema } from "@o-tid/contracts";
import type { EvaluationResult } from "@o-tid/domain";

/** UUID-mönstret, SHA-256 och den kanoniska serialiseringen för applikationslagret (steg 23). */
export { UUID_PATTERN, canonicalJsonBytes };

/** SHA-256 i gemen hex av bytes eller UTF-8-text. */
export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 av värdets kanoniska JSON (sorterade nycklar). */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJsonBytes(value));
}

export function contentHash(value: string | Record<string, unknown>): string {
  return sha256Hex(typeof value === "string" ? value : JSON.stringify(value));
}

export function evaluationHash(value: EvaluationResult): string {
  return canonicalHash(evaluationResultSchema.parse(value));
}

/** Ordning på kodpunkter, oberoende av språkinställning. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
