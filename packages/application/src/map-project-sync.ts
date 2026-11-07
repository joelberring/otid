import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { mapProjectSyncRequestSchema, type MapProjectSyncResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { editPoints, editRoute, type EditResult, type EditRole, type RevisionEdit, type ServerObject } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import { applyMapProjectEdits, currentObjects, validateEdits, wireObject } from "./map-project-apply";
import { workAreas } from "./map-project-areas";
import { insertProposal, openProposalIdsOf, proposedEditIds } from "./map-project-proposals";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 beslut 4: synken. Ett anrop skickar klientens egna ändringar (i ordning) och hämtar allt som ändrats sedan
 * `since`. Projektets rad låses under anropet, så två synkar på samma projekt görs efter varandra och löpnumret blir en
 * obruten följd. Varje ändring avgörs för sig (`applyMapProjectEdits`): gjord, redan gjord (samma id) eller krock. En krock
 * ändrar inget, loggas och skickas tillbaka med det som gäller, så att den senare får välja. En ändring vars referens inte hör
 * till projektets grundfil avvisas.
 *
 * K1 (tillägget om arbetssätt): om en ändring görs direkt eller blir ett förslag avgörs här med `editRoute` (roll, arbetssätt
 * och delområden). Ändringar som blir förslag görs inte; alla i samma anrop samlas i ett förslag (källa PERSON, ingen anteckning)
 * och får `PROPOSED` med förslagets id. En senare ändring på samma objekt i samma anrop blir också förslag (den bygger på den
 * föreslagna). Samma ändring igen ger samma förslag. Svaret har kontots egna öppna förslag (`openProposals`).
 *
 * Ett avslutat projekt tar inte emot ändringar; svaret kvitterar ingenting, så att klienten behåller sina ändringar (och kan
 * exportera dem) i stället för att tappa dem.
 */
const PULL_LIMIT = 2000;

/** Allt som ändrats sedan `since`, i löpnummerordning, högst `PULL_LIMIT` (då `more`). */
async function pull(tx: DbExecutor, projectId: string, since: number, seq: number): Promise<{ objects: ServerObject[]; seq: number; more: boolean }> {
  const rows = await tx.select().from(schema.mapProjectObjects)
    .where(and(eq(schema.mapProjectObjects.projectId, projectId), gt(schema.mapProjectObjects.seq, since)))
    .orderBy(asc(schema.mapProjectObjects.seq)).limit(PULL_LIMIT + 1);
  const more = rows.length > PULL_LIMIT;
  const kept = rows.slice(0, PULL_LIMIT);
  return { objects: kept.map(wireObject), seq: more ? kept[kept.length - 1]!.seq : seq, more };
}

export async function syncMapProject(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: MapProjectSyncResponse }> {
  const parsed = mapProjectSyncRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const wantsEdit = parsed.success && parsed.data.edits.length > 0;
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { clientId, since, edits } = parsed.data;
    const { project, accountId } = access;
    await tx.update(schema.mapProjectMembers).set({ lastSeenAt: now })
      .where(and(eq(schema.mapProjectMembers.projectId, project.id), eq(schema.mapProjectMembers.accountId, accountId)));
    const respond = async (results: EditResult[], seq: number) => {
      const pulled = await pull(tx, project.id, since, seq);
      return { status: "ok", response: { formatVersion: 1, seq: pulled.seq, status: project.status, results, objects: pulled.objects,
        more: pulled.more, openProposals: await openProposalIdsOf(tx, project.id, accountId) } } as const;
    };
    if (project.status !== "OPEN" || !wantsEdit) return respond([], project.seq);
    // Läsa får hämta men inte ändra.
    if (access.role === "READ") return { status: "forbidden" } as const;

    const { valid, rejected } = validateEdits(edits, project);
    const results: EditResult[] = [...rejected];
    const log = schema.mapProjectEdits;
    const ids = valid.map(edit => edit.editId);
    const applied = new Set(ids.length === 0 ? [] : (await tx.select({ editId: log.editId }).from(log)
      .where(and(eq(log.projectId, project.id), eq(log.status, "APPLIED"), inArray(log.editId, ids)))).map(row => row.editId));
    const earlier = await proposedEditIds(tx, project.id, ids);
    const role = access.role as EditRole;
    const areas = role === "EDIT" ? await workAreas(tx, project.id) : [];
    const current = role === "EDIT" ? await currentObjects(tx, project.id, valid.map(edit => edit.key)) : new Map();
    const direct: RevisionEdit[] = [], proposed: RevisionEdit[] = [];
    const proposedKeys = new Set<string>();
    for (const edit of valid) {
      if (proposed.some(row => row.editId === edit.editId)) continue;
      const prior = earlier.get(edit.editId);
      if (!applied.has(edit.editId) && prior) { results.push({ editId: edit.editId, status: "PROPOSED", proposalId: prior }); continue; }
      const route = applied.has(edit.editId) ? "APPLY" : proposedKeys.has(edit.key) ? "PROPOSE"
        : editRoute({ role, mode: project.mode ?? "SHARED", accountId, areas,
          points: editPoints(edit.state, current.get(edit.key)?.state as RevisionEdit["state"] | undefined, edit.point) });
      if (route === "APPLY") direct.push(edit);
      else { proposed.push(edit); proposedKeys.add(edit.key); }
    }
    const done = await applyMapProjectEdits(tx, { project, authorId: accountId, clientId, edits: direct, now });
    results.push(...done.results);
    if (proposed.length > 0) {
      const proposalId = await insertProposal(tx, { projectId: project.id, authorId: accountId, source: "PERSON", note: null, edits: proposed, now });
      for (const edit of proposed) results.push({ editId: edit.editId, status: "PROPOSED", proposalId });
    }
    const seq = done.seq;
    return respond(results, seq);
  });
}
