import { sql } from "drizzle-orm";
import type { Database } from "@o-tid/database";

/**
 * ADR-0185: hälsokontrollen (`GET /api/health`, tjänsten monitor). Databasen svarar, och hur länge det äldsta väntande
 * utskriftsjobbet har väntat (står utskriftsarbetaren still växer det). Inga personuppgifter, inga id:n.
 */
export interface HealthReport {
  readonly database: boolean;
  readonly oldestQueuedSeconds: number | null;
}

/** Kastar om databasen inte svarar; anroparen loggar och svarar 503. */
export async function readHealth(db: Database): Promise<HealthReport> {
  const result = await db.execute<{ waiting: number | null }>(sql`
    select floor(extract(epoch from now() - min(created_at)))::int as waiting from course_setting_print_job where status = 'QUEUED'`);
  const waiting = result.rows[0]?.waiting;
  return { database: true, oldestQueuedSeconds: typeof waiting === "number" ? Math.max(0, waiting) : null };
}
