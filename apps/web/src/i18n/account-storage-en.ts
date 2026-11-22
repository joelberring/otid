import type { AccountStorageTexts } from "./account-storage-sv";

/** The account's map storage (PLAN.md steps L2–L3). */
export const accountStorageEn: AccountStorageTexts = {
  title: "Storage for map files",
  help: "How much space your map files take, per map project. The largest is listed first.",
  loading: "Calculating …",
  failed: "The storage could not be fetched.",
  summary: (usedMb: number, limitMb: number | null) => limitMb === null ? `${usedMb} MB used.` : `${usedMb} of ${limitMb} MB used.`,
  nearLimit: "You are near the limit. Remove older runs or base layers you do not need.",
  overLimit: "The limit is reached. New files and laser runs cannot be saved until you have removed something.",
  empty: "No map files yet.",
  columns: { project: "Map project", geo: "Laser runs", layers: "Base layers", outputs: "Results", base: "Base file", total: "Total", opened: "Last opened", actions: "Action" },
  neverOpened: "–",
  other: "Other (events and trainings)",
  mb: (bytes: number) => bytes === 0 ? "–" : bytes < 104858 ? "< 0.1 MB" : `${(bytes / 1048576).toFixed(1)} MB`,
  prune: (runs: number) => runs === 1 ? "Remove 1 older run" : `Remove ${runs} older runs`,
  pruneConfirm: "The runs' files and the base images they produced are removed. The project's latest finished run and its base layers are kept. This cannot be undone.",
  pruneYes: "Remove",
  cancel: "Cancel",
  working: "Removing …",
  pruned: (runs: number, layers: number) => `${runs} ${runs === 1 ? "run" : "runs"} and ${layers} ${layers === 1 ? "base image" : "base images"} were removed. The space is freed within a day.`,
  pruneFailed: "The runs could not be removed.",
  open: "Open",
  regenerable: {
    title: "Regenerable base data",
    summary: (usedMb: number, limitMb: number) => `${usedMb} of ${limitMb} MB used by laser runs and fetched images (orthophotos, soil moisture, Skogsstyrelsen, WMS).`,
    help: (idleDays: number | null) => "When the limit is passed, what was used least recently is removed from the store at once. It can be regenerated: when you open the "
      + "project the laser run is run again (not counted against the laser quota) and the images are fetched again. Base data in projects opened in the last "
      + `3 days and the project's latest finished laser run are never removed for the limit.${idleDays === null ? "" : ` Anything unused for ${idleDays} days is also removed.`}`,
    protected: (mb: number) => `Protected right now: ${mb} MB.`,
    gone: (mb: number) => `Removed and can be regenerated: ${mb} MB.`,
    next: "Removed next",
    nextEmpty: "Nothing can be removed right now: everything is protected.",
    columns: { what: "Base data", project: "Map project", size: "Size", used: "Last used" },
    overLimit: (projects: readonly string[]) => `You have a lot of base data in ${projects.join(" and ")}. Remove older runs or ask the superadmin for more.`
  }
};
