"use client";

import { TRAINING_LEVELS, TRAINING_MOMENTS, orderedLevels, orderedMoments, type TrainingLevel, type TrainingMoment } from "@o-tid/contracts";
import { trainingMomentsEn } from "../../i18n/training-moments-en";
import { trainingMomentsSv } from "../../i18n/training-moments-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import styles from "./moments.module.css";

const toggle = <T extends string>(list: readonly T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];

/** En rad knappar som slås på och av (`aria-pressed`). */
export function Chips<T extends string>({ legend, help, options, chosen, name, onChange, dots }: {
  legend: string; help?: string; options: readonly T[]; chosen: readonly T[]; name: (value: T) => string; onChange: (next: T[]) => void;
  dots?: boolean;
}) {
  return <fieldset className={styles.group}>
    <legend>{legend}</legend>
    {help && <p className={styles.help}>{help}</p>}
    <div className={styles.chips}>
      {options.map(option => <button key={option} type="button" className={styles.chip} aria-pressed={chosen.includes(option)}
        onClick={() => onChange(toggle(chosen, option))}>
        {dots && <span className={styles.dot} data-level={option} aria-hidden="true" />}{name(option)}</button>)}
    </div>
  </fieldset>;
}

/**
 * ADR-0222: momenten (fasta), nivåerna (Grön–Svart, med förslaget ur banorna) och egna ord, för terminsplaneringen och
 * träningen i klubbarkivet.
 */
export function MomentPicker({ moments, levels, tags, suggestedLevels, onChange }: {
  moments: readonly TrainingMoment[]; levels: readonly TrainingLevel[]; tags: string;
  suggestedLevels?: readonly TrainingLevel[] | undefined;
  onChange: (change: { moments?: TrainingMoment[]; levels?: TrainingLevel[]; tags?: string }) => void;
}) {
  const text = useTexts(trainingMomentsSv, trainingMomentsEn);
  const suggestion = orderedLevels(suggestedLevels ?? []);
  const differs = suggestion.length > 0 && suggestion.join() !== orderedLevels(levels).join();
  return <>
    <Chips legend={text.moments} help={text.momentsHelp} options={TRAINING_MOMENTS} chosen={moments} name={moment => text.momentNames[moment]}
      onChange={next => onChange({ moments: orderedMoments(next) })} />
    <Chips legend={text.levels} help={text.levelsHelp} options={TRAINING_LEVELS} chosen={levels} name={level => text.levelNames[level]} dots
      onChange={next => onChange({ levels: orderedLevels(next) })} />
    {differs && <p className={styles.suggestion} data-testid="level-suggestion">
      <span>{text.suggested(suggestion.map(level => text.levelNames[level]).join(", "))}</span>
      <Button variant="quiet" onClick={() => onChange({ levels: suggestion })}>{text.useSuggested}</Button>
    </p>}
    <label className={styles.group}><span>{text.tags}</span>
      <input value={tags} maxLength={600} onChange={event => onChange({ tags: event.target.value })} />
      <span className={styles.help}>{text.tagsHelp}</span></label>
  </>;
}

/** Egna ord ur fältet: skilda med komma, utan dubbletter, högst 30 och 40 tecken. */
export const tagsFromText = (value: string) => [...new Set(value.split(",").map(tag => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 30);

/** Momenten, nivåerna (med färgen) och de egna orden som märken. */
export function MomentBadges({ moments, levels, tags = [] }: { moments: readonly TrainingMoment[]; levels: readonly TrainingLevel[]; tags?: readonly string[] }) {
  const text = useTexts(trainingMomentsSv, trainingMomentsEn);
  if (moments.length + levels.length + tags.length === 0) return null;
  return <ul className={styles.badges} data-testid="moment-badges">
    {levels.map(level => <li key={level} className={styles.badge}><span className={styles.dot} data-level={level} aria-hidden="true" />{text.levelNames[level]}</li>)}
    {moments.map(moment => <li key={moment} className={styles.badge}>{text.momentNames[moment]}</li>)}
    {tags.map(tag => <li key={tag} className={styles.badge}>{tag}</li>)}
  </ul>;
}
