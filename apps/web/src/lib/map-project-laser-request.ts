import { GEO_JOB_DEFAULTS, type GeoClip, type GeoExtraKind } from "@o-tid/contracts";
import { choiceSettings, DEFAULT_CHOICES, type CliffStyle, type LaserChoices } from "./map-project-laser-choices";

/** En laserruta och en av Lantmäteriets vektorprodukter som sökningen gav. */
export interface LaserItem { id: string; datetime: string | null; href: string; bbox: [number, number, number, number] | null; bytes: number | null; epsg: number | null }
export interface LaserExtra { kind: GeoExtraKind; id: string; href: string }

/**
 * Laserformulärets förval, på ett ställe: laserpanelen börjar med dem och guiden «Ny grundkarta» kör med dem. Ägaren
 * 2026-11-11: fuktigheten och vegetationen är förvalda, så att kärr och grönt alltid kommer med i grundkartan.
 */
export const LASER_FORM_DEFAULTS: { readonly interval: number; readonly formline: number; readonly choices: LaserChoices; readonly cliffStyle: CliffStyle;
  readonly cliffTags: boolean; readonly moisture: boolean; readonly channelHa: number; readonly wetMeters: number; readonly vegetation: boolean; readonly minAreaM2: number } = {
  interval: GEO_JOB_DEFAULTS.contourInterval, formline: GEO_JOB_DEFAULTS.formline, choices: DEFAULT_CHOICES, cliffStyle: "few", cliffTags: false,
  moisture: true, channelHa: GEO_JOB_DEFAULTS.channelHa, wetMeters: GEO_JOB_DEFAULTS.wetMeters, vegetation: true, minAreaM2: GEO_JOB_DEFAULTS.minAreaM2
};

/**
 * Sprintkartans ekvidistans (ägaren 2026-11-13): ISSprOM 2019-2 har 2 eller 2,5 m. Förvalet är 2,5 m, hälften av
 * skogskartans 5 m, så att kurvorna stämmer med grannkartornas; 2 m går att välja i laserpanelen.
 */
const SPRINT_CONTOUR_INTERVAL = 2.5;
/** Ekvidistanserna som laserpanelen erbjuder. */
export const laserIntervals = (sprint: boolean): readonly number[] => sprint ? [2, 2.5, 5] : [2.5, 5];
/** Förvald ekvidistans för kartan. */
export const defaultLaserInterval = (sprint: boolean): number => sprint ? SPRINT_CONTOUR_INTERVAL : LASER_FORM_DEFAULTS.interval;

/**
 * Sprintkartor får belagd yta ur laserns intensitet (ägaren 2026-11-13, geo-arbetarens `belagt.dxf`): inställningen `paved`
 * sätts som förval när kartans norm är en sprintnorm. En inställning som skrivits för hand går före.
 */
const pavedSetting = (sprint: boolean | undefined): { paved?: 1 } => sprint ? { paved: 1 } : {};

export interface LaserJobInput {
  readonly name: string; readonly interval: number; readonly formline: number;
  /** Kartan är en sprintkarta: belagd yta ur lasern tas med. */
  readonly sprint?: boolean | undefined;
  /** Valen som värden (`choiceSettings`): inställningarna och branternas trösklar. */
  readonly chosen: ReturnType<typeof choiceSettings>;
  readonly moisture?: { readonly channelHa: number; readonly wetMeters: number } | undefined;
  readonly vegetation?: { readonly minAreaM2: number } | undefined;
  /** Kör om: rutorna, området och Lantmäteriets produkter tas från jobbet; annars de valda rutorna och kartans område. */
  readonly target: { readonly rerunOf: string; readonly clip?: GeoClip | undefined }
    | { readonly tiles: readonly LaserItem[]; readonly clip?: GeoClip | undefined; readonly areaId?: string | undefined; readonly extras: readonly LaserExtra[] };
}

/** Begäran som startar en körning (POST geo-jobs), utan `requestId`. Samma för laserpanelen och guiden. */
export function laserJobBody(input: LaserJobInput) {
  const { target } = input;
  return { formatVersion: 1, kind: "PULLAUTIN", name: input.name, settings: { contour_interval: input.interval, formline: input.formline, ...pavedSetting(input.sprint), ...input.chosen.settings },
    ...(input.chosen.cliffs ? { cliffs: input.chosen.cliffs } : {}),
    ...("rerunOf" in target ? { rerunOf: target.rerunOf, ...(target.clip ? { clip: target.clip } : {}) } : {
      tiles: target.tiles.map(item => ({ id: item.id, href: item.href, bbox: item.bbox, epsg: item.epsg, datetime: item.datetime })),
      // Grundkartan G1: bara kartans område (eller etappen) med marginal bearbetas.
      ...(target.clip ? { clip: target.clip } : {}), ...(target.areaId ? { areaId: target.areaId } : {}),
      ...(target.clip && target.extras.length > 0 ? { extras: target.extras } : {}) }),
    ...(input.moisture ? { moisture: { channelHa: input.moisture.channelHa, wetMeters: input.moisture.wetMeters, moistMeters: input.moisture.wetMeters * 2 } } : {}),
    ...(input.vegetation ? { vegetation: { minAreaM2: input.vegetation.minAreaM2 } } : {}) } as const;
}

/** Körningen med förvalen (guiden): alla hittade produkter, förvalda inställningar, fuktighet och vegetation; `sprint` ger sprintkartans ekvidistans och belagd yta ur lasern. */
export function defaultLaserJob(name: string, target: Extract<LaserJobInput["target"], { tiles: unknown }>, sprint = false) {
  const d = LASER_FORM_DEFAULTS;
  return laserJobBody({ name, interval: defaultLaserInterval(sprint), formline: d.formline, sprint, chosen: choiceSettings(d.choices, {}, d.cliffStyle, d.cliffTags),
    moisture: d.moisture ? { channelHa: d.channelHa, wetMeters: d.wetMeters } : undefined,
    vegetation: d.vegetation ? { minAreaM2: d.minAreaM2 } : undefined, target });
}
