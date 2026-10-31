/** Syntetiska dokument för testerna, byggda med ändringarna. */
import { applyEdit, emptyDocument, type ControlKind, type CourseSettingDocument, type CourseSettingEdit } from "../src";

export class Builder {
  document: CourseSettingDocument;

  constructor(options: { mapScale?: number; sprint?: boolean } = {}) {
    this.document = emptyDocument({ title: "Test", mapScale: options.mapScale ?? 10000, sprint: options.sprint ?? false });
  }

  edit(edit: CourseSettingEdit): string {
    const result = applyEdit(this.document, edit);
    this.document = result.document;
    return result.created ?? "";
  }

  control(kind: ControlKind, x: number, y: number, code?: string): string {
    return this.edit({ type: "ADD_CONTROL", kind, at: { x, y }, ...(code !== undefined ? { code } : {}) });
  }

  course(name: string): string {
    return this.edit({ type: "ADD_COURSE", name });
  }

  /** Lägg in kontrollen efter banans kontroll `after` (saknas = före målet). */
  insert(course: string, control: string, after?: string | null): string {
    return this.edit({ type: "INSERT_COURSE_CONTROL", course, control, ...(after !== undefined ? { after } : {}) });
  }

  /** Banans kontroll för en kontroll (den första). */
  cc(course: string, control: string): string {
    const found = Object.values(this.document.courseControls).find(cc => cc.control === control);
    if (!found) throw new Error(`ingen banans kontroll för ${control} på ${course}`);
    return found.id;
  }

  code(control: string): string {
    return this.document.controls[control]!.code!;
  }
}

/** Start, mål och en bana "A" med kontrollerna i en rad (x = 0, 20, 40 … mm). */
export function lineCourse(count: number, options: { mapScale?: number; sprint?: boolean } = {}): { b: Builder; course: string; controls: string[]; start: string; finish: string } {
  const b = new Builder(options);
  const start = b.control("START", -20, 0);
  const finish = b.control("FINISH", 20 * count, 0);
  const course = b.course("A");
  const controls: string[] = [];
  for (let i = 0; i < count; i++) {
    const control = b.control("NORMAL", 20 * i, 0);
    controls.push(control);
    b.insert(course, control);
  }
  return { b, course, controls, start, finish };
}
