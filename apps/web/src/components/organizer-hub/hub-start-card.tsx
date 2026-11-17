"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { organizerEn } from "../../i18n/organizer-en";
import { organizerSv } from "../../i18n/organizer-sv";
import { hideHubStart, hubStartHidden } from "../../lib/hub-start";
import { HelpLink } from "../help/help-panel";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import styles from "../club-archive/club-start.module.css";
import hubStyles from "./organizer-hub.module.css";

type Step = "account" | "course" | "guide" | "club";
const STEPS: readonly Step[] = ["account", "course", "guide", "club"];

/**
 * Översynen av navet 2026-11-17: Kom igång i Mitt O-Tid för den som inte har någon tävling än, med samma mönster och stil som
 * klubbytans Kom igång (`ClubStartCard`): numrerade steg med Klart/Nästa steg och "Dölj" (sparat i webbläsaren). Kortet står i
 * listans tomläge (under "Inga tävlingar ännu") och försvinner när kontot har en tävling eller träning. Guiden räknas inte som klar (den är bara en länk).
 */
export function HubStartCard({ hasClub, onCourse }: { hasClub: boolean; onCourse: () => void }) {
  const text = useTexts(organizerSv, organizerEn).start;
  const hub = useTexts(organizerSv, organizerEn).hub;
  // Läses först efter första ritningen (lagringen finns inte på servern).
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(hubStartHidden()); }, []);
  if (hidden) return null;
  const done: Record<Step, boolean> = { account: true, course: false, guide: false, club: hasClub };
  const next = STEPS.find(step => !done[step]);
  const doneCount = STEPS.filter(step => done[step]).length;

  const step = (name: Step, actions: ReactNode) => <li key={name} className={styles.step} data-testid={`hub-start-${name}`}
    data-done={done[name]} data-next={next === name}>
    <span className={styles.mark} aria-hidden="true">{done[name] ? "✓" : STEPS.indexOf(name) + 1}</span>
    <div className={styles.stepBody}>
      <h3>{text[name].title}<span className={styles.state}>{done[name] ? text.done : next === name ? text.next : text.todo}</span></h3>
      <p className={styles.small}>{text[name].help}</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  </li>;

  return <section className={styles.card} aria-labelledby="hub-start-title" data-testid="hub-start">
    <div className={styles.head}>
      <div><h2 id="hub-start-title">{text.title}<span className={styles.progress}>{text.progress(doneCount, STEPS.length)}</span></h2></div>
      <Button variant="quiet" aria-label={text.hideLabel} onClick={() => { hideHubStart(); setHidden(true); }}>{text.hide}</Button>
    </div>
    <ol className={styles.steps}>
      {step("account", null)}
      {step("course", <Button onClick={onCourse}>{hub.course.title}</Button>)}
      {step("guide", <span className={hubStyles.helpLink}><HelpLink article="kom-igang-traning" label={hub.gettingStarted} /></span>)}
      {step("club", hasClub ? null : <Link className={styles.buttonLink} href="/konto#konto-klubbar">{text.club.action}</Link>)}
    </ol>
  </section>;
}
