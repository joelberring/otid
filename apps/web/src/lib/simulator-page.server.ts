import "server-only";
import { headers } from "next/headers";
import { resolveSimulatorPage, type SimulatorPageProjection } from "./simulator-access-policy";

export async function resolveCurrentSimulatorPage(
  params: Promise<{ raceId: string }>,
  loadSnapshotVersion: (raceId: string) => Promise<number | null>
): Promise<SimulatorPageProjection | null> {
  const requestHeaders = await headers();
  return resolveSimulatorPage({
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      O_TID_PUBLIC_ORIGIN: process.env.O_TID_PUBLIC_ORIGIN,
      O_TID_SIMULATOR_MODE: process.env.O_TID_SIMULATOR_MODE
    },
    authority: {
      host: requestHeaders.get("host"),
      forwardedHost: requestHeaders.get("x-forwarded-host"),
      forwardedProto: requestHeaders.get("x-forwarded-proto")
    },
    params
  }, loadSnapshotVersion);
}
