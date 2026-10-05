import { z } from "zod";
import { relayReadoutSchema } from "./relay";
import { rogainingPointsSchema, rogainingRulesSchema } from "./rogaining";

export const STATION_PACKAGE_LIMITS = {
  classes: 2_000,
  courses: 2_000,
  courseVersionsPerCourse: 100,
  controlsPerCourseVersion: 1_000,
  variantsPerCourseVersion: 100,
  entries: 50_000,
  cardAssignments: 100_000,
  classControlNeutralizations: 2_000
} as const;

const uuidSchema = z.uuid();
const positiveIntegerSchema = z.number().int().positive();
const externalIdentitySchema = z.object({
  source: z.enum(["iof", "eventor"]),
  externalId: z.string().min(1).max(256)
}).strict();

const raceSchema = z.object({
  id: uuidSchema,
  eventId: uuidSchema,
  name: z.string().min(1).max(160),
  raceDate: z.iso.date(),
  snapshotVersion: positiveIntegerSchema
}).strict();

const raceClassSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  name: z.string().min(1).max(160),
  courseVersionId: uuidSchema,
  startRule: z.enum(["FIXED", "PUNCH"]),
  /** Rogainingklass (ADR-0170 beslut 5): tidsgräns och straff. */
  rogaining: rogainingRulesSchema.optional(),
  externalIdentity: externalIdentitySchema.optional()
}).strict();

const courseControlSchema = z.object({
  id: uuidSchema,
  courseVersionId: uuidSchema,
  controlId: uuidSchema,
  sequence: positiveIntegerSchema,
  controlCode: positiveIntegerSchema,
  /** Rogaining: kontrollens poäng när förvalet ändrats. */
  points: rogainingPointsSchema.optional()
}).strict();

const courseVariantCodeSchema = z.string().min(1).max(32).refine((value) => value === value.trim());

const courseVariantControlSchema = z.object({
  id: uuidSchema,
  courseVariantId: uuidSchema,
  controlId: uuidSchema,
  sequence: positiveIntegerSchema,
  controlCode: positiveIntegerSchema
}).strict();

/** ADR-0169 beslut 2: variant (gaffling) med egen kontrollföljd. */
const courseVariantSchema = z.object({
  id: uuidSchema,
  courseVersionId: uuidSchema,
  code: courseVariantCodeSchema,
  sequence: positiveIntegerSchema,
  controls: z.array(courseVariantControlSchema).max(STATION_PACKAGE_LIMITS.controlsPerCourseVersion)
}).strict();

const courseVersionSchema = z.object({
  id: uuidSchema,
  courseId: uuidSchema,
  version: positiveIntegerSchema,
  controls: z.array(courseControlSchema).max(STATION_PACKAGE_LIMITS.controlsPerCourseVersion),
  variants: z.array(courseVariantSchema).min(1).max(STATION_PACKAGE_LIMITS.variantsPerCourseVersion).optional(),
  createdAt: z.iso.datetime({ offset: true })
}).strict();

const courseSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  name: z.string().min(1).max(160),
  externalIdentity: externalIdentitySchema.optional(),
  versions: z.array(courseVersionSchema).max(STATION_PACKAGE_LIMITS.courseVersionsPerCourse)
}).strict();

const entrySchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  classId: uuidSchema,
  givenName: z.string().max(160),
  familyName: z.string().max(160),
  organisationName: z.string().max(200).optional(),
  fixedStartTime: z.iso.datetime({ offset: true }).optional(),
  courseVariantCode: courseVariantCodeSchema.optional(),
  externalIdentity: externalIdentitySchema.optional()
}).strict();

const cardAssignmentSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  entryId: uuidSchema,
  cardNumber: z.string().min(1).max(32),
  active: z.boolean()
}).strict();

const classControlNeutralizationSchema = z.object({
  id: uuidSchema,
  classId: uuidSchema,
  courseVersionId: uuidSchema,
  courseControlId: uuidSchema,
  sequence: positiveIntegerSchema,
  controlCode: positiveIntegerSchema
}).strict();

function isStrictlySorted<T>(items: readonly T[], compare: (left: T, right: T) => number): boolean {
  return items.every((item, index) => index === 0 || compare(items[index - 1]!, item) < 0);
}

