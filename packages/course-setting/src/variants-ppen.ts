/**
 * ADR-0198: de bortvalda varianterna i .ppen. Purple Pens format har inget för bortvalda varianter (bara stafettens fasta
 * grenar per sträcka, `relay-branch`), så de skrivs som träningen (ADR-0192 beslut 10): ett eget element sist i filen i
 * O-Tid:s namnrymd med JSON. Purple Pen hoppar över elementet när filen öppnas och skriver inte tillbaka det; en fil som
 * sparats i Purple Pen saknar det, och då följer bortvalen med från banläggningen när filen läses in
 * (`carryExcludedVariants`) så länge varianterna finns kvar.
 */
import { allCourseVariantList, isExcludedVariant } from "./summary";
import type { Course, CourseSettingDocument, ExcludedVariant } from "./types";
import { attr, el, textOf, type XmlElement } from "./xml";

export const VARIANTS_ELEMENT = "otid:variants";
export const VARIANTS_NAMESPACE = "https://o-tid.se/ns/ppen-variants/1";

interface VariantsJson {
  readonly schemaVersion: 1;
  /** Banans id → bortvalda varianter. */
  readonly courses: Readonly<Record<string, readonly ExcludedVariant[]>>;
}

const validRow = (row: unknown): row is ExcludedVariant => typeof row === "object" && row !== null &&
  typeof (row as ExcludedVariant).code === "string" && (row as ExcludedVariant).code.length > 0 && (row as ExcludedVariant).code.length <= 64 &&
  Array.isArray((row as ExcludedVariant).controls) && (row as ExcludedVariant).controls.every(code => typeof code === "string");

/** Bortvalen ur elementet på banorna som finns; kastar om versionen eller formen är fel. */
export function readVariantsElement(element: XmlElement, document: CourseSettingDocument): CourseSettingDocument {
  if (attr(element, "schema-version") !== "1") throw new Error("okänd version av varianterna");
  const parsed = JSON.parse(textOf(element)) as Partial<VariantsJson>;
  if (typeof parsed !== "object" || parsed === null || parsed.schemaVersion !== 1 || typeof parsed.courses !== "object" || parsed.courses === null) {
    throw new Error("varianterna har fel form");
  }
  const courses = parsed.courses;
  return { ...document, courses: document.courses.map(course => {
    const rows = courses[course.id];
    if (!Array.isArray(rows) || rows.length === 0 || course.kind === "SCORE") return course;
    if (!rows.every(validRow)) throw new Error("varianterna har fel form");
    return { ...course, excludedVariants: rows.map(row => ({ code: row.code, controls: [...row.controls] })) };
  }) };
}

/** Elementet för filen, eller `undefined` när ingen bana har bortvalda varianter. */
export function variantsElement(document: CourseSettingDocument): XmlElement | undefined {
  const courses = Object.fromEntries(document.courses.filter(course => (course.excludedVariants?.length ?? 0) > 0)
    .map(course => [course.id, course.excludedVariants!]));
  if (Object.keys(courses).length === 0) return undefined;
  const out: VariantsJson = { schemaVersion: 1, courses };
  return el(VARIANTS_ELEMENT, [["xmlns:otid", VARIANTS_NAMESPACE], ["schema-version", "1"]], [JSON.stringify(out)]);
}

/**
 * En ny .ppen ersätter banläggningen. Saknar en bana i den nya filen bortval (filen sparad i Purple Pen) får den bortvalen
 * från samma bana i den nuvarande (samma id och namn, annars samma namn), men bara de som stämmer med en variant i den nya
 * filen (samma kod och kontroller).
 */
export function carryExcludedVariants(current: CourseSettingDocument, imported: CourseSettingDocument): CourseSettingDocument {
  const previousOf = (course: Course) => current.courses.find(row => row.id === course.id && row.name === course.name) ??
    current.courses.find(row => row.name === course.name);
  let changed = false;
  const courses = imported.courses.map(course => {
    if (course.excludedVariants?.length || course.kind === "SCORE") return course;
    const previous = previousOf(course);
    if (!previous?.excludedVariants?.length) return course;
    const variants = allCourseVariantList(imported, course.id);
    const rows = previous.excludedVariants.filter(row => variants.some(variant => isExcludedVariant({ ...course, excludedVariants: [row] }, variant)));
    // Minst en variant ska användas.
    if (rows.length === 0 || rows.length >= variants.length) return course;
    changed = true;
    return { ...course, excludedVariants: rows };
  });
  return changed ? { ...imported, courses } : imported;
}
