export interface SimulatorAccessEnvironment {
  NODE_ENV?: string | undefined;
  O_TID_PUBLIC_ORIGIN?: string | undefined;
  O_TID_SIMULATOR_MODE?: string | undefined;
}

export interface SimulatorRequestAuthority {
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
}

export interface SimulatorPageResolutionInput {
  environment: SimulatorAccessEnvironment;
  authority: SimulatorRequestAuthority;
  params: Promise<{ raceId: string }>;
}

export interface SimulatorPageProjection {
  raceId: string;
  snapshotVersion: number;
}

const RACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isSingleCanonicalHeader(value: string | null): value is string {
  return value !== null && value.length > 0 && value.trim() === value && !value.includes(",");
}

function configuredLoopbackOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    value !== url.origin ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !LOOPBACK_HOSTNAMES.has(url.hostname)
  ) return null;
  return url;
}

export function isSimulatorPageAllowed(
  environment: SimulatorAccessEnvironment,
  authority: SimulatorRequestAuthority
): boolean {
  if (
    environment.NODE_ENV !== "development" ||
    environment.O_TID_SIMULATOR_MODE !== "loopback-development"
  ) return false;

  const origin = configuredLoopbackOrigin(environment.O_TID_PUBLIC_ORIGIN);
  if (!origin) return false;
  if (
    !isSingleCanonicalHeader(authority.host) ||
    !isSingleCanonicalHeader(authority.forwardedHost) ||
    !isSingleCanonicalHeader(authority.forwardedProto)
  ) return false;
  return authority.host === origin.host &&
    authority.forwardedHost === origin.host &&
    authority.forwardedProto === "http";
}

export async function resolveSimulatorPage(
  input: SimulatorPageResolutionInput,
  loadSnapshotVersion: (raceId: string) => Promise<number | null>
): Promise<SimulatorPageProjection | null> {
  if (!isSimulatorPageAllowed(input.environment, input.authority)) return null;

  const { raceId } = await input.params;
  if (!RACE_ID.test(raceId)) return null;
  const snapshotVersion = await loadSnapshotVersion(raceId);
  return snapshotVersion === null ? null : { raceId, snapshotVersion };
}
