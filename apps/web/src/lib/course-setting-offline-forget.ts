import { memoryFieldStore, type FieldStore } from "./course-setting-offline";
import { indexedDbFieldStore } from "./course-setting-offline-idb";
import { removeAllShells, removeShell } from "./course-setting-offline-shell";

/**
 * Översynen 2026-11-02: banläggningen i telefonen omfattas av banhemligheten (ADR-0176). Vid utloggning tas telefonens
 * kopia av alla tävlingars banläggning bort (posten, kön, kartfilen och sidan), och när servern säger att man inte längre
 * har tillgång (403 på läsningen) tas tävlingens kopia bort. Förra årets bankontrollant ska inte ha banorna kvar.
 */
let shared: FieldStore | undefined;
export function fieldStore(): FieldStore {
  shared ??= indexedDbFieldStore() ?? memoryFieldStore();
  return shared;
}

/** Tävlingens kopia: posten, kön, kartfilen och den sparade sidan. */
export async function forgetCourseSettingCopy(raceId: string, store: FieldStore = fieldStore()): Promise<void> {
  await store.clearRecord(raceId);
  for (const item of await store.listQueue(raceId)) await store.removeQueued(item.id);
  await store.clearMap(raceId);
  await removeShell(raceId);
}

/** Alla tävlingars kopior (utloggning). Ett fel kastas vidare så att den som anropar kan säga det. */
export async function forgetAllCourseSettingCopies(store: FieldStore = fieldStore()): Promise<void> {
  await store.clearAll();
  await removeAllShells();
}
