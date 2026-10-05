import { createHash } from "node:crypto";
import { and, eq, isNotNull, max, sql } from "drizzle-orm";
import {
  IOF_IMPORT_MAX_BYTES,
  IOF_IMPORT_MIN_BYTES,
  iofImportIdempotencyKeySchema,
  iofImportReportSchema,
  iofImportResponseSchema,
  type IofImportReport,
  type IofImportResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  IofValidationError,
  parseIofXml,
  type CourseDataImport,
  type EntryListImport,
  type IofImport
} from "@o-tid/iof-xml";
import { contentHash } from "./hash";
import type { DbExecutor } from "./snapshot";
import { lockRaceForMutation } from "./concurrency";
import { applyStartListImport, StartListImportConflictError } from "./import-start-list";
import { assertRaceClassCapacities, ClassCapacityConflictError } from "./class-capacity-guard";
import { insertCourseVersionControls, loadCourseVersionVariants } from "./course-variants";
export class EntryCardImportConflictError extends Error {}
export class EntryIdentityImportConflictError extends Error {}
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

async function importCourses(tx: DbExecutor, raceId: string, parsed: CourseDataImport) {
  const versionByCourse = new Map<string, string>();
  for (const imported of parsed.courses) {
    await tx.insert(schema.courses).values({
      raceId,
      name: imported.name,
      externalSource: "iof",
      externalId: imported.externalId
    }).onConflictDoNothing();
    const [course] = await tx.select().from(schema.courses).where(and(
      eq(schema.courses.raceId, raceId),
      eq(schema.courses.externalSource, "iof"),
      eq(schema.courses.externalId, imported.externalId)
    ));
    if (!course) throw new Error(`Banan ${imported.externalId} kunde inte sparas`);
    const [latest] = await tx.select({ version: max(schema.courseVersions.version) })
      .from(schema.courseVersions).where(eq(schema.courseVersions.courseId, course.id));
    const [version] = await tx.insert(schema.courseVersions).values({
      courseId: course.id,
      version: (latest?.version ?? 0) + 1
    }).returning();
    if (!version) throw new Error("Banversion kunde inte skapas");
    versionByCourse.set(imported.externalId, version.id);
    // Gafflad bana (CourseFamily): tom egen kontrollföljd och en variant per Course.
    await insertCourseVersionControls(tx, raceId, version.id, imported.controlCodes, imported.variants ?? []);
  }

  for (const assignment of parsed.assignments) {
    const courseVersionId = versionByCourse.get(assignment.courseExternalId);
    if (!courseVersionId) throw new Error(`Klass refererar okänd bana ${assignment.courseExternalId}`);
    const [existing] = await tx.select().from(schema.classes).where(and(
      eq(schema.classes.raceId, raceId),
      eq(schema.classes.externalSource, "iof"),
      eq(schema.classes.externalId, assignment.classExternalId)
    ));
    if (existing) {
      await tx.update(schema.classes).set({
        name: assignment.className,
        courseVersionId
      }).where(eq(schema.classes.id, existing.id));
    } else {
      await tx.insert(schema.classes).values({
        raceId,
        name: assignment.className,
        courseVersionId,
        startRule: assignment.startRule,
        externalSource: "iof",
        externalId: assignment.classExternalId
      });
    }
  }
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("sv-SE");

/**
 * PersonCourseAssignment: löparen (EntryId, annars namn och klass) får varianten. Varianten
 * måste finnas i klassens bana. Löpare som inte hittas ger en varning i importrapporten.
 * `keep` är löpare som behåller sin variant (en ny banfil ändrar inte variant för den som läst ut).
 */
export async function importPersonCourseAssignments(tx: DbExecutor, raceId: string, parsed: Pick<CourseDataImport, "personAssignments">,
  keep: ReadonlySet<string> = new Set()): Promise<{ assigned: number; warnings: string[] }> {
  const warnings: string[] = [];
  let assigned = 0;
  const entries = await tx.select({ id: schema.entries.id, externalSource: schema.entries.externalSource,
    externalId: schema.entries.externalId, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    className: schema.classes.name, courseVersionId: schema.classes.courseVersionId, courseExternalId: schema.courses.externalId,
    courseExternalSource: schema.courses.externalSource, code: schema.entries.courseVariantCode, version: schema.entries.version })
    .from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(eq(schema.entries.raceId, raceId));
  const variants = await loadCourseVersionVariants(tx, [...new Set(entries.map(row => row.courseVersionId))]);
  for (const assignment of parsed.personAssignments) {
    const label = assignment.personName ?? assignment.entryExternalId ?? "";
    const matches = assignment.entryExternalId
      ? entries.filter(row => row.externalSource === "iof" && row.externalId === assignment.entryExternalId)
      : entries.filter(row => normalize(`${row.givenName} ${row.familyName}`) === normalize(assignment.personName ?? "") &&
          normalize(row.className) === normalize(assignment.className ?? ""));
    const entry = matches.length === 1 ? matches[0]! : undefined;
    if (!entry) { warnings.push(`Variant ${assignment.variantCode} för ${label}: deltagaren hittades inte`); continue; }
    const codes = (variants.get(entry.courseVersionId) ?? []).map(variant => variant.code);
    if (entry.courseExternalSource !== "iof" || entry.courseExternalId !== assignment.courseExternalId || !codes.includes(assignment.variantCode)) {
      warnings.push(`Variant ${assignment.variantCode} för ${label}: klassens bana har inte varianten`);
      continue;
    }
    if (entry.code === assignment.variantCode || keep.has(entry.id)) continue;
    await tx.update(schema.entries).set({ courseVariantCode: assignment.variantCode, version: sql`${schema.entries.version} + 1` })
      .where(eq(schema.entries.id, entry.id));
    entry.code = assignment.variantCode;
    assigned += 1;
  }
  return { assigned, warnings };
}

/**
 * TeamCourseAssignment (stafett, ADR-0169 beslut 3): laget (BibNumber, annars lagnamn och klass)
 * får en variant per sträcka. Varianten måste finnas i stafettklassens bana.
 */
export async function importTeamCourseAssignments(tx: DbExecutor, raceId: string, parsed: Pick<CourseDataImport, "teamAssignments">,
  keep: ReadonlySet<string> = new Set()): Promise<{ assigned: number; warnings: string[] }> {
  const warnings: string[] = [];
  let assigned = 0;
  if (parsed.teamAssignments.length === 0) return { assigned, warnings };
  const teams = await tx.select({ id: schema.teams.id, number: schema.teams.number, name: schema.teams.name,
    className: schema.classes.name, courseVersionId: schema.classes.courseVersionId, courseExternalId: schema.courses.externalId })
    .from(schema.teams).innerJoin(schema.classes, eq(schema.classes.id, schema.teams.classId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(eq(schema.teams.raceId, raceId));
  const legs = await tx.select({ id: schema.entries.id, teamId: schema.entries.teamId, leg: schema.entries.relayLeg,
    code: schema.entries.courseVariantCode }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.teamId)));
  const variants = await loadCourseVersionVariants(tx, [...new Set(teams.map(row => row.courseVersionId))]);
  for (const assignment of parsed.teamAssignments) {
    const label = assignment.bibNumber !== undefined ? `lag ${assignment.bibNumber}` : assignment.teamName ?? "";
    const matches = assignment.bibNumber !== undefined ? teams.filter(row => row.number === assignment.bibNumber)
      : teams.filter(row => normalize(row.name) === normalize(assignment.teamName ?? "") &&
          (!assignment.className || normalize(row.className) === normalize(assignment.className)));
    const team = matches.length === 1 ? matches[0]! : undefined;
    if (!team) { warnings.push(`Varianter för ${label}: laget hittades inte`); continue; }
    const codes = (variants.get(team.courseVersionId) ?? []).map(variant => variant.code);
    for (const leg of assignment.legs) {
      const entry = legs.find(row => row.teamId === team.id && row.leg === leg.leg);
      if (!entry || team.courseExternalId !== leg.courseExternalId || !codes.includes(leg.variantCode)) {
        warnings.push(`Variant ${leg.variantCode} för ${label} sträcka ${leg.leg}: sträckan eller varianten saknas`);
        continue;
      }
      if (entry.code === leg.variantCode || keep.has(entry.id)) continue;
      await tx.update(schema.entries).set({ courseVariantCode: leg.variantCode, version: sql`${schema.entries.version} + 1` })
        .where(eq(schema.entries.id, entry.id));
      entry.code = leg.variantCode;
      assigned += 1;
    }
  }
  return { assigned, warnings };
}

async function importEntries(tx: DbExecutor, raceId: string, parsed: EntryListImport) {
  for (const imported of parsed.entries) {
    const [raceClass] = await tx.select().from(schema.classes).where(and(
      eq(schema.classes.raceId, raceId),
      eq(schema.classes.externalSource, "iof"),
      eq(schema.classes.externalId, imported.classExternalId)
    ));
    if (!raceClass) throw new Error(`Klassen ${imported.className} (${imported.classExternalId}) saknar importerad bana`);
    const [corrected] = await tx.select({ givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, organisationName: schema.entries.organisationName
    }).from(schema.entries).innerJoin(schema.entryIdentityChangeRequests, and(
      eq(schema.entryIdentityChangeRequests.entryId, schema.entries.id),
      eq(schema.entryIdentityChangeRequests.raceId, raceId)
    )).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.externalSource, "iof"),
      eq(schema.entries.externalId, imported.externalId))).limit(1);
    if (corrected && (corrected.givenName !== imported.givenName || corrected.familyName !== imported.familyName ||
      corrected.organisationName !== (imported.organisationName ?? null))) {
      throw new EntryIdentityImportConflictError("Namn eller klubb skiljer sig efter rättning. Använd explicit namn-/klubbrättning före ny import.");
    }
    const values = {
      raceId,
      classId: raceClass.id,
      givenName: imported.givenName,
      familyName: imported.familyName,
      organisationName: imported.organisationName ?? null,
      externalSource: "iof",
      externalId: imported.externalId
    };
    await tx.insert(schema.entries).values({ ...values, fixedStartTime: null }).onConflictDoUpdate({
      target: [schema.entries.raceId, schema.entries.externalSource, schema.entries.externalId],
      set: { ...values, version: sql`${schema.entries.version} + 1` }
    });
    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.raceId, raceId),
      eq(schema.entries.externalSource, "iof"),
      eq(schema.entries.externalId, imported.externalId)
    ));
    if (!entry) throw new Error("Deltagaren kunde inte sparas");
    if (imported.cardNumber) {
      const assignments = await tx.select().from(schema.cardAssignments).where(and(
        eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.entryId, entry.id)
      ));
      if (assignments.length > 0) {
        const active = assignments.filter((row) => row.active);
        if (active.length !== 1 || active[0]?.cardNumber !== imported.cardNumber) {
          throw new EntryCardImportConflictError("Brickkopplingen skiljer sig. Använd explicit brickbyte före ny import.");
        }
        continue;
      }
      const [owner] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments).where(and(
        eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, imported.cardNumber)
      ));
      if (owner) throw new EntryCardImportConflictError("Brickan har redan en historisk ägare i loppet.");
      await tx.insert(schema.cardAssignments).values({
        raceId,
        entryId: entry.id,
        cardNumber: imported.cardNumber
      });
    }
  }
}

