/** Konfliktgranskningens begäran är liten: högst 64 KiB JSON. */
export const CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES = 64 * 1024;

export class ConflictReviewRequestError extends Error {
  constructor(readonly tooLarge = false) { super(); }
}

export async function readReviewJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") throw new ConflictReviewRequestError();
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1)) {
    throw new ConflictReviewRequestError();
  }
  if (declaredLength !== null && Number(declaredLength) > CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES) {
    throw new ConflictReviewRequestError(true);
  }
  if (!request.body) throw new ConflictReviewRequestError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES) throw new ConflictReviewRequestError(true);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new ConflictReviewRequestError();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ConflictReviewRequestError();
  }
}
