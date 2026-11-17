"use client";

import Link from "next/link";
import { organizerEn } from "../../i18n/organizer-en";
import { organizerSv } from "../../i18n/organizer-sv";
import { HelpLink } from "../help/help-panel";
import { useTexts } from "../language-provider";
import styles from "./organizer-hub.module.css";

/**
 * Översynen av navet 2026-11-17: fyra val överst i Mitt O-Tid med en rad förklaring var – kartprojekten, Lägg banor (öppnar
 * panelen under valen), formuläret Skapa träning eller tävling och klubbytan. Under valen hjälpartikeln för den som är ny.
 */
export function HubChoices({ clubHref, courseOpen, onCourse, onCreate }: {
  clubHref: string; courseOpen: boolean; onCourse: () => void; onCreate: () => void }) {
  const text = useTexts(organizerSv, organizerEn).hub;
  // Valets namn är bara rubriken; förklaringen är beskrivning (så att andra knappar och länkar på sidan inte får fler träffar).
  const body = (choice: { title: string; help: string }) => <>
    <strong className={styles.choiceTitle}>{choice.title}</strong><span className={styles.choiceHelp} aria-hidden="true">{choice.help}</span></>;
  const named = (key: "map" | "course" | "create" | "club") => ({ "aria-label": text[key].title, "aria-description": text[key].help });
  return <nav className={styles.choices} aria-label={text.label} data-testid="hub-choices">
    <ul>
      <li><Link className={styles.choice} href="/organizer/map-projects" data-testid="hub-map" {...named("map")}>{body(text.map)}</Link></li>
      <li><button type="button" className={styles.choice} aria-expanded={courseOpen} aria-controls="lagg-banor" onClick={onCourse}
        data-testid="hub-course" {...named("course")}>{body(text.course)}</button></li>
      <li><a className={styles.choice} href="#organizer-create-event" onClick={onCreate} data-testid="hub-create" {...named("create")}>{body(text.create)}</a></li>
      <li><Link className={styles.choice} href={clubHref} data-testid="hub-club" {...named("club")}>{body(text.club)}</Link></li>
    </ul>
    <p className={styles.newHere}>{text.newHere} <span className={styles.helpLink}><HelpLink article="kom-igang-traning" label={text.gettingStarted} /></span></p>
  </nav>;
}
