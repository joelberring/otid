import type { MapBundleResponse } from "@o-tid/contracts";
import { courseVariants, excludedVariantCodes, type CourseSettingDocument, type SheetItem } from "@o-tid/course-setting";
import { mapBackPages, type MapBackPage } from "@o-tid/domain";

/**
 * Steg 64: utskrift per löpare. Steg 61:s plan (`planMapBundles` via kartbuntarna) ger ordningen, löparna, lediga tider
 * och reserver per variant; här blir de en karta var (`SheetItem` med löparens uppgifter) i banläggningens dokument.
 * Banorna matchas på namn (överföringen ger tävlingens banor samma namn). Kontrollen före utskrift: varje löpare har en
 * variant, varianten finns i banläggningen och antalet per variant stämmer med kartbuntslistan.
 */
export type RunnerPrintProblem =
  | { readonly kind: "MISSING_VARIANT"; readonly name: string; readonly className: string }
  | { readonly kind: "UNKNOWN_COURSE"; readonly courseName: string }
  | { readonly kind: "UNKNOWN_VARIANT"; readonly courseName: string; readonly variantCode: string }
  /** ADR-0198: varianten är bortvald i banläggningen; inga kartor (inte heller reserver) skrivs ut för den. */
  | { readonly kind: "EXCLUDED_VARIANT"; readonly courseName: string; readonly variantCode: string; readonly count: number }
  | { readonly kind: "COUNT"; readonly courseName: string; readonly variantCode: string | null; readonly expected: number; readonly actual: number };

/** ADR-0213: en löpare med en bortvald variant (skrivs inte ut men står i kontrolltabellen). */
export interface ExcludedRunner {
  readonly courseName: string; readonly variantCode: string; readonly runner: NonNullable<SheetItem["runner"]>;
}

export interface RunnerPrint {
  readonly items: readonly SheetItem[];
  readonly excluded: readonly ExcludedRunner[];
  readonly problems: readonly RunnerPrintProblem[];
  /** Kartor per variant (för översikten). */
  readonly counts: readonly { readonly courseName: string; readonly variantCode: string | null; readonly count: number }[];
}

/** Startordningen: löpare och lediga med starttid först, fri start sedan, reserverna sist. */
const rank = (item: SheetItem, at: string | null) => item.runner?.kind === "RESERVE" ? 2 : at === null ? 1 : 0;

/**
 * Kartorna med löparens uppgifter. BUNDLE = buntordning (per variant: löpare och lediga tider, sedan reserver);
 * START = startordning över alla banor (starttid, sedan startnummer), reserverna sist i buntordning.
 */
export function runnerPrintItems(document: CourseSettingDocument, bundles: Pick<MapBundleResponse, "groups" | "missingVariant">,
  clock: (instant: string | null) => string, order: "BUNDLE" | "START" = "BUNDLE"): RunnerPrint {
  const problems: RunnerPrintProblem[] = bundles.missingVariant.map(row => ({ kind: "MISSING_VARIANT", name: row.name, className: row.className }));
  const items: SheetItem[] = [];
  const counts = new Map<string, { courseName: string; variantCode: string | null; count: number }>();
  const known = new Set<string>();
  const instants: (string | null)[] = [];
  const excludedPages = new Map<string, { kind: "EXCLUDED_VARIANT"; courseName: string; variantCode: string; count: number }>();
  const excludedCache = new Map<string, ReadonlySet<string>>();
  const excludedRunners: ExcludedRunner[] = [];
  const excludedOf = (course: string) => {
    if (!excludedCache.has(course)) {
      let codes: ReadonlySet<string> = new Set();
      try { codes = excludedVariantCodes(document, course); } catch { codes = new Set(); }
      excludedCache.set(course, codes);
    }
    return excludedCache.get(course)!;
  };
  for (const page of mapBackPages(bundles.groups)) {
    if (page.kind === "DIVIDER") continue;
    const course = document.courses.find(row => row.name === page.courseName);
    if (!course) {
      if (!known.has(page.courseName)) problems.push({ kind: "UNKNOWN_COURSE", courseName: page.courseName });
      known.add(page.courseName);
      continue;
    }
    const variant = page.variantCode ?? undefined;
    const key = `${page.courseName}|${page.variantCode ?? ""}`;
    // ADR-0198: en bortvald variant skrivs aldrig ut, inte heller som reserv; löpare med den sägs som problem.
    if (variant && excludedOf(course.id).has(variant)) {
      const found = excludedPages.get(key) ?? { kind: "EXCLUDED_VARIANT" as const, courseName: page.courseName, variantCode: variant, count: 0 };
      if (page.kind !== "RESERVE") { found.count += 1; excludedRunners.push({ courseName: page.courseName, variantCode: variant, runner: runnerOf(page, clock) }); }
      excludedPages.set(key, found);
      continue;
    }
    if (variant && !known.has(key)) {
      known.add(key);
      let codes: string[] = [];
      try { codes = courseVariants(document, course.id).map(row => row.code); } catch { codes = []; }
      if (!codes.includes(variant)) problems.push({ kind: "UNKNOWN_VARIANT", courseName: page.courseName, variantCode: variant });
    }
    const runner = runnerOf(page, clock);
    items.push({ course: course.id, ...(variant ? { variant } : {}), runner });
    instants.push(page.kind === "RESERVE" ? null : page.item.startTime);
    const count = counts.get(key) ?? { courseName: page.courseName, variantCode: page.variantCode, count: 0 };
    count.count += 1;
    counts.set(key, count);
  }
  problems.push(...[...excludedPages.values()].filter(row => row.count > 0));
  for (const group of bundles.groups) {
    if (excludedPages.has(`${group.courseName}|${group.variantCode ?? ""}`)) continue;
    const actual = counts.get(`${group.courseName}|${group.variantCode ?? ""}`)?.count ?? 0;
    if (group.printCount > 0 && actual !== group.printCount && document.courses.some(row => row.name === group.courseName)) {
      problems.push({ kind: "COUNT", courseName: group.courseName, variantCode: group.variantCode, expected: group.printCount, actual });
    }
  }
  const ordered = order === "BUNDLE" ? items : items.map((item, index) => ({ item, index, at: instants[index] ?? null }))
    .sort((a, b) => rank(a.item, a.at) - rank(b.item, b.at) || (a.at ?? "").localeCompare(b.at ?? "")
      || (a.item.runner?.startNumber ?? Infinity) - (b.item.runner?.startNumber ?? Infinity) || a.index - b.index).map(row => row.item);
  return { items: ordered, excluded: excludedRunners, problems, counts: [...counts.values()] };
}

/** Löparens uppgifter för kartan (ADR-0213: deltagaren, laget och sträckan för urvalet och kontrolltabellen). */
function runnerOf(page: Exclude<MapBackPage, { kind: "DIVIDER" }>, clock: (instant: string | null) => string): NonNullable<SheetItem["runner"]> {
  if (page.kind === "RUNNER") return { kind: "RUNNER", name: page.item.name, club: page.item.club, className: page.item.className,
    startTime: page.item.startTime ? clock(page.item.startTime) : null, startNumber: page.item.number, entryId: page.item.entryId,
    ...(page.item.team ? { team: page.item.team } : {}), ...(page.item.leg !== undefined ? { leg: page.item.leg } : {}) };
  if (page.kind === "VACANT") return { kind: "VACANT", name: null, className: page.item.className, startTime: clock(page.item.startTime), startNumber: page.item.number };
  return { kind: "RESERVE", name: null, className: null, startTime: null, startNumber: null };
}
