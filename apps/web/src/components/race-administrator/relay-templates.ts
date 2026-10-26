import type { RelayTemplateId } from "../../i18n/relay-form-sv";

/** En sträcka i stafettklassens formulär. Steg 56: banan krävs på varje sträcka ("" = inte vald än). */
export type RelayLegForm = { method: "MASS_START" | "CHANGEOVER" | "RESTART" | "FLYING_RESTART"; time: string; variant: string; course: string;
  minutes: string;
  /** Steg 48: löpare på sträckan och reglerna för flera löpare. */
  runners: string; changeoverRule: "FIRST" | "LAST"; approvalRule: "ALL" | "ANY" };

export const RELAY_TEMPLATES: readonly RelayTemplateId[] = ["STANDARD", "TEAM_SPRINT", "YOUTH", "LINE"];

/** Nya sträckor: växling (sträcka 1 masstart), en löpare och banan från snabbvalet "Samma bana på alla sträckor". */
export function defaultLegs(count: number, previous: readonly RelayLegForm[] = [], course = ""): RelayLegForm[] {
  return Array.from({ length: count }, (_, index) => previous[index] ??
    { method: index === 0 ? "MASS_START" : "CHANGEOVER", time: "", variant: "", course, minutes: "", runners: "1",
      changeoverRule: "FIRST", approvalRule: "ALL" });
}

export type RelayTemplateSettings = { legs: RelayLegForm[]; readoutMode: "" | "EACH_LEG"; changeoverCode: ""; restartRanking: "AFTER_NORMAL";
  forking: "EVEN";
  /** Om mallen sätter något under "Fler inställningar" (som då öppnas). */
  more: boolean };

/**
 * Steg 56: mallarna i "Ny stafettklass". En mall sätter sträckorna och klassens inställningar men inte klassnamnet eller
 * banorna: varje sträcka behåller sin bana och sin variant, och nya sträckor får banan från snabbvalet. Masstartstiden
 * på sträcka 1 står också kvar.
 */
export function relayTemplate(id: RelayTemplateId, previous: readonly RelayLegForm[], sameCourse: string): RelayTemplateSettings {
  const count = id === "TEAM_SPRINT" ? 4 : id === "LINE" ? 5 : 3;
  const legs = defaultLegs(count, [], sameCourse).map((leg, index): RelayLegForm => {
    const kept = previous[index];
    const base = kept ? { ...leg, course: kept.course, variant: kept.variant } : leg;
    if (index === 0) return { ...base, time: kept?.time ?? "" };
    if (id === "LINE") return { ...base, method: "FLYING_RESTART", minutes: "60" };
    if (id === "YOUTH" && index === 1) return { ...base, runners: "2" };
    return base;
  });
  return { legs, readoutMode: id === "TEAM_SPRINT" ? "EACH_LEG" : "", changeoverCode: "", restartRanking: "AFTER_NORMAL", forking: "EVEN",
    more: id === "TEAM_SPRINT" || id === "LINE" };
}