export const raceSnapshotSchema = z.object({
  race: raceSchema,
  classes: z.array(raceClassSchema).max(STATION_PACKAGE_LIMITS.classes),
  courses: z.array(courseSchema).max(STATION_PACKAGE_LIMITS.courses),
  entries: z.array(entrySchema).max(STATION_PACKAGE_LIMITS.entries),
  cardAssignments: z.array(cardAssignmentSchema).max(STATION_PACKAGE_LIMITS.cardAssignments),
  classControlNeutralizations: z.array(classControlNeutralizationSchema)
    .max(STATION_PACKAGE_LIMITS.classControlNeutralizations)
}).strict().superRefine((snapshot, context) => {
  const byId = (left: { id: string }, right: { id: string }) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  if (!isStrictlySorted(snapshot.classes, byId)) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Klasser måste vara unikt id-sorterade" });
  }
  if (!isStrictlySorted(snapshot.courses, byId)) {
    context.addIssue({ code: "custom", path: ["courses"], message: "Banor måste vara unikt id-sorterade" });
  }
  if (!isStrictlySorted(snapshot.entries, byId)) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagare måste vara unikt id-sorterade" });
  }
  if (!isStrictlySorted(snapshot.cardAssignments, byId)) {
    context.addIssue({ code: "custom", path: ["cardAssignments"], message: "Brickkopplingar måste vara unikt id-sorterade" });
  }
  if (!isStrictlySorted(snapshot.classControlNeutralizations, (left, right) =>
    left.classId < right.classId ? -1 : left.classId > right.classId ? 1 :
      left.courseVersionId < right.courseVersionId ? -1 : left.courseVersionId > right.courseVersionId ? 1 :
        left.sequence - right.sequence || byId(left, right))) {
    context.addIssue({ code: "custom", path: ["classControlNeutralizations"], message: "Neutraliseringar måste vara unikt id-sorterade" });
  }

  const versionIds = new Set<string>();
  for (const [courseIndex, course] of snapshot.courses.entries()) {
    if (course.raceId !== snapshot.race.id) {
      context.addIssue({ code: "custom", path: ["courses", courseIndex, "raceId"], message: "Banan hör inte till loppet" });
    }
    if (!isStrictlySorted(course.versions, (left, right) => left.version - right.version || byId(left, right))) {
      context.addIssue({ code: "custom", path: ["courses", courseIndex, "versions"], message: "Banversioner måste vara unikt versionssorterade" });
    }
    for (const [versionIndex, version] of course.versions.entries()) {
      versionIds.add(version.id);
      if (version.courseId !== course.id) {
        context.addIssue({ code: "custom", path: ["courses", courseIndex, "versions", versionIndex, "courseId"], message: "Banversionen hör inte till banan" });
      }
      if (!isStrictlySorted(version.controls, (left, right) => left.sequence - right.sequence || byId(left, right))) {
        context.addIssue({ code: "custom", path: ["courses", courseIndex, "versions", versionIndex, "controls"], message: "Bankontroller måste vara unikt sekvenssorterade" });
      }
      for (const [controlIndex, control] of version.controls.entries()) {
        if (control.courseVersionId !== version.id) {
          context.addIssue({
            code: "custom",
            path: ["courses", courseIndex, "versions", versionIndex, "controls", controlIndex, "courseVersionId"],
            message: "Bankontrollen hör inte till banversionen"
          });
        }
      }
      const variants = version.variants ?? [];
      const variantPath = ["courses", courseIndex, "versions", versionIndex, "variants"];
      if (!isStrictlySorted(variants, (left, right) => left.sequence - right.sequence) ||
          new Set(variants.map((variant) => variant.code)).size !== variants.length) {
        context.addIssue({ code: "custom", path: variantPath, message: "Varianter måste vara unika och sorterade i visningsordning" });
      }
      for (const [variantIndex, variant] of variants.entries()) {
        if (variant.courseVersionId !== version.id ||
            !isStrictlySorted(variant.controls, (left, right) => left.sequence - right.sequence) ||
            variant.controls.some((control) => control.courseVariantId !== variant.id)) {
          context.addIssue({ code: "custom", path: [...variantPath, variantIndex], message: "Varianten hör inte till banversionen" });
        }
      }
    }
  }

  const classIds = new Set(snapshot.classes.map((raceClass) => raceClass.id));
  for (const [classIndex, raceClass] of snapshot.classes.entries()) {
    if (raceClass.raceId !== snapshot.race.id) {
      context.addIssue({ code: "custom", path: ["classes", classIndex, "raceId"], message: "Klassen hör inte till loppet" });
    }
    if (!versionIds.has(raceClass.courseVersionId)) {
      context.addIssue({ code: "custom", path: ["classes", classIndex, "courseVersionId"], message: "Klassens banversion saknas" });
    }
  }
  const controlsById = new Map<string, { courseVersionId: string; sequence: number; controlCode: number }>();
  for (const course of snapshot.courses) for (const version of course.versions) for (const control of version.controls) {
    controlsById.set(control.id, control);
  }
  const neutralizedClassVersions = new Set<string>();
  for (const [index, neutralization] of snapshot.classControlNeutralizations.entries()) {
    const raceClass = snapshot.classes.find((value) => value.id === neutralization.classId);
    const control = controlsById.get(neutralization.courseControlId);
    if (!raceClass || raceClass.courseVersionId !== neutralization.courseVersionId || !control ||
        control.courseVersionId !== neutralization.courseVersionId || control.sequence !== neutralization.sequence ||
        control.controlCode !== neutralization.controlCode) {
      context.addIssue({ code: "custom", path: ["classControlNeutralizations", index], message: "Neutraliseringen matchar inte klassens aktuella kontrollförekomst" });
    }
    const key = `${neutralization.classId}:${neutralization.courseVersionId}`;
    if (neutralizedClassVersions.has(key)) {
      context.addIssue({ code: "custom", path: ["classControlNeutralizations", index], message: "Endast en neutralisering per klass och banversion är tillåten" });
    }
    neutralizedClassVersions.add(key);
  }

  const entryIds = new Set(snapshot.entries.map((entry) => entry.id));
  for (const [entryIndex, entry] of snapshot.entries.entries()) {
    if (entry.raceId !== snapshot.race.id || !classIds.has(entry.classId)) {
      context.addIssue({ code: "custom", path: ["entries", entryIndex], message: "Deltagarens lopp eller klass är ogiltig" });
    }
  }
  for (const [assignmentIndex, assignment] of snapshot.cardAssignments.entries()) {
    if (assignment.raceId !== snapshot.race.id || !entryIds.has(assignment.entryId)) {
      context.addIssue({ code: "custom", path: ["cardAssignments", assignmentIndex], message: "Brickkopplingens lopp eller deltagare är ogiltig" });
    }
  }
});

