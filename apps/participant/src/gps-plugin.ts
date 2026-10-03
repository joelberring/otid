import { Capacitor, registerPlugin } from "@capacitor/core";

const states = [
  "IDLE", "STARTING", "WAITING_FIX", "RECORDING", "INTERRUPTED", "STOPPING", "STOPPED",
  "PERMISSION_REQUIRED", "NOTIFICATION_REQUIRED", "LOCATION_OFF", "STORAGE_ERROR", "SERVICE_ERROR"
] as const;

export type NativeGpsState = (typeof states)[number];
export type GpsState = NativeGpsState | "UNAVAILABLE";

export type GpsStatus = {
  state: GpsState;
  recordingId: string | null;
  pointCount: number;
  lastMeasuredAtMs: number | null;
  hash: string | null;
  reason?: string;
};

type NativeGpsRecorder = {
  getStatus(): Promise<unknown>;
  start(): Promise<unknown>;
  resume(): Promise<unknown>;
  stop(): Promise<unknown>;
};

const recorder = registerPlugin<NativeGpsRecorder>("OtidGpsRecorder");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;

export function parseGpsStatus(value: unknown): GpsStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Ogiltigt svar från GPS-tjänsten");
  }
  const row = value as Record<string, unknown>;
  const allowed = new Set(["state", "recordingId", "pointCount", "lastMeasuredAtMs", "hash", "reason"]);
  if (Object.keys(row).some((key) => !allowed.has(key)) ||
      typeof row.state !== "string" || !states.some((state) => state === row.state) ||
      !(row.recordingId === null || (typeof row.recordingId === "string" && uuid.test(row.recordingId))) ||
      typeof row.pointCount !== "number" || !Number.isSafeInteger(row.pointCount) || row.pointCount < 0 || row.pointCount > 100_000 ||
      !(row.lastMeasuredAtMs === null || (typeof row.lastMeasuredAtMs === "number" &&
        Number.isSafeInteger(row.lastMeasuredAtMs) && row.lastMeasuredAtMs > 0)) ||
      !(row.hash === null || (typeof row.hash === "string" && hash.test(row.hash))) ||
      !(row.reason === undefined || (typeof row.reason === "string" && row.reason.length > 0 && row.reason.length <= 80))) {
    throw new Error("Ogiltigt svar från GPS-tjänsten");
  }
  if (row.state === "RECORDING" || row.state === "WAITING_FIX" || row.state === "INTERRUPTED" || row.state === "STOPPED") {
    if (row.recordingId === null) throw new Error("GPS-tjänsten saknar inspelningsidentitet");
  }
  if (row.state === "STOPPED" && row.hash === null) {
    throw new Error("Den stoppade GPS-versionen saknar kontrollsumma");
  }
  if (row.pointCount > 0 && row.lastMeasuredAtMs === null) {
    throw new Error("GPS-punkter saknar senaste mättid");
  }
  return row as GpsStatus;
}

const unavailable: GpsStatus = {
  state: "UNAVAILABLE", recordingId: null, pointCount: 0, lastMeasuredAtMs: null, hash: null
};

async function invoke(method: keyof NativeGpsRecorder): Promise<GpsStatus> {
  if (Capacitor.getPlatform() !== "android") return unavailable;
  return parseGpsStatus(await recorder[method]());
}

export const getGpsStatus = (): Promise<GpsStatus> => invoke("getStatus");
export const startGps = (): Promise<GpsStatus> => invoke("start");
export const resumeGps = (): Promise<GpsStatus> => invoke("resume");
export const stopGps = (): Promise<GpsStatus> => invoke("stop");
