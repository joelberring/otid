import { readHealth } from "@o-tid/application";
import { db } from "../../../lib/db";

/**
 * ADR-0186: hälsokontrollen för tjänsten monitor (docs/drift.md, Bevakning). 200 när databasen svarar, annars 503. Svaret säger
 * bara om databasen svarar och hur länge det äldsta utskriftsjobbet har väntat; inga personuppgifter.
 */
export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store", "content-type": "application/json" };
  try {
    const report = await readHealth(db);
    return new Response(JSON.stringify({ formatVersion: 1, ...report }), { headers });
  } catch (error) {
    console.error("Hälsokontrollen: databasen svarar inte", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ formatVersion: 1, database: false, oldestQueuedSeconds: null }), { status: 503, headers });
  }
}