interface AppliedImport {
  readonly report: IofImportReport;
  readonly snapshotChanged: boolean;
}

async function applyParsedImport(tx: DbExecutor, raceId: string, parsed: IofImport): Promise<AppliedImport> {
  if (parsed.kind === "CourseData") {
    await importCourses(tx, raceId, parsed);
    const persons = await importPersonCourseAssignments(tx, raceId, parsed);
    const teams = await importTeamCourseAssignments(tx, raceId, parsed);
    const variantCount = parsed.courses.reduce((sum, course) => sum + (course.variants?.length ?? 0), 0);
    const warnings = [...parsed.warnings, ...persons.warnings, ...teams.warnings];
    return { snapshotChanged: true, report: {
      kind: parsed.kind,
      warnings: warnings.length > 100 ? [...warnings.slice(0, 99), `Ytterligare ${warnings.length - 99} varningar`] : warnings,
      imported: { courses: parsed.courses.length, classes: parsed.assignments.length,
        ...(variantCount > 0 ? { variants: variantCount } : {}),
        ...(parsed.personAssignments.length > 0 ? { personAssignments: persons.assigned } : {}),
        ...(parsed.teamAssignments.length > 0 ? { teamAssignments: teams.assigned } : {}) }
    } };
  }
  if (parsed.kind === "EntryList") {
    await importEntries(tx, raceId, parsed);
    await assertRaceClassCapacities(tx, raceId);
    return { snapshotChanged: true, report: {
      kind: parsed.kind,
      warnings: [...parsed.warnings],
      imported: { entries: parsed.entries.length }
    } };
  }
  const effect = await applyStartListImport(tx, raceId, parsed);
  return {
    snapshotChanged: effect.snapshotChanged,
    report: {
      kind: parsed.kind,
      warnings: [...parsed.warnings],
      imported: effect.imported,
      changed: effect.changed,
      resultsRequiringRecalculation: effect.resultsRequiringRecalculation,
      snapshotChanged: effect.snapshotChanged
    }
  };
}

