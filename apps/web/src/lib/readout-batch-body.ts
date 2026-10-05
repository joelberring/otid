/**
 * Avläsningens batch från webbläsaren (steg 4, ADR-0168) läses med en övre gräns innan den tolkas,
 * så att en för stor eller trasig begäran stoppas utan att hela kroppen hålls i minnet.
 */
export const DEVICE_BATCH_MAX_BODY_BYTES = 4 * 1024 * 1024;

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
