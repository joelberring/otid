export type EntryNavigationDestination = "cards" | "start-times" | "classes" | "history" | "entry-identity";
type Hint = { raceId: string; entryId: string; destination: EntryNavigationDestination };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let pending: Hint | undefined;

/** Ephemeral navigation hint, never authorization or mutation intent. */
export function offerEntryNavigation(hint: Hint): void {
  pending = uuid.test(hint.raceId) && uuid.test(hint.entryId) &&
    (["cards", "start-times", "classes", "history", "entry-identity"].includes(hint.destination)) ? { ...hint } : undefined;
}
export function consumeEntryNavigation(raceId: string, destination: EntryNavigationDestination): string | undefined {
  const hint = pending;
  pending = undefined;
  return hint?.raceId === raceId && hint.destination === destination ? hint.entryId : undefined;
}
