import type { ClubStorageTexts } from "./club-storage-sv";

/** PLAN.md step M7: the club's storage on the club page, for leaders, administrators and owners. */
const mb = (bytes: number) => bytes === 0 ? "0 MB" : bytes < 104858 ? "< 0.1 MB" : `${(bytes / 1048576).toFixed(1)} MB`;

export const clubStorageEn: ClubStorageTexts = {
  title: "The club's storage",
  summary: (used: number, limit: number) => `${mb(used)} of ${mb(limit)} used (${Math.min(999, Math.round(used / limit * 100))} %).`,
  help: "Everything in the club archive counts against the club, including the automatic archiving of finished trainings and what members who have left the club uploaded. A copy from the archive to your own training or map project is not counted again; changes in the copy count against your own account. The largest is listed first.",
  warning: (used: number, limit: number) => `The club's storage is nearly full: ${mb(used)} of ${mb(limit)}. Remove map versions you do not need or ask the superadmin to raise the club's limit.`,
  full: (used: number, limit: number) => `The club's storage is full (${mb(used)} of ${mb(limit)}). Nothing new can be put in the club archive until something has been removed from it or the superadmin has raised the club's limit.`,
  columns: { map: "Map", versions: "Versions", size: "Size" },
  courseFiles: "Course files",
  empty: "The club archive has no map files yet.",
  mb
};
