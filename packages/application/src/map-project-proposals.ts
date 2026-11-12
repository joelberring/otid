import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import {
  mapProjectProposalCreateRequestSchema, mapProjectProposalDecisionRequestSchema, type MapProjectProposalList, type MapProjectProposalSource,
  type MapProjectProposalStatus, type MapProjectProposalView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { RevisionEdit } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { mapProjectAllows, mapProjectJournal, requireMapProject, requireMapProjectForAccount } from "./map-project-access";
import { applyMapProjectEdits, validateEdits } from "./map-project-apply";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 tillägget om arbetssätt (K1): förslag. Ett förslag är en grupp ändringar med en kort anteckning. Det skapas av synken
 * (ändringar som inte får göras direkt, `editRoute`, blir ett förslag per anrop), uttryckligen av en person med Föreslå eller mer,
 * eller av AI i K2 (källan `AI`). Ägarna godkänner (ändringarna görs genom samma väg som synken, var och en gjord eller krock)
 * eller avvisar; den som föreslog kan dra tillbaka ett öppet förslag. Loggen (`map_project_edit`) har den som föreslog som
 * författare och den som godkände i `accepted_by`. Förslag från en person som tagits bort ur projektet står kvar.
 */
const proposals = schema.mapProjectProposals, proposalEdits = schema.mapProjectProposalEdits;
type ProposalRow = typeof proposals.$inferSelect;
/** Så många förslag visas i listan (alla öppna först, sedan de senast avgjorda). */
const LIST_LIMIT = 100;
/** Klientens id i loggen för ändringar som kom genom ett godkänt förslag. */
const PROPOSAL_CLIENT_ID = "proposal";

/** Sparar ett öppet förslag med ändringarna i ordning. Ger förslagets id. */
export async function insertProposal(tx: DbExecutor, input: { projectId: string; authorId: string; source: MapProjectProposalSource;
  note: string | null; edits: readonly RevisionEdit[]; now: Date; requestId?: string }): Promise<string> {
  const id = randomUUID();
  await tx.insert(proposals).values({ id, projectId: input.projectId, requestId: input.requestId ?? randomUUID(), authorAccountId: input.authorId,
    source: input.source, note: input.note, status: "OPEN", createdAt: input.now });
  await tx.insert(proposalEdits).values(input.edits.map((edit, position) => ({ proposalId: id, position, editId: edit.editId, objectKey: edit.key,
    ref: edit.ref, baseEditId: edit.base, kind: edit.kind, state: edit.state, point: edit.point ?? null, editedAt: new Date(edit.at) })));
  return id;
}

/** Ändringar (id) som redan finns i något av projektets förslag, med förslagets id. */
export async function proposedEditIds(tx: DbExecutor, projectId: string, editIds: readonly string[]): Promise<Map<string, string>> {
  if (editIds.length === 0) return new Map();
  return new Map((await tx.select({ editId: proposalEdits.editId, proposalId: proposalEdits.proposalId }).from(proposalEdits)
    .innerJoin(proposals, eq(proposals.id, proposalEdits.proposalId))
    .where(and(eq(proposals.projectId, projectId), inArray(proposalEdits.editId, [...editIds])))).map(row => [row.editId, row.proposalId]));
}

/** Kontots egna öppna förslag i projektet (synkens `openProposals`). */
export async function openProposalIdsOf(tx: DbExecutor, projectId: string, accountId: string): Promise<string[]> {
  return (await tx.select({ id: proposals.id }).from(proposals)
    .where(and(eq(proposals.projectId, projectId), eq(proposals.authorAccountId, accountId), eq(proposals.status, "OPEN")))
    .orderBy(asc(proposals.createdAt)).limit(1000)).map(row => row.id);
}

export async function openProposalCount(tx: DbExecutor, projectId: string): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(proposals).where(and(eq(proposals.projectId, projectId), eq(proposals.status, "OPEN")));
  return Number(row?.value ?? 0);
}

