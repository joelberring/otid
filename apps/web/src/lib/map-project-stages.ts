/**
 * Ägaren 2026-11-13 (Ornö södra): en laserkörning som servern delat i etapper («… – etapp 2 av 3», se
 * `map-project-geo-jobs.ts`) ska kunna läsas in som en grundkarta i stället för en remsa i taget. Här hittas etappens
 * syskon ur jobblistan: samma namn och antal, klara, från samma omgång.
 */
const STAGE = /^(.*) – etapp (\d+) av (\d+)$/;
/** Etapperna i en omgång skapas i samma anrop; äldre körningar med samma namn hör inte dit. */
const SAME_BATCH_MS = 10 * 60_000;

interface StageJob { readonly jobId: string; readonly name: string; readonly status: string; readonly createdAt: string; readonly clip: unknown }

export function stageOf(name: string): { base: string; index: number; total: number } | undefined {
  const match = STAGE.exec(name);
  return match ? { base: match[1]!, index: Number(match[2]), total: Number(match[3]) } : undefined;
}

/**
 * Alla etapper i jobbets omgång, i ordning, när alla är klara och har en klippruta; annars `undefined` (jobbet är ingen
 * etapp, eller någon etapp körs fortfarande, misslyckades eller är borttagen).
 */
export function completeStages<T extends StageJob>(job: T, jobs: readonly T[]): T[] | undefined {
  const own = stageOf(job.name);
  if (!own || own.total < 2) return undefined;
  const at = Date.parse(job.createdAt);
  const batch = jobs.filter(row => {
    const stage = stageOf(row.name);
    return stage?.base === own.base && stage.total === own.total && Math.abs(Date.parse(row.createdAt) - at) <= SAME_BATCH_MS;
  });
  const ordered: T[] = [];
  for (let index = 1; index <= own.total; index += 1) {
    const newest = batch.filter(row => stageOf(row.name)!.index === index).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!newest || newest.status !== "DONE" || !newest.clip) return undefined;
    ordered.push(newest);
  }
  return ordered;
}

export interface StageChoice<T> {
  /** `etapper:` och första etappens id för alla etapper, annars jobbets id. */
  readonly id: string;
  /** Alla etapper i ordning, eller bara jobbet. */
  readonly jobs: readonly T[];
  /** Namnet utan etapp när valet är alla etapper. */
  readonly stages?: { readonly base: string; readonly total: number } | undefined;
}

/**
 * Ägaren 2026-11-14 («när man sen finjusterar tex branter i en delen så försvinner de helt i andra»): valen bland laserjobben
 * i en panel med reglage. En hel omgång etapper blir ett eget val före etapperna, så att reglagen räknar hela kartan.
 */
export function stageChoices<T extends StageJob>(jobs: readonly T[]): StageChoice<T>[] {
  const out: StageChoice<T>[] = [];
  for (const job of jobs) {
    const stages = completeStages(job, jobs);
    if (stages?.[0]?.jobId === job.jobId) out.push({ id: `etapper:${job.jobId}`, jobs: stages, stages: { base: stageOf(job.name)!.base, total: stages.length } });
  }
  return [...out, ...jobs.map(job => ({ id: job.jobId, jobs: [job] }))];
}

/** Ligger punkten i etappens klippruta? Halvöppen, så att en punkt på gränsen hör till en etapp. */
export function inClip([x, y]: readonly [number, number], clip: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }): boolean {
  return x >= clip.minX && x < clip.maxX && y >= clip.minY && y < clip.maxY;
}
