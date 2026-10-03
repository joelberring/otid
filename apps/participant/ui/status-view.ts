import type { GpsStatus } from "../src/gps-plugin";
import { sv } from "./sv";

export type StatusView = {
  tone: "neutral" | "warning" | "ready" | "error";
  title: string;
  detail: string;
  canStart: boolean;
  canResume: boolean;
  canStop: boolean;
};

export function describeStatus(status: GpsStatus): StatusView {
  const copy = sv.state[status.state];
  return {
    ...copy,
    canStart: ["IDLE", "STOPPED", "PERMISSION_REQUIRED", "NOTIFICATION_REQUIRED", "LOCATION_OFF"].includes(status.state),
    canResume: status.state === "INTERRUPTED",
    canStop: ["RECORDING", "WAITING_FIX", "INTERRUPTED"].includes(status.state)
  };
}
