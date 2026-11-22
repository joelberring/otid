import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { sweepMapContent } from "../../src/map-content";
import { createMapProjectFromUpload } from "../../src/map-projects";
import { registerTestAccount } from "./accounts";
import { db, useRaceDatabase } from "./race-fixtures";

/**
 * Granskningen 2.3: städningen tar hundra rader åt gången. Innehåll som bara geo-utdata pekar på ska inte räknas som
 * föräldralöst och fylla de hundra platserna, så att riktigt föräldralöst innehåll aldrig nås.
 */
useRaceDatabase();
const NOW = new Date("2026-11-22T10:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

describe("granskning 2.3: sweepMapContent och geo-utdata", () => {
  it("når föräldralöst innehåll även när fler än hundra geo-utdata finns, och räknar bara borttagna", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Geo",
      fileName: "Geo.omap" }, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const jobId = randomUUID();
    await db.insert(schema.mapProjectGeoJobs).values({ id: jobId, projectId: created.projectId, accountId: owner.accountId, kind: "PULLAUTIN",
      status: "DONE", request: {}, createdAt: NOW, requestId: randomUUID() });
    const old = new Date(NOW.getTime() - 3 * 3600_000);
    const prefix = randomUUID().replaceAll("-", "");
    // 120 innehåll som bara geo-utdata pekar på, och ett föräldralöst (sist i hash-ordningen så att det inte hamnar först av en slump).
    await db.execute(sql`insert into map_content (sha256, content_id, byte_length, created_at)
      select ${prefix} || lpad(to_hex(g), 32, '0'), gen_random_uuid(), 10, ${old} from generate_series(1, 120) g`);
    await db.execute(sql`insert into map_project_geo_output (job_id, name, content_sha256, media_type, byte_size, created_at)
      select ${jobId}::uuid, 'fil' || g || '.png', ${prefix} || lpad(to_hex(g), 32, '0'), 'image/png', 10, ${old} from generate_series(1, 120) g`);
    const orphan = `ff${prefix}`.slice(0, 32) + "0".repeat(32);
    await db.execute(sql`insert into map_content (sha256, content_id, byte_length, created_at) values (${orphan}, gen_random_uuid(), 10, ${old})`);

    const swept = await db.transaction((tx) => sweepMapContent(tx, NOW));
    expect(swept.contents).toBeGreaterThanOrEqual(1);
    expect((await db.execute(sql`select 1 from map_content where sha256 = ${orphan}`)).rows).toHaveLength(0);
    // Geo-utdatans innehåll finns kvar.
    const left = await db.execute<{ n: string }>(sql`select count(*)::text as n from map_content where sha256 like ${prefix + "%"}`);
    expect(Number(left.rows[0]?.n)).toBe(120);
    // En andra städning hittar inget mer att ta bort av detta och rapporterar inte levande rader som borttagna.
    expect((await db.transaction((tx) => sweepMapContent(tx, NOW))).contents).toBe(0);
  });
});
