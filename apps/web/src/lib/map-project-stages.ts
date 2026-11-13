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
