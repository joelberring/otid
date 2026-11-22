import type { Texts } from "../lib/language";
import type { mapProjectRegenerableSv } from "./map-project-regenerable-sv";

/** PLAN.md step M4: base data removed from the store that can be regenerated, when the project is opened. */
export const mapProjectRegenerableEn: Texts<typeof mapProjectRegenerableSv> = {
  missing: (runs: number, layers: number, mb: number) => `${[runs > 0 ? `${runs} laser ${runs === 1 ? "run" : "runs"}` : "",
    layers > 0 ? `${layers} base ${layers === 1 ? "layer" : "layers"}` : ""].filter(Boolean).join(" and ")} (${mb} MB) were removed from the store to save space. `
    + "They can be regenerated: laser runs are run again with the same tiles and settings (not counted against the laser quota) and the images are fetched again from their source.",
  regenerate: "Regenerate",
  working: (done: number, total: number) => `Regenerating ${done} of ${total} …`,
  queued: (runs: number) => runs > 0 ? `Done. ${runs === 1 ? "The laser run is" : `${runs} laser runs are`} waiting for the geo server and will take over ${runs === 1 ? "its" : "their"} base layers when finished.` : "Done.",
  failed: (count: number) => `${count} could not be regenerated. Try again later.`,
  noCredential: "Add your Lantmäteriet details under My account to run laser runs again and fetch orthophotos.",
  busy: "You already have two laser runs waiting or running. Try again when one is done.",
  readOnly: "Anyone who can suggest or edit in the project can regenerate it.",
  overLimit: (projects: readonly string[]) => `You have a lot of base data in ${projects.join(" and ")}. Remove older runs or ask the superadmin for more.`,
  ok: "OK"
};