async function views(tx: DbExecutor, rows: readonly ProposalRow[]): Promise<MapProjectProposalView[]> {
  if (rows.length === 0) return [];
  const accountIds = [...new Set(rows.flatMap(row => row.decidedBy ? [row.authorAccountId, row.decidedBy] : [row.authorAccountId]))];
  const names = new Map((await tx.select({ id: schema.userAccounts.id, name: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(inArray(schema.userAccounts.id, accountIds))).map(row => [row.id, row.name]));
  const edits = await tx.select().from(proposalEdits).where(inArray(proposalEdits.proposalId, rows.map(row => row.id)))
    .orderBy(asc(proposalEdits.proposalId), asc(proposalEdits.position));
  const person = (accountId: string) => ({ accountId, name: names.get(accountId) ?? null });
  return rows.map(row => ({ proposalId: row.id, source: row.source, status: row.status, note: row.note, author: person(row.authorAccountId),
    createdAt: row.createdAt.toISOString(), decidedBy: row.decidedBy ? person(row.decidedBy) : null, decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    edits: edits.filter(edit => edit.proposalId === row.id).map(edit => ({ editId: edit.editId, key: edit.objectKey, ref: edit.ref ?? null,
      base: edit.baseEditId, kind: edit.kind, state: edit.state, at: edit.editedAt.toISOString(), point: edit.point ?? null, outcome: edit.outcome })) }));
}

/** Förslagen för alla medlemmar: öppna först (äldsta först), sedan de senast avgjorda. */
export async function listMapProjectProposals(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectProposalList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const projectId = access.project.id;
    const open = await tx.select().from(proposals).where(and(eq(proposals.projectId, projectId), eq(proposals.status, "OPEN")))
      .orderBy(asc(proposals.createdAt), asc(proposals.id)).limit(LIST_LIMIT);
    const decided = open.length >= LIST_LIMIT ? [] : await tx.select().from(proposals)
      .where(and(eq(proposals.projectId, projectId), ne(proposals.status, "OPEN")))
      .orderBy(desc(proposals.decidedAt), desc(proposals.id)).limit(LIST_LIMIT - open.length);
    return { status: "ok", list: { formatVersion: 1, proposals: await views(tx, [...open, ...decided]) } } as const;
  });
}

/**
 * Ett uttryckligt förslag med anteckning (Föreslå eller mer; `source` AI bara från K2:s MCP). Ändringarna prövas som i synken;
 * en ändring vars id redan finns i projektet (gjord, krockad eller i ett förslag) gör begäran ogiltig. Idempotent på `requestId`.
 */
export async function createMapProjectProposal(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; proposal: MapProjectProposalView }> {
  return db.transaction(async tx => createProposal(tx, await requireMapProject(tx, input, now, "propose", true), input.request, now, "PERSON"));
}

/** K2: ett förslag från AI-kopplingen (källan `AI`, alltid ett förslag, också när kontot är ägare). */
/**
 * AI-kopplingens förslag. Projektets AI-läge avgör (ägaren 2026-11-12): READ avvisar, PROPOSE lämnar förslaget öppet för en
 * ägare, och AUTONOMOUS godkänner det direkt i samma transaktion. Ändringarna hamnar då i kartans historik som ett godkänt
 * AI-förslag (godkänt av kontot bakom kopplingen), så de syns och går att ångra som andra ändringar.
 */
export async function createMapProjectProposalAsAi(db: Database, input: { accountId: string; projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; proposal: MapProjectProposalView; applied?: number; conflicts?: number }> {
  return db.transaction(async tx => {
    const access = await requireMapProjectForAccount(tx, input.accountId, input.projectId, now, "propose", true);
    if (access.status === "ok" && access.project.aiMode === "READ") return { status: "forbidden" } as const;
    const created = await createProposal(tx, access, input.request, now, "AI");
    if (created.status !== "created" || created.replayed || access.status !== "ok" || access.project.aiMode !== "AUTONOMOUS") return created;
    // Självständigt gäller bara ett konto som självt får rita i kartan; annars blir det ett vanligt förslag.
    if (!mapProjectAllows(access.role, access.project, "edit")) return created;
    if (access.project.status !== "OPEN") return { status: "conflict" } as const;
    const where = and(eq(proposals.id, created.proposal.proposalId), eq(proposals.projectId, access.project.id));
    const [proposal] = await tx.select().from(proposals).where(where).for("update");
    const outcome = await acceptEdits(tx, access.project, proposal!, access.accountId, now);
    const [next] = await tx.update(proposals).set({ status: "ACCEPTED", decidedBy: access.accountId, decidedAt: now, decisionNote: "AI-kopplingen arbetar självständigt i projektet." })
      .where(where).returning();
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_PROPOSAL_ACCEPTED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, proposalId: proposal!.id, ai: true }, now });
    return { status: "created", replayed: false, proposal: (await views(tx, [next!]))[0]!, applied: outcome.applied, conflicts: outcome.conflicts } as const;
  });
}

