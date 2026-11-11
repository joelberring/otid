import type { Texts } from "../lib/language";
import type { mapForestSv } from "./map-forest-sv";

/** English: the Swedish Forest Agency's layers, clear-cuts by age and stand boundaries in the map project. */
export const mapForestEn: Texts<typeof mapForestSv> = {
  images: {
    heading: "Swedish Forest Agency (base layers)",
    help: "The Swedish Forest Agency's open maps for the whole map or a stage, as base layers to show, hide and fade under Layers.",
    products: { CLEAR_CUTS: "Completed fellings (clear-cuts)", NOTIFIED: "Felling notifications", KEY_BIOTOPES: "Woodland key habitats", TREE_HEIGHT: "Tree height from laser data" },
    fetch: "Fetch as base layers",
    fetching: "Fetching from the Swedish Forest Agency …",
    name: (product: string, area?: string) => `Skogsstyrelsen ${product} ${area ?? "whole map"}`.slice(0, 80),
    added: (count: number) => count === 1 ? "1 base layer is added." : `${count} base layers are added.`,
    attribution: "© Swedish Forest Agency."
  },
  cuts: {
    heading: "Clear-cuts with sliders",
    help: "The Swedish Forest Agency's completed fellings (from 0.5 ha) are grouped by age. Drag the ages: the candidates on the map are recalculated at once.",
    fetch: "Fetch clear-cuts",
    fetching: "Fetching clear-cuts …",
    fresh: (years: number) => `Fresh clear-cut (403) younger than ${years} years`,
    scrub: (years: number) => `Scrub (407) up to ${years} years`,
    young: (years: number) => `Young forest (406) up to ${years} years`,
    borders: "The clear-cut's edge as a vegetation boundary (416)",
    name: "Clear-cuts from the Swedish Forest Agency",
    done: (fresh: number, scrub: number, young: number, total: number) => `${fresh} fresh, ${scrub} with scrub and ${young} with young forest of ${total} clear-cuts in the area.`,
    none: "No clear-cuts in the area with these ages.",
    failed: "The clear-cuts could not be fetched right now."
  },
  borders: {
    label: "Stand boundaries (416) from the laser",
    levels: { none: "None", few: "Few", some: "Some", many: "Many" }
  }
};
