import type { Texts } from "../lib/language";
import type { courseSettingMapProjectSv } from "./course-setting-map-project-sv";

/** Engelska: banläggningens karta ur ett kartprojekt. */
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const courseSettingMapProjectEn: Texts<typeof courseSettingMapProjectSv> = {
  picker: {
    heading: "Map project",
    help: "Choose one of your map projects. Course setting gets the map as it is now (the base file with the applied changes) and stays on that version until you choose ”Take in the map's changes”.",
    open: "Choose map project",
    close: "Close the list",
    use: "Use",
    useProject: (name: string) => `Use the map project ${name}`,
    changes: (count: number) => count === 0 ? "No changes yet" : count === 1 ? "1 changed object" : `${count} changed objects`,
    club: (name: string) => `Club: ${name}`,
    closed: "Closed",
    saved: (name: string) => `The map from the map project ${name} is saved.`,
    loadFailed: "The map projects could not be loaded."
  },
  working: {
    reading: "Fetching the map from the map project …",
    drawing: "Drawing the map …",
    saving: "Saving the map …"
  },
  errors: {
    refused: "The map project's map cannot be written as a map file right now (for example an OCAD map with changes). Create a new map version in the map project and upload it as the map file instead.",
    changed: "The map changed while it was being fetched. Try again.",
    forbidden: "You need to be an administrator of the event and a member of the map project.",
    tooLarge: "The map is too large to be saved as the event's map file.",
    quota: "The quota for maps is full.",
    failed: "The map could not be fetched from the map project. Try again."
  },
  panel: {
    heading: "The map",
    from: (name: string) => `The map comes from the map project ${name}.`,
    version: (seq: number, iso: string) => `Map version ${seq}, fetched ${when(iso)}. The map under the courses does not change until you take in the map's changes.`,
    newer: (count: number) => count === 1 ? "The map has 1 newer change" : `The map has ${count} newer changes`,
    upToDate: "The map has no newer changes.",
    update: "Take in the map's changes",
    confirm: "The map under the courses is replaced by the map project's current map. The courses and controls are not changed: check afterwards that they are in the right place on the new map. Maps that are already printed show the old map.",
    confirmUpdate: "Take in the changes",
    cancel: "Cancel",
    openProject: "Open the map project",
    notAllowed: "An administrator of the event who is a member of the map project can take in the changes.",
    updated: (seq: number) => `The map's changes are taken in (map version ${seq}).`,
    toast: (count: number, name: string) => `${count === 1 ? "The map has 1 newer change" : `The map has ${count} newer changes`} in the map project ${name}. Take them in under Settings → The map.`
  }
};