/** Lägger förslagets ändringar i kartan och märker var och en som införd eller krock. */
async function acceptEdits(tx: DbExecutor, project: Parameters<typeof applyMapProjectEdits>[1]["project"], proposal: ProposalRow, acceptedBy: string, now: Date)
  : Promise<{ seq: number; applied: number; conflicts: number }> {
  const rows = await tx.select().from(proposalEdits).where(eq(proposalEdits.proposalId, proposal.id)).orderBy(asc(proposalEdits.position));
  const edits: RevisionEdit[] = rows.map(row => ({ editId: row.editId, key: row.objectKey, ref: (row.ref ?? null) as RevisionEdit["ref"],
    base: row.baseEditId, state: row.state as RevisionEdit["state"], kind: row.kind as RevisionEdit["kind"], at: row.editedAt.toISOString() }));
  const applied = await applyMapProjectEdits(tx, { project, authorId: proposal.authorAccountId, clientId: PROPOSAL_CLIENT_ID, edits, now,
    proposal: { proposalId: proposal.id, acceptedBy } });
  const done = new Set(applied.results.filter(result => result.status === "APPLIED" || result.status === "DUPLICATE").map(result => result.editId));
  for (const outcome of ["APPLIED", "CONFLICT"] as const) {
    const ids = rows.map(row => row.editId).filter(id => done.has(id) === (outcome === "APPLIED"));
    if (ids.length > 0) await tx.update(proposalEdits).set({ outcome })
      .where(and(eq(proposalEdits.proposalId, proposal.id), inArray(proposalEdits.editId, ids)));
  }
  return { seq: applied.seq, applied: done.size, conflicts: rows.length - done.size };
}

async function createProposal(tx: DbExecutor, access: Awaited<ReturnType<typeof requireMapProjectForAccount>>, request: unknown, now: Date,
  source: MapProjectProposalSource): Promise<ClubFailure | { status: "created"; replayed: boolean; proposal: MapProjectProposalView }> {
  const parsed = mapProjectProposalCreateRequestSchema.safeParse(request);
  if (access.status !== "ok") return access;
  if (!parsed.success) return { status: "invalid-request" } as const;
  const { requestId, note, edits } = parsed.data;
  // Bara en person kan välja IMPORT, GENERALIZE eller PROCESS; AI-kopplingens förslag är alltid AI.
  if (source === "PERSON" && parsed.data.source !== undefined && parsed.data.source !== "PERSON") source = parsed.data.source;
  const project = access.project;
  const [prior] = await tx.select().from(proposals).where(eq(proposals.requestId, requestId));
  if (prior) {
    if (prior.projectId !== project.id || prior.authorAccountId !== access.accountId) return { status: "conflict" } as const;
    return { status: "created", replayed: true, proposal: (await views(tx, [prior]))[0]! } as const;
  }
  const { valid, rejected } = validateEdits(edits, project);
  const ids = valid.map(edit => edit.editId);
  if (rejected.length > 0 || new Set(ids).size !== ids.length) return { status: "invalid-request" } as const;
  const logged = await tx.select({ id: schema.mapProjectEdits.editId }).from(schema.mapProjectEdits)
    .where(and(eq(schema.mapProjectEdits.projectId, project.id), inArray(schema.mapProjectEdits.editId, ids))).limit(1);
  if (logged.length > 0 || (await proposedEditIds(tx, project.id, ids)).size > 0) return { status: "invalid-request" } as const;
  const proposalId = await insertProposal(tx, { projectId: project.id, authorId: access.accountId, source, note: note || null, edits: valid, now,
    requestId });
  const [row] = await tx.select().from(proposals).where(eq(proposals.id, proposalId));
  return { status: "created", replayed: false, proposal: (await views(tx, [row!]))[0]! } as const;
}

const OUTCOME: Record<"ACCEPT" | "REJECT" | "WITHDRAW", MapProjectProposalStatus> = { ACCEPT: "ACCEPTED", REJECT: "REJECTED", WITHDRAW: "WITHDRAWN" };

