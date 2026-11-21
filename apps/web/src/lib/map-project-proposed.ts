import type { MapObject, Point } from "@o-tid/map-file";

/** Förslagens ändringar att rita: nya lägen och platserna för borttagningar (ändringens punkt). Utbrutet ur `map-project-editor.tsx`. */
export interface ProposedDrawing { readonly objects: MapObject[]; readonly deleted: Point[] }

export function proposedDrawing(edits: readonly { state: unknown; point?: Point | null | undefined }[]): ProposedDrawing {
  const objects: MapObject[] = [], deleted: Point[] = [];
  for (const edit of edits) {
    const value = edit.state as { kind?: string; object?: MapObject } | undefined;
    if (value?.kind === "OBJECT" && value.object) objects.push(value.object);
    else if (value?.kind === "DELETED" && edit.point) deleted.push(edit.point);
  }
  return { objects, deleted };
}
