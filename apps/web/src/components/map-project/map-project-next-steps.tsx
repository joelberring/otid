"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { MapProjectView } from "@o-tid/contracts";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { MAP_PROJECT_STEPS, mapProjectSteps, type MapProjectStep } from "../../lib/map-project-next-steps";
import { useTexts } from "../language-provider";
import start from "../club-archive/club-start.module.css";
import styles from "./map-project.module.css";

/**
 * Översynen 2026-11-17: «Nästa steg» på kartprojektets sida – underlaget, ritandet, kontroll och export, och banorna – i klubbytans «Kom igång»-form
 * (samma lista och bockar, utan kortets ram). Bara nästa steg har en knapp, så att sidan förblir lugn.
 */
export function MapProjectNextSteps({ view }: { view: MapProjectView }) {
  const text = useTexts(mapProjectSv.nextSteps, mapProjectEn.nextSteps);
  const status = mapProjectSteps(view);
  const mapHref = `/organizer/map-projects/${encodeURIComponent(view.projectId)}/map`;
  const help: Record<MapProjectStep, string> = {
    base: view.base.source === "NEW" ? text.base.help : text.base.existing(view.base.fileName),
    draw: text.draw.help,
    export: text.export.help,
    courses: text.courses.help
  };
  const action: Record<MapProjectStep, ReactNode> = {
    base: <Link className={styles.primaryLink} href={mapHref}>{text.openMap}</Link>,
    draw: <Link className={styles.primaryLink} href={mapHref}>{text.openMap}</Link>,
    export: <a className={styles.primaryLink} href="#exportera">{text.export.action}</a>,
    courses: <Link className={styles.primaryLink} href="/organizer">{text.courses.action}</Link>
  };
  return <section aria-labelledby="map-project-next" data-testid="map-project-next">
    <h2 id="map-project-next">{text.title}</h2>
    <ol className={`${start.steps} ${styles.nextSteps}`}>
      {MAP_PROJECT_STEPS.map((step, index) => {
        const done = status.done[step];
        const next = status.next === step;
        return <li key={step} className={start.step} data-testid={`map-project-step-${step}`} data-done={done} data-next={next}>
          <span className={start.mark} aria-hidden="true">{done ? "✓" : index + 1}</span>
          <div className={start.stepBody}>
            <h3>{text[step].title}<span className={start.state}>
              {done ? step === "draw" ? text.started : text.done : next ? text.next : text.later}</span></h3>
            <p className={start.small}>{help[step]}</p>
            {next && <div className={start.actions}>{action[step]}</div>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
