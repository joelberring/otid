import type { Texts } from "../lib/language";
import type { planCopySv } from "./club-plan-copy-sv";
import { plural } from "./plural";

/** The owner 2026-11-12: Fetch from the archive in a week of the term plan, and Copy the plan from a term. */
export const planCopyEn: Texts<typeof planCopySv> = {
  fromArchive: "Fetch from the archive",
  fromArchiveInWeek: (week: number) => `Fetch from the archive in week ${week}`,
  title: (week: number) => `Fetch from the archive to week ${week}`,
  help: "Choose a training from the club's archive. It becomes a planned training in the week; the courses and the map are added with Use again.",
  loading: "Loading the archive …",
  failed: "The archive could not be loaded.",
  empty: "The archive has no trainings yet.",
  search: "Search",
  searchPlaceholder: "Exercise, level, map, place …",
  count: (shown: number, all: number) => shown === all ? plural(all, "training", "trainings") : `${shown} of ${all} trainings`,
  none: "No training matches the search.",
  sameWeeks: "The same weeks in earlier years",
  noDate: "No date",
  courses: (count: number) => plural(count, "course", "courses"),
  choose: (title: string) => `Choose ${title}`,
  pick: "Choose",
  chosen: "Chosen",
  date: "Date",
  include: "Included",
  withMoments: "Exercises, levels and own words",
  withPeople: "The leaders: the responsible leader and the leaders' tasks (other tasks are copied without a person)",
  withCourses: "The courses and the map: create the training with Use again",
  coursesLater: "The courses and the map are added with Use again when the training is in the future.",
  add: "Add to the week",
  adding: "Adding to the week …",
  added: "The training from the archive is planned.",
  cancel: "Cancel",
  copyTerm: "Copy the plan from a term",
  copyHelp: "Each training in the chosen term lands on the same weekday in the corresponding week. The leaders come along; other tasks are copied without a person. No training is created and no emails are sent.",
  copyFrom: "From the term",
  copy: "Copy",
  copied: (copied: number, outside: number) => `${copied === 1 ? "1 training copied" : `${copied} trainings copied`}${outside > 0
    ? `, ${outside} ended up outside the term` : ""}.`
};