function safeImportResponse(response: IofImportResponse): IofImportResponse {
  return iofImportResponseSchema.parse(response);
}

export async function importIofXml(db: DbExecutor, raceId: string, xml: string) {
  const parsed = parseIofXml(xml);
  const hash = contentHash(xml);
  return db.transaction(async (tx) => {
    await lockRaceForMutation(tx, raceId);
    const [existing] = await tx.select().from(schema.importFiles).where(and(
      eq(schema.importFiles.raceId, raceId),
      eq(schema.importFiles.kind, parsed.kind),
      eq(schema.importFiles.contentHash, hash)
    ));
    if (existing) return { duplicate: true, importFileId: existing.id, report: existing.report };

    const applied = await applyParsedImport(tx, raceId, parsed);
    const report = applied.report;
    const [saved] = await tx.insert(schema.importFiles).values({
      raceId,
      kind: parsed.kind,
      contentHash: hash,
      originalXml: xml,
      report
    }).returning();
    if (!saved) throw new Error("Importfilen kunde inte sparas");
    if (applied.snapshotChanged) {
      await tx.update(schema.races).set({ snapshotVersion: sql`${schema.races.snapshotVersion} + 1` })
        .where(eq(schema.races.id, raceId));
    }
    return { duplicate: false, importFileId: saved.id, report };
  });
}

