import type { Texts } from "../lib/language";
import type { myPlacesSv } from "./my-places-sv";

/** Engelska för remsan överst i Mina tävlingar (klubbytor, träningsgrupper och kartprojekt). */
export const myPlacesEn: Texts<typeof myPlacesSv> = {
  label: "My clubs and groups",
  clubs: "My clubs",
  groups: "My groups",
  noneAtAll: "Choose your club under",
  noneAtAllLink: "My account",
  noClubs: "You are not in any club yet.",
  noGroups: "You are not in any group yet.",
  noMapProjects: "Draw and revise maps together, on the computer and on your phone in the forest.",
  newMapProject: "New map project",
  pending: (count: number) => `${count} awaiting confirmation`,
  loading: "Loading clubs and groups …"
};
