import { CapacitorHttp } from "@capacitor/core";

export interface StationHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  data?: unknown;
  connectTimeoutMs: number;
  readTimeoutMs: number;
}

export interface StationHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  url: string;
}

export type StationHttpRequester = (request: StationHttpRequest) => Promise<StationHttpResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error("HTTP-klienten gav ogiltiga headers");
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value)) {
    if (typeof header !== "string") throw new Error("HTTP-klienten gav ogiltiga headers");
    headers[key.toLowerCase()] = header;
  }
  return headers;
}

function parseNativeResponse(value: unknown): StationHttpResponse {
  if (!isRecord(value) || typeof value.status !== "number" || !Number.isSafeInteger(value.status) ||
      typeof value.url !== "string") {
    throw new Error("HTTP-klienten gav ett ogiltigt svar");
  }
  return {
    status: value.status,
    headers: parseHeaders(value.headers),
    data: value.data,
    url: value.url
  };
}

export const capacitorHttpRequester: StationHttpRequester = async (request) => {
  const response: unknown = await CapacitorHttp.request({
    url: request.url,
    method: request.method,
    ...(request.headers === undefined ? {} : { headers: request.headers }),
    ...(request.data === undefined ? {} : { data: request.data }),
    connectTimeout: request.connectTimeoutMs,
    readTimeout: request.readTimeoutMs,
    responseType: "text",
    disableRedirects: true,
    webFetchExtra: { credentials: "omit", cache: "no-store" }
  });
  return parseNativeResponse(response);
};

export function parseBoundedJsonResponse(response: StationHttpResponse, maxLength: number, label: string): unknown {
  const declaredLength = response.headers["content-length"];
  if (declaredLength !== undefined && Number(declaredLength) > maxLength) {
    throw new Error(`Servern gav ett för stort ${label}`);
  }
  let text: string;
  if (typeof response.data === "string") {
    text = response.data;
  } else {
    try {
      text = JSON.stringify(response.data);
    } catch {
      throw new Error(`Servern gav inte ${label} som giltig JSON`);
    }
  }
  if (text.length === 0 || text.length > maxLength) throw new Error(`Servern gav ett för stort ${label}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Servern gav inte ${label} som giltig JSON`);
  }
}