/**
 * Godkänn eller avvisa (ägarna) eller dra tillbaka (den som föreslog) ett öppet förslag. Samma beslut igen ger samma svar; ett
 * annat beslut om ett avgjort förslag är en konflikt. Att godkänna kräver ett öppet projekt; ändringarna görs i ordning genom
 * samma väg som synken och får utfallet gjord (`APPLIED`, också när den redan var gjord) eller krock (`CONFLICT`, grunden stämmer
 * inte längre). Ger förslaget och projektets löpnummer.
 */
export async function decideMapProjectProposal(db: Database, input: ClubProof & { projectId: string; proposalId: string; request: unknown },
  now = new Date()): Promise<ClubFailure | { status: "ok"; replayed: boolean; seq: number; proposal: MapProjectProposalView }> {
  const parsed = mapProjectProposalDecisionRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.proposalId)) return { status: "not-found" } as const;
    const { project, accountId } = access;
    const where = and(eq(proposals.id, input.proposalId), eq(proposals.projectId, project.id));
    const [proposal] = await tx.select().from(proposals).where(where).for("update");
    if (!proposal) return { status: "not-found" } as const;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { action, note } = parsed.data;
    const allowed = action === "WITHDRAW" ? proposal.authorAccountId === accountId : mapProjectAllows(access.role, project, "manage");
    if (!allowed) return { status: "forbidden" } as const;
    const target = OUTCOME[action];
    if (proposal.status !== "OPEN") {
      return proposal.status === target ? { status: "ok", replayed: true, seq: project.seq, proposal: (await views(tx, [proposal]))[0]! } as const
        : { status: "conflict" } as const;
    }
    let seq = project.seq;
    if (action === "ACCEPT") {
      if (project.status !== "OPEN") return { status: "conflict" } as const;
      seq = (await acceptEdits(tx, project, proposal, accountId, now)).seq;
    }
    const [next] = await tx.update(proposals).set({ status: target, decidedBy: accountId, decidedAt: now, decisionNote: note || null })
      .where(where).returning();
    await mapProjectJournal(tx, project, { action: `MAP_PROJECT_PROPOSAL_${target}`, actorAccountId: accountId,
      details: { projectId: project.id, proposalId: proposal.id }, now });
    return { status: "ok", replayed: false, seq, proposal: (await views(tx, [next!]))[0]! } as const;
  });
}

/** Så länge "Godkänn alla" arbetar i ett anrop; resten tas i nästa (klienten frågar igen tills inget återstår). */
const DECIDE_ALL_BUDGET_MS = 20_000;

/**
 * Ägaren 2026-11-10: "Godkänn alla" och "Avvisa alla" för de öppna förslagen (t.ex. en generalisering i 56 delar). Varje
 * förslag avgörs i sin egen transaktion precis som ett och ett, äldst först; ett förslag som krockar räknas och hoppas över.
 * Slutar vid ett annat fel (behörighet, projektet stängt) eller när tiden för anropet tagit slut, och säger hur många som är kvar.
 */
export async function decideAllMapProjectProposals(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date(),
  budgetMs = DECIDE_ALL_BUDGET_MS): Promise<ClubFailure | { status: "ok"; decided: number; conflicts: number; remaining: number; seq: number | null }> {
  const parsed = mapProjectProposalDecisionRequestSchema.safeParse(input.request);
  const listed = await listMapProjectProposals(db, input, now);
  if (listed.status !== "ok") return listed;
  if (!parsed.success || parsed.data.action === "WITHDRAW") return { status: "invalid-request" } as const;
  const started = Date.now();
  const open = listed.list.proposals.filter(proposal => proposal.status === "OPEN").map(proposal => proposal.proposalId);
  let decided = 0, conflicts = 0, seq: number | null = null;
  for (const proposalId of open) {
    // Minst ett avgörs per anrop, så att klientens omgångar alltid kommer framåt.
    if (decided + conflicts > 0 && Date.now() - started > budgetMs) break;
    const result = await decideMapProjectProposal(db, { ...input, proposalId, request: { formatVersion: 1, action: parsed.data.action } }, now);
    if (result.status === "conflict") { conflicts += 1; continue; }
    if (result.status !== "ok") {
      if (decided === 0 && conflicts === 0) return result;
      break;
    }
    decided += 1;
    seq = result.seq;
  }
  const after = await listMapProjectProposals(db, input, now);
  const remaining = after.status === "ok" ? after.list.proposals.filter(proposal => proposal.status === "OPEN").length : 0;
  return { status: "ok", decided, conflicts, remaining, seq } as const;
}
