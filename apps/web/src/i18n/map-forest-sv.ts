/** Ägaren 2026-11-11: Skogsstyrelsens underlag, hyggen efter ålder och beståndsgränser i kartprojektet. */
export const mapForestSv = {
  images: {
    heading: "Skogsstyrelsen (underlag)",
    help: "Skogsstyrelsens öppna kartor för hela kartan eller en etapp, som underlag att tända, släcka och tona under Lager.",
    products: { CLEAR_CUTS: "Utförda avverkningar (hyggen)", NOTIFIED: "Avverkningsanmälningar", KEY_BIOTOPES: "Nyckelbiotoper" },
    fetch: "Hämta som underlag",
    fetching: "Hämtar från Skogsstyrelsen …",
    name: (product: string, area?: string) => `Skogsstyrelsen ${product} ${area ?? "hela kartan"}`.slice(0, 80),
    added: (count: number) => count === 1 ? "1 underlag är tillagt." : `${count} underlag är tillagda.`,
    attribution: "© Skogsstyrelsen."
  },
  cuts: {
    heading: "Hyggen med reglage",
    help: "Skogsstyrelsens utförda avverkningar (från 0,5 ha) delas in efter ålder. Dra i åldrarna: kandidaterna på kartan räknas om direkt.",
    fetch: "Hämta hyggen",
    fetching: "Hämtar hyggen …",
    fresh: (years: number) => `Färskt hygge (403) yngre än ${years} år`,
    scrub: (years: number) => `Sly (407) till ${years} år`,
    young: (years: number) => `Ungskog (406) till ${years} år`,
    borders: "Hyggets kant som vegetationsgräns (416)",
    name: "Hyggen från Skogsstyrelsen",
    done: (fresh: number, scrub: number, young: number, total: number) => `${fresh} färska, ${scrub} med sly och ${young} med ungskog av ${total} hyggen i rutan.`,
    none: "Inga hyggen i rutan med de här åldrarna.",
    failed: "Hyggena gick inte att hämta just nu."
  },
  borders: {
    label: "Beståndsgränser (416) ur lasern",
    levels: { none: "Inga", few: "Få", some: "Några", many: "Många" }
  }
};
