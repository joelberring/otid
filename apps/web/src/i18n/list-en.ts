import type { Texts } from "../lib/language";
import type { listSv } from "./list-sv";

/** Step F2: the shared lists' words (the date tile, the groups, "Show more"). */
export const listEn: Texts<typeof listSv> = {
  undated: "No date",
  today: "today",
  yesterday: "yesterday",
  showMore: (more: number) => `Show more (${more} more)`
};
