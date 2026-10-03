import { redeemStationPairingGrant } from "@o-tid/application";
import { stationPairingRedemptionResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";

export const privatePairingHeaders = {
  "cache-control": "no-store, private",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff"
};

type PairingRedeemer = typeof redeemStationPairingGrant;

const MAX_PAIRING_BODY_BYTES = 8 * 1024;

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_PAIRING_BODY_BYTES)) {
    throw new Error("Ogiltig bodylängd");
  }
  if (!request.body) throw new Error("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PAIRING_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Bodyn är för stor");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function pairingFailure(status: 400 | 401 | 409 | 429 | 500, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { ...privatePairingHeaders };
  if (status === 401) headers["www-authenticate"] = "Bearer";
  if (status === 429 && retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(retryAfterSeconds);
  }
  return Response.json({ error: "Parningen kunde inte genomföras" }, { status, headers });
}

export async function stationPairingRedemptionResponse(
  db: Database,
  request: Request,
  redeem: PairingRedeemer = redeemStationPairingGrant
): Promise<Response> {
  try {
    const result = await redeem(db, {
      authorization: request.headers.get("authorization"),
      idempotencyKey: request.headers.get("idempotency-key"),
      readBody: () => readBoundedJson(request)
    });
    if (result.status === "stored" || result.status === "duplicate") {
      return Response.json(stationPairingRedemptionResponseSchema.parse(result.response), {
        status: 200,
        headers: privatePairingHeaders
      });
    }
    if (result.status === "rate-limited") return pairingFailure(429, result.retryAfterSeconds);
    if (result.status === "invalid-request") return pairingFailure(400);
    if (result.status === "conflict") return pairingFailure(409);
    return pairingFailure(401);
  } catch {
    return pairingFailure(500);
  }
}
