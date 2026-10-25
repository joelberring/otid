import { relayLegRestarted, relayLegStartTime, type RelayLegRule } from "./relay";

/**
 * Starttider för alla lag i en stafettklass (steg 47, ADR-0174). Sträckans start beror på lagets egen
 * växling från föregående sträcka och, vid flygande omstart, på ledarlagets växling: omstartstiden är
 * den första växlingen till sträckan i klassen (oavsett lagets status, eftersom felstämpling blir känd
 * först vid avläsningen) plus sträckans gräns i minuter. Utan någon växling än finns ingen flygande
 * omstartstid och lagen startar när de växlar.
 *
 * Fast omstart (RESTART), flygande omstart, växling och masstart kan blandas fritt i samma klass.
 * Funktionen är ren; måltiderna kommer från resultaten och avläsningarna och påverkas inte av
 * sträckornas egna starter, så allt kan räknas i ett svep.
 */
export interface RelayTeamChangeovers {
  readonly key: string;
  /** Tiden laget växlade ut från sträckan (sträckans måltid för laget). Saknas = inte växlat än. */
  readonly changeovers: ReadonlyMap<number, string | undefined>;
}

export interface RelayLegRestart {
  readonly leg: number;
  /** Omstartstiden. Saknas för en flygande omstart innan något lag växlat. */
  readonly time?: string;
  /** Flygande omstart: ledarlagets växling och laget som växlade först. */
  readonly leaderChangeover?: string;
  readonly leaderKey?: string;
  readonly restartAfterMinutes?: number;
}

export interface RelayLegStart {
  readonly start?: string;
  readonly restarted: boolean;
}

export interface RelayClassLegStarts {
  /** Omstarterna i klassen (fasta och flygande), per sträcka. */
  readonly restarts: ReadonlyMap<number, RelayLegRestart>;
  readonly teams: ReadonlyMap<string, ReadonlyMap<number, RelayLegStart>>;
}

function compareKey(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Första växlingen till sträckan `leg` (ut från sträcka leg − 1) bland lagen. */
export function relayLeaderChangeover(teams: readonly RelayTeamChangeovers[], leg: number): { key: string; time: string } | undefined {
  let best: { key: string; time: string; ms: number } | undefined;
  for (const team of teams) {
    const time = team.changeovers.get(leg - 1);
    if (time === undefined) continue;
    const ms = Date.parse(time);
    if (!Number.isFinite(ms)) continue;
    if (!best || ms < best.ms || (ms === best.ms && compareKey(team.key, best.key) < 0)) best = { key: team.key, time, ms };
  }
  return best && { key: best.key, time: best.time };
}

export function relayClassLegStarts(rules: readonly RelayLegRule[], teams: readonly RelayTeamChangeovers[]): RelayClassLegStarts {
  const sorted = [...rules].sort((left, right) => left.leg - right.leg);
  const restarts = new Map<number, RelayLegRestart>();
  for (const rule of sorted) {
    if (rule.startMethod === "RESTART") {
      restarts.set(rule.leg, { leg: rule.leg, ...(rule.startTime === undefined ? {} : { time: rule.startTime }) });
    } else if (rule.startMethod === "FLYING_RESTART") {
      const leader = relayLeaderChangeover(teams, rule.leg);
      const after = rule.restartAfterMinutes ?? 0;
      restarts.set(rule.leg, { leg: rule.leg, restartAfterMinutes: after, ...(leader ? {
        time: new Date(Date.parse(leader.time) + after * 60_000).toISOString(), leaderChangeover: leader.time, leaderKey: leader.key } : {}) });
    }
  }
  const byTeam = new Map<string, Map<number, RelayLegStart>>();
  for (const team of teams) {
    const starts = new Map<number, RelayLegStart>();
    for (const rule of sorted) {
      const previous = rule.leg === 1 ? undefined : team.changeovers.get(rule.leg - 1);
      const flying = rule.startMethod === "FLYING_RESTART" ? restarts.get(rule.leg)?.time : undefined;
      const start = relayLegStartTime(rule, previous, flying);
      starts.set(rule.leg, { ...(start === undefined ? {} : { start }), restarted: start !== undefined && relayLegRestarted(rule, previous, flying) });
    }
    byTeam.set(team.key, starts);
  }
  return { restarts, teams: byTeam };
}
