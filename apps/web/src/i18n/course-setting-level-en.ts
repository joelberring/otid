import type { CourseLevel, LevelRank, LevelValues } from "@o-tid/course-setting";
import type { Texts } from "../lib/language";
import type { LEVEL_REASONS, LEVEL_TIPS, courseSettingLevelSv } from "./course-setting-level-sv";

/** Engelska del 29: nivåstödet (Svensk Orienterings nivåer Grön–Svart som Green–Black). */
const RANK_NAMES: Readonly<Record<LevelRank, string>> = { 0: "Green", 1: "White", 2: "Yellow", 3: "Orange", 4: "Violet", 5: "Blue–Black" };
const LEVEL_NAMES: Readonly<Record<CourseLevel, string>> = { GRON: "Green", VIT: "White", GUL: "Yellow", ORANGE: "Orange", VIOLETT: "Violet", BLA: "Blue", SVART: "Black" };
const LEVEL_ADJECTIVES: Readonly<Record<CourseLevel, string>> = { GRON: "green", VIT: "white", GUL: "yellow", ORANGE: "orange", VIOLETT: "violet",
  BLA: "blue or black", SVART: "blue or black" };

const capitalFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const far = (meters: number | undefined) => meters === undefined || meters >= 250 ? "over 250 m" : `${meters} m`;
const v = (values: LevelValues, key: string) => values[key] ?? 0;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const LEVEL_REASONS_EN: typeof LEVEL_REASONS = {
  C_ON_HANDRAIL: values => `is ${far(values.meters)} from the nearest clear handrail – Green wants the control on or right next to the path (at most ${v(values, "limit")} m)`,
  C_NEAR_HANDRAIL: values => `is ${far(values.meters)} from the nearest path or other handrail – more than White allows (${v(values, "limit")} m)`,
  C_CLEAR_FEATURE: values => `the feature is not large and is ${far(values.meters)} from the path – White wants a large, clear feature or the control by the path (${v(values, "limit")} m)`,
  C_SOME_DISTANCE: values => `is ${far(values.meters)} from the nearest handrail – more than Yellow allows (${v(values, "limit")} m)`,
  C_SMALL_NEAR: values => `a small feature ${far(values.meters)} from the path – on Yellow only on the path; a knoll or depression is Orange`,
  C_PLAIN_TERRAIN: values => `detailed terrain: ${v(values, "count")} details within ${v(values, "meters")} m – Green and White only on the path or in simple terrain (at most ${v(values, "limit")})`,
  C_DISTINCT_FEATURE: values => `${v(values, "count")} similar features within ${v(values, "meters")} m to mistake the control's for – more than Yellow allows (${v(values, "limit")})`,
  C_READABLE_TERRAIN: values => `very detailed terrain: ${v(values, "count")} details within ${v(values, "meters")} m – needs careful map reading, harder than Orange (at most ${v(values, "limit")})`,
  C_SMALL_REACH: values => `a small feature ${far(values.meters)} from the nearest handrail with no attack point nearby – harder than Orange (${v(values, "limit")} m)`,
  C_RELOCATION: values => `nothing clear to relocate on within ${v(values, "limit")} m – Orange wants that`,
  C_ATTACK: values => `a small feature with no large, clear attack point within ${v(values, "limit")} m – harder than Violet`,
  L_FOLLOW_CLEAR: values => `${v(values, "percent")} % of the route follows handrails and the longest part without is ${v(values, "meters")} m – Green wants the leg to follow the path all the way (at most ${v(values, "limit")} m without)`,
  L_FEW_DECISIONS: values => `${v(values, "count")} changes between handrails – more than Green can take (${v(values, "limit")})`,
  L_NO_CHOICE: values => `${v(values, "count")} equal route choices (within 10 %) – Green should have no route choice`,
  L_SOME_DECISIONS: values => `${v(values, "count")} changes between handrails and ${v(values, "junctions")} path junctions – more than White can take (${v(values, "limit")} changes)`,
  L_NETWORK: values => `${v(values, "count")} changes and ${v(values, "junctions")} path junctions – a dense path network where the right path is a task, harder than Yellow`,
  L_ROUTE_CHOICE: values => `${v(values, "count")} equal route choices (within 10 %) – Yellow has simple route choices, several real route choices are Orange`,
  L_HARD_CHOICE: values => `${v(values, "count")} equal route choices with ${v(values, "decisions")} changes – hard route choice assessment, harder than Violet`,
  L_NO_SHORTCUT: values => `cutting across saves ${v(values, "percent")} % against following the paths – on Green and White the route should go along handrails`,
  L_FOLLOW: values => `${v(values, "percent")} % of the route follows handrails and the longest part without is ${v(values, "meters")} m – more than White allows (${v(values, "limit")} m)`,
  L_EASY_CONTOURS: values => `${v(values, "meters")} m of contour reading far from handrails – more than Yellow allows (${v(values, "limit")} m)`,
  L_SHORT_OFF: values => `${v(values, "meters")} m without a handrail – more than Yellow allows (${v(values, "limit")} m)`,
  L_CONTOURS: values => `${v(values, "meters")} m of contour reading in detailed terrain – harder than Violet (${v(values, "limit")} m)`,
  L_OFF: values => `${v(values, "meters")} m without a handrail – more than Orange and Violet allow (${v(values, "limit")} m)`
};

