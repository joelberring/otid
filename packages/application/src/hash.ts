import { createHash } from "node:crypto";
import { canonicalJsonBytes, evaluationResultSchema } from "@o-tid/contracts";
import type { EvaluationResult } from "@o-tid/domain";

export function contentHash(value: string | Record<string, unknown>): string {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(content).digest("hex");
}

export function evaluationHash(value: EvaluationResult): string {
  return createHash("sha256")
    .update(canonicalJsonBytes(evaluationResultSchema.parse(value)))
    .digest("hex");
}
