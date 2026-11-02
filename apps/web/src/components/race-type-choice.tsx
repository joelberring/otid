"use client";

import { normalizeRaceType, selectableRaceTypes, type RaceType } from "@o-tid/contracts";
import { raceTypeSv as text } from "../i18n/race-type-sv";
import styles from "./race-type-choice.module.css";

/**
 * ADR-0170 beslut 1: tävlingstyperna som ett tydligt val med en rad förklaring var. ADR-0188 beslut 5: utan "Tävling med
 * gafflade banor" (gaffling följer av banorna); en äldre tävling av den typen visas som Tävling.
 * Används när tävlingen skapas och under Inställningar. Antingen styrd (`value`) eller fri (`defaultValue`, för FormData).
 */
export function RaceTypeChoice({ name = "raceType", value, defaultValue, onChange, disabled }: {
  name?: string; value?: RaceType; defaultValue?: RaceType; onChange?: (type: RaceType) => void; disabled?: boolean;
}) {
  return <fieldset className={styles.choice} disabled={disabled}>
    <legend>{text.typeLegend}</legend>
    {selectableRaceTypes.map(type => <label key={type} className={styles.option}>
      <input type="radio" name={name} value={type} aria-label={text.types[type].name} aria-describedby={`${name}-${type}-help`} {...(value === undefined
        ? { defaultChecked: normalizeRaceType(defaultValue ?? "STANDARD") === type } : { checked: normalizeRaceType(value) === type })}
        onChange={() => onChange?.(type)} />
      <span className={styles.name}>{text.types[type].name}</span>
      <span className={styles.help} id={`${name}-${type}-help`}>{text.types[type].help}</span>
    </label>)}
  </fieldset>;
}
