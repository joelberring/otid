import { createHash } from "node:crypto";
import { and, eq, max, sql } from "drizzle-orm";
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
    for (const [index, code] of imported.controlCodes.entries()) {
      await tx.insert(schema.controls).values({ raceId, code }).onConflictDoNothing();
      const [control] = await tx.select().from(schema.controls).where(and(
        eq(schema.controls.raceId, raceId), eq(schema.controls.code, code)
      ));
      if (!control) throw new Error(`Kontroll ${code} kunde inte sparas`);
      await tx.insert(schema.courseControls).values({
        courseVersionId: version.id,
        controlId: control.id,
        sequence: index + 1
      });
    }
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
    return { snapshotChanged: true, report: {
      kind: parsed.kind,
      warnings: [...parsed.warnings],
      imported: { courses: parsed.courses.length, classes: parsed.assignments.length }
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