/**
 * Avläsningspaket för webbläsarens avläsningsstation (steg 4, ADR-0168).
 * Det hämtas med administratörens eller funktionärens session över HTTPS och
 * sparas lokalt för offlinebruk.
 */
export const readoutPackageSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema,
  packageVersion: positiveIntegerSchema,
  resultEngineVersion: z.string().trim().min(1).max(64),
  event: z.object({
    id: uuidSchema,
    name: z.string().min(1).max(160),
    startsOn: z.iso.date(),
    timeZone: z.string().trim().min(1).max(128)
  }).strict(),
  raceSnapshot: raceSnapshotSchema,
  /** Stafett (ADR-0169 beslut 3): saknas när tävlingen inte har stafettklasser. */
  relay: relayReadoutSchema.optional(),
  fetchedAt: z.iso.datetime({ offset: true })
}).strict().superRefine((value, context) => {
  if (value.raceId !== value.raceSnapshot.race.id) {
    context.addIssue({ code: "custom", path: ["raceId"], message: "Race-id matchar inte snapshoten" });
  }
  if (value.packageVersion !== value.raceSnapshot.race.snapshotVersion) {
    context.addIssue({ code: "custom", path: ["packageVersion"], message: "Paketversionen matchar inte snapshoten" });
  }
});

export type ReadoutPackage = z.infer<typeof readoutPackageSchema>;