export type AuthenticatedIofImportResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "invalid-iof-xml" | "conflict" }
  | { status: "stored" | "duplicate"; response: IofImportResponse };

export type AuthenticatedIofImportInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  idempotencyKey: string | null;
  xmlBytes: Uint8Array;
};

/**
 * Authenticated production import. XML validation and hashing intentionally
 * happen before the transaction; authorization is repeated under row locks
 * before the race or any domain row can be mutated.
 */
export async function importIofXmlAsAdmin(
  db: Database,
  input: AuthenticatedIofImportInput,
  now = new Date()
): Promise<AuthenticatedIofImportResult> {
  const idempotencyKey = iofImportIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!idempotencyKey.success) return { status: "invalid-request" };
  const requestId = idempotencyKey.data.slice("iof-import:".length);
  const bytes = Buffer.from(input.xmlBytes);
  const byteCount = bytes.byteLength;
  if (byteCount < IOF_IMPORT_MIN_BYTES || byteCount > IOF_IMPORT_MAX_BYTES) {
    return { status: "invalid-request" };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const importedAt = new Date(now);
  if (!Number.isFinite(importedAt.getTime())) throw new Error("Importtiden är ogiltig");

  const preflightAuthorization = await authenticatePairingAdminSession(db, {
    sessionToken: input.sessionToken,
    raceId: input.raceId,
    capability: "IMPORT_IOF",
    csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null,
    requireCsrf: true
  }, importedAt);
  if (preflightAuthorization.status !== "authenticated") return preflightAuthorization;

  // A known request UUID is checked before parsing so a changed (even
  // malformed) body remains the documented idempotency-context conflict.
  // The same check is repeated authoritatively under locks in the transaction.
  const [preexistingRequest] = await db.select().from(schema.iofImportRequests)
    .where(eq(schema.iofImportRequests.requestId, requestId));
  if (preexistingRequest && (
    preexistingRequest.raceId !== input.raceId ||
    preexistingRequest.actorCredentialId !== preflightAuthorization.principal.accessCredentialId ||
    preexistingRequest.contentHash !== hash
  )) {
    return { status: "conflict" };
  }

  let xml: string;
  try {
    // ignoreBOM=true retains U+FEFF in the decoded string, making a valid UTF-8
    // BOM round-trip to the exact accepted bytes kept by import_file.
    xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { status: "invalid-request" };
  }

  let parsed: IofImport;
  try {
    parsed = parseIofXml(xml);
  } catch (error) {
    if (error instanceof IofValidationError) return { status: "invalid-iof-xml" };
    throw error;
  }
  try {
    return await db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      capability: "IMPORT_IOF",
      csrfCookie: input.csrfCookie ?? null,
      csrfHeader: input.csrfHeader ?? null,
      requireCsrf: true
    }, importedAt);
    if (authorization.status !== "authenticated") return authorization;

    const race = await lockRaceForMutation(tx, input.raceId);
    // request-id is globally unique while the race lock is only race-local.
    // This transaction-scoped advisory lock prevents cross-race UUID races
    // before any import mutation is allowed to begin.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

    const [existingRequest] = await tx.select().from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.requestId, requestId));
    if (existingRequest) {
      if (existingRequest.raceId !== input.raceId ||
        existingRequest.actorCredentialId !== authorization.principal.accessCredentialId ||
        existingRequest.contentHash !== hash) {
        return { status: "conflict" };
      }
      const [original] = await tx.select().from(schema.importFiles)
        .where(eq(schema.importFiles.id, existingRequest.importFileId));
      if (!original) throw new Error("Importrequestens importfil saknas");
      const originalReport = iofImportReportSchema.parse(original.report);
      const response = safeImportResponse({
        formatVersion: 1,
        status: existingRequest.outcome,
        replayed: true,
        requestId,
        raceId: input.raceId,
        importFileId: original.id,
        contentHash: existingRequest.contentHash,
        byteCount: Buffer.byteLength(original.originalXml, "utf8"),
        report: originalReport
      });
      return { status: response.status, response };
    }

    const [existingContent] = await tx.select().from(schema.importFiles).where(and(
      eq(schema.importFiles.raceId, input.raceId),
      eq(schema.importFiles.kind, parsed.kind),
      eq(schema.importFiles.contentHash, hash)
    ));
    if (existingContent) {
      await tx.insert(schema.iofImportRequests).values({
        requestId,
        raceId: input.raceId,
        actorCredentialId: authorization.principal.accessCredentialId,
        contentHash: hash,
        importFileId: existingContent.id,
        outcome: "duplicate",
        createdAt: importedAt
      });
      const response = safeImportResponse({
        formatVersion: 1,
        status: "duplicate",
        replayed: false,
        requestId,
        raceId: input.raceId,
        importFileId: existingContent.id,
        contentHash: hash,
        byteCount,
        report: iofImportReportSchema.parse(existingContent.report)
      });
      return { status: "duplicate", response };
    }

    const applied = await applyParsedImport(tx, input.raceId, parsed);
    const report = applied.report;
    const [saved] = await tx.insert(schema.importFiles).values({
      raceId: input.raceId,
      kind: parsed.kind,
      contentHash: hash,
      originalXml: xml,
      report
    }).returning();
    if (!saved) throw new Error("Importfilen kunde inte sparas");
    const snapshotVersionAfter = race.snapshotVersion + (applied.snapshotChanged ? 1 : 0);
    if (applied.snapshotChanged) {
      await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter })
        .where(eq(schema.races.id, input.raceId));
    }
    await tx.insert(schema.iofImportRequests).values({
      requestId,
      raceId: input.raceId,
      actorCredentialId: authorization.principal.accessCredentialId,
      contentHash: hash,
      importFileId: saved.id,
      outcome: "stored",
      createdAt: importedAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId,
      entityType: "import_file",
      entityId: saved.id,
      action: "IOF_IMPORT_STORED_BY_ADMIN",
      actorKind: authorization.principal.capability === "MANAGE_RACE" ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "IOF_IMPORT_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      requestId,
      after: {
        kind: report.kind,
        byteCount,
        imported: report.imported,
        ...(report.kind === "StartList" ? {
          changed: report.changed,
          resultsRequiringRecalculation: report.resultsRequiringRecalculation,
          snapshotChanged: report.snapshotChanged
        } : {}),
        snapshotVersionBefore: race.snapshotVersion,
        snapshotVersionAfter
      }
    });
    const response = safeImportResponse({
      formatVersion: 1,
      status: "stored",
      replayed: false,
      requestId,
      raceId: input.raceId,
      importFileId: saved.id,
      contentHash: hash,
      byteCount,
      report
    });
      return { status: "stored", response };
    });
  } catch (error) {
    if (error instanceof StartListImportConflictError || error instanceof EntryCardImportConflictError ||
      error instanceof EntryIdentityImportConflictError || error instanceof ClassCapacityConflictError) return { status: "conflict" };
    throw error;
  }
}
