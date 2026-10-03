import "server-only";

import {
  authenticateStationBearer,
  hasStationCredentialScope,
  ingestDeviceBatch
} from "@o-tid/application";
import { deviceBatchAcknowledgementSchema, deviceBatchSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  privateStationHeaders,
  stationBatchFailure,
  stationForbidden,
  stationInvalidBatch,
  stationUnauthorized
} from "./station-auth-response";

export const DEVICE_BATCH_MAX_BODY_BYTES = 4 * 1024 * 1024;

type Authenticate = typeof authenticateStationBearer;
type Ingest = typeof ingestDeviceBatch;

export interface DeviceBatchRouteDependencies {
  authenticate?: Authenticate;
  ingest?: Ingest;
}

export class DeviceBatchRequestError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super("Ogiltigt device-batch-kuvert");
    this.name = "DeviceBatchRequestError";
  }
}

function declaredBodyLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new DeviceBatchRequestError(400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new DeviceBatchRequestError(413);
  if (parsed > DEVICE_BATCH_MAX_BODY_BYTES) throw new DeviceBatchRequestError(413);
  return parsed;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The request is already rejected; a transport-level cancel error must not leak.
  }
}

export async function readBoundedDeviceBatchJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new DeviceBatchRequestError(415);
  }
  const declaredLength = declaredBodyLength(request);
  if (!request.body) throw new DeviceBatchRequestError(400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let actualLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      actualLength += value.byteLength;
      if (actualLength > DEVICE_BATCH_MAX_BODY_BYTES) {
        await cancelReader(reader);
        throw new DeviceBatchRequestError(413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DeviceBatchRequestError) throw error;
    await cancelReader(reader);
    throw new DeviceBatchRequestError(400);
  }

  if (actualLength === 0 || (declaredLength !== undefined && declaredLength !== actualLength)) {
    throw new DeviceBatchRequestError(400);
  }

  const bytes = new Uint8Array(actualLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new DeviceBatchRequestError(400);
  }
}

export async function deviceBatchRoute(
  db: Database,
  request: Request,
  raceId: string,
  dependencies: DeviceBatchRouteDependencies = {}
): Promise<Response> {
  const authenticate = dependencies.authenticate ?? authenticateStationBearer;
  const ingest = dependencies.ingest ?? ingestDeviceBatch;

  let authentication: Awaited<ReturnType<Authenticate>>;
  try {
    authentication = await authenticate(db, request.headers.get("authorization"));
  } catch {
    return stationBatchFailure();
  }
  if (authentication.status === "unauthorized") return stationUnauthorized();
  if (!hasStationCredentialScope(authentication.principal, { raceId, scope: "READOUT" })) {
    return stationForbidden();
  }

  let body: unknown;
  try {
    body = await readBoundedDeviceBatchJson(request);
  } catch (error) {
    if (error instanceof DeviceBatchRequestError) return stationInvalidBatch(error.status);
    return stationBatchFailure();
  }
  const parsed = deviceBatchSchema.safeParse(body);
  if (!parsed.success) return stationInvalidBatch(400);
  if (!hasStationCredentialScope(authentication.principal, {
    raceId,
    deviceId: parsed.data.deviceId,
    scope: "READOUT"
  })) return stationForbidden();

  const expectedIdempotencyKey = `${parsed.data.deviceId}:${parsed.data.firstSequence}:${parsed.data.lastSequence}`;
  if (request.headers.get("idempotency-key") !== expectedIdempotencyKey) {
    return stationInvalidBatch(400);
  }
  try {
    const acknowledgement = await ingest(db, raceId, parsed.data);
    return Response.json(deviceBatchAcknowledgementSchema.parse(acknowledgement), {
      headers: privateStationHeaders
    });
  } catch {
    return stationBatchFailure();
  }
}
