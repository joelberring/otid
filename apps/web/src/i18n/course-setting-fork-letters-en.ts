import type { Texts } from "../lib/language";
import type { forkLettersSv } from "./course-setting-fork-letters-sv";

const many = (count: number, one: string, other: string) => `${count} ${count === 1 ? one : other}`;

export const forkLettersEn: Texts<typeof forkLettersSv> = {
  heading: "Fork keys",
  draft: "Draft: the keys are ordered as you work (A, B; C, D … in course order).",
  draftKept: (letters: string) => `Draft: the keys are ${letters}. They are reordered when you change a fork, or with “Order the keys”.`,
  locked: (reason: string, at: string) => `Locked: ${reason} (${at}). A branch keeps its letter, a new branch gets an unused one.`,
  reasons: {
    MANUAL: "locked by hand",
    PRINT: "maps with variant codes have been printed",
    ASSIGNED: "runners have variants in the race",
    START_LIST: "the start list is published"
  },
  lock: "Lock the keys",
  unlock: "Unlock",
  renumber: "Order the keys",
  renumberNothing: "The keys are already in course order.",
  preview: "Preview: old → new code",
  previewCaption: (name: string) => `New codes for ${name}`,
  from: "Now",
  to: "Becomes",
  same: "same",
  excluded: "excluded (carried over)",
  apply: "Order the keys",
  cancel: "Cancel",
  confirmUnlock: "Unlock the keys? Removing or adding a branch will then reorder the letters on the course.",
  confirmRenumber: "Order the keys on a locked course? Check what is affected below.",
  confirm: "Yes, continue",
  affected: "Affected",
  loading: "Fetching what is affected …",
  loadFailed: "Could not fetch what is affected. Try again, or cancel.",
  printed: (count: number) => `${many(count, "map", "maps")} with variant codes in the print jobs have the old code.`,
  printedUnknown: "Maps printed from the browser cannot be counted.",
  startList: "The published start list has the old codes until it is published again.",
  runners: (count: number) => `${many(count, "runner", "runners")} with an assigned variant: the code changes at the next “Transfer to the race”, the controls stay the same.`,
  more: (count: number) => `and ${count} more`,
  excludedAffected: (codes: string) => `Excluded variants that get a new code: ${codes}.`,
  nothingAffected: "No printed maps, assigned variants or published start list."
};
