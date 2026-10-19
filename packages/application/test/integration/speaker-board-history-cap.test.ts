import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingestDeviceBatch, listSpeakerBoardAsAdmin } from "../../src";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { batch, db, importedRace, okPayload, pool, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();
const { decide, entryId } = statusFlow(db);

/** Lägger till beslut och återtaganden som kopior av löparens två första beslut (rev 2 och 3). */
async function appendDecisionCopies(entry: string, from: number, to: number) {
  await pool.query(`insert into result_revision (race_id, entry_id, readout_id, revision, cause, status, reason, engine_version,
      snapshot_version, basis_hash, course_version_id, published, created_at, evaluation)
    select source.race_id, source.entry_id, null, series.revision, source.cause, source.status, source.reason, source.engine_version,
      source.snapshot_version, source.basis_hash, source.course_version_id, source.published, source.created_at, source.evaluation
    from generate_series($2::int, $3::int) as series(revision)
    join result_revision source on source.entry_id = $1 and source.revision = case when series.revision % 2 = 0 then 2 else 3 end
    order by series.revision`, [entry, from, to]);
}

describe("speaker: tak för beslutshistoriken i PostgreSQL", () => {
  it("löser exakt 1000 sparade beslut och avvisar det 1001:a före projektionen", async () => {
    const { raceId } = await importedRace();
    const auth = await raceAuth(db, raceId);
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
    const ada = await entryId(raceId, "Ada");
    expect((await decide(auth, ada, { kind: "DISQUALIFIED" })).status).toBe("decided");
    expect((await decide(auth, ada, { kind: "WITHDRAW" })).status).toBe("decided");
    // Revision 2–1001 är 1000 beslut; den sista (udda) är ett återtagande.
    await appendDecisionCopies(ada, 4, 1001);

    const atCap = await listSpeakerBoardAsAdmin(db, auth);
    if (atCap.status !== "ok") throw new Error("Exakt 1000 beslut måste kunna resolveras");
    const row = atCap.response.rows.find((item) => item.givenName === "Ada");
    expect(row).toMatchObject({ state: "ACTIVE_RESULT", result: { status: "OK" } });

    await appendDecisionCopies(ada, 1002, 1002);
    await expect(listSpeakerBoardAsAdmin(db, auth)).rejects.toThrow("beslutshistorik är för stor");
  }, 120_000);
});