export const LEVEL_TIPS_EN: typeof LEVEL_TIPS = {
  C_ON_HANDRAIL: "Put the control on the path, e.g. at a path junction or where the path meets a ditch",
  C_NEAR_HANDRAIL: "Move the control closer to the path (within ~20 m) or choose a larger feature",
  C_CLEAR_FEATURE: "Choose a clearer feature, e.g. a larger boulder or a hill",
  C_SOME_DISTANCE: "Move the control closer to a path, a ditch or a wall (within ~100 m)",
  C_SMALL_NEAR: "Choose a clearer feature, e.g. a larger boulder or a hill – or move the control closer to the path",
  C_PLAIN_TERRAIN: "Put the control on the path itself, or in simpler terrain with fewer details around",
  C_DISTINCT_FEATURE: "Choose a feature without similar neighbours, or a larger and clearer one",
  C_READABLE_TERRAIN: "Put the control where the terrain is calmer, or with a clear attack point just before it",
  C_SMALL_REACH: "Put a clear attack point (large boulder, ditch end) before the control, or choose a larger feature",
  C_RELOCATION: "Put the control where there are clear features around to relocate on (a path, a ditch, a large boulder)",
  C_ATTACK: "Put a clear attack point (large boulder, ditch end) before the control",
  L_FOLLOW_CLEAR: "Put the control at a path junction so the leg can follow the path all the way",
  L_FEW_DECISIONS: "Put a control at one of the path junctions so the leg gets fewer changes",
  L_NO_CHOICE: "Place the controls so there is only one natural route, along the path",
  L_SOME_DECISIONS: "Put a control at one of the path junctions so the leg gets fewer choices",
  L_NETWORK: "Split the leg with a control in the path network, or put it where there are fewer paths",
  L_ROUTE_CHOICE: "Place the control so one route choice is clearly best, or remove one of the equal route choices",
  L_HARD_CHOICE: "Simplify the route choice: place the control so one route choice has fewer decisions",
  L_NO_SHORTCUT: "Place the controls so cutting across does not pay, e.g. where the path goes straight towards the next control",
  L_FOLLOW: "Place the control so the leg follows paths, ditches or walls – at most a short part without",
  L_EASY_CONTOURS: "The leg needs contour reading – split it with a control by the path",
  L_SHORT_OFF: "Shorten the part without a handrail (at most ~150 m) or split the leg with a control by the path",
  L_CONTOURS: "The leg needs contour reading – split it with a control by the path",
  L_OFF: "Split the leg with a control at a clear handrail",
  E_CONTROL_EASY: "The control is much easier than the course's level – put it a bit away from the path, at a smaller feature",
  E_LEG_NO_SHORTCUT: "Cutting across does not pay here – move the control so the short cut becomes clear",
  E_LEG_EASY: "The leg is much easier than the course's level – put the control further from the handrails"
};

export const courseSettingLevelEn: Texts<typeof courseSettingLevelSv> = {
  rankName: (rank: LevelRank) => RANK_NAMES[rank],
  levelName: (level: CourseLevel) => LEVEL_NAMES[level],
  field: {
    label: "Level",
    none: "None",
    help: "The course's difficulty level according to the Swedish Orienteering Federation. The level support compares with it when you ask.",
    suggested: (level: string) => `Suggestion from the classes: ${level}`,
    use: "Use",
    guide: (level: CourseLevel | undefined) => level ? `How do you set a ${LEVEL_ADJECTIVES[level]} course?` : "About the levels and the level support"
  },
  panel: {
    heading: "Level support",
    support: "A support – you as course setter decide.",
    assess: "Assess the level",
    assessAll: "Assess all courses",
    again: "Assess again",
    running: (done: number, total: number) => `Assessing … ${done} of ${total} legs`,
    waiting: "Waiting for the route choices …",
    stale: "Out of date – assess again",
    failed: "The level could not be assessed (the route choices were not calculated).",
    noMap: "Upload the map file first: the level support reads the map's symbols.",
    sprint: "The level support does not apply to sprint: the Swedish federation has no colour scale for sprint (the challenge lies in the route choices).",
    score: "Score course: only the controls are assessed.",
    empty: "The course has no controls to assess yet.",
    summary: (typical: string, low: string, high: string) => low === high ? `The course roughly matches ${typical}.`
      : `The course roughly matches ${typical} (${low}–${high}).`,
    harder: (legs: number, controls: number, level: string) => {
      const parts = [legs > 0 ? count(legs, "leg", "legs") : "", controls > 0 ? count(controls, "control", "controls") : ""].filter(Boolean);
      if (parts.length === 0) return `Nothing is harder than ${level}.`;
      return `${capitalFirst(parts.join(" and "))} ${legs + controls === 1 ? "is" : "are"} harder than ${level}.`;
    },
    easier: (n: number, level: string) => `${count(n, "control or leg is", "controls and legs are")} clearly easier than ${level}.`,
    target: (level: string) => `Target level: ${level}`,
    noTarget: "No target level chosen (set in the course's properties).",
    details: (n: number) => `Controls and legs (${n})`,
    onlyDeviations: "Only deviations from the target level",
    notices: "Show deviations from the level in Warnings",
    noticesHelp: "Notes, never errors. They can be accepted like other warnings.",
    show: "Show on the map",
    suggest: "Show suggestion on the map",
    hideSuggest: "Hide the suggestion",
    tip: "Tip",
    okControl: "is at a clear handrail",
    okLeg: "follows clear handrails",
    noRoute: "no route choice to assess",
    leg: (from: string, to: string) => `${from}–${to}`,
    badge: (rank: string) => `Level ${rank}`,
    harderTag: "Harder than the target level",
    easierTag: "Clearly easier than the target level",
    measures: "Measures the distance to paths and other handrails, the control's feature, attack points and the route choice: how much follows handrails, whether cutting across pays and whether the leg needs contour reading."
  },
  check: (label: string, rank: string, target: string, reason: string, tip: string) => `${label}: ${reason} (≈ ${rank}, target level ${target}). ${tip}.`,
  candidates: { junction: "Path junction", handrail: "Nearest path", bigFeature: "Large feature", offAt: "Without handrail" }
};
