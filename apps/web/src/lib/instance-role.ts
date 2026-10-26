/**
 * Steg 54 (ADR-0177): vilket slags webbinstans den här processen är. I drift kör `docker-compose.prod.yml` två:
 *
 * - `competition` (tjänsten `web`): arbetsytan, avläsningen, funktionärerna, inloggningen och admin-API:t. Får mer
 *   processortid och egna databasanslutningar. Publika listor räknas här bara när någon inloggad frågar.
 * - `public` (tjänsten `web-public`): publika sidor och API:er, Live, resultatströmmen och speakerns publika delar.
 *   Lägre prioritet, egen liten pool med tidsgräns, och lastavlastning när processen inte hinner.
 * - `all` (förval, lokalt och med en enda instans): allt i samma process, med tävlingen före publiken i poolerna.
 *
 * Caddy (deploy/Caddyfile) delar upp anropen per sökväg; varje instans klarar ändå alla sökvägar.
 */
export type InstanceRole = "competition" | "public" | "all";

export function instanceRole(environment: Partial<Record<string, string | undefined>> = process.env): InstanceRole {
  const value = environment.OTID_INSTANCE_ROLE?.trim().toLowerCase();
  return value === "competition" || value === "public" ? value : "all";
}

/** Ett positivt heltal ur miljön, annars förvalet. */
export function environmentNumber(environment: Partial<Record<string, string | undefined>>, name: string, fallback: number): number {
  const value = Number(environment[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
