"use client";

import Link from "next/link";
import { trainingGroupEn } from "../i18n/training-group-en";
import { clubArchiveEn } from "../i18n/club-archive-en";
import { mapProjectEn } from "../i18n/map-project-en";
import { useTexts } from "./language-provider";
import { useEffect, useState } from "react";
import type { ClubSummary, GroupSummary, MapProjectSummary } from "@o-tid/contracts";
import { myPlacesSv } from "../i18n/my-places-sv";
import { myPlacesEn } from "../i18n/my-places-en";
import { clubArchiveSv } from "../i18n/club-archive-sv";
import { mapProjectSv } from "../i18n/map-project-sv";
import { trainingGroupSv } from "../i18n/training-group-sv";
import { clubRequest } from "../lib/club-archive-client";
import { groupRequest } from "../lib/training-group-client";
import { NewClubForm } from "./club-archive/my-clubs";
import { NewGroupForm } from "./training-group/my-groups";
import styles from "./my-places-strip.module.css";

/**
 * Ägaren 2026-11-04: Mina klubbar (klubbytorna med arkivet, ADR-0194) och Mina grupper (träningsgrupperna, steg 68) som en
 * remsa överst i Mina tävlingar, före tävlingarna: ett kort per klubbyta och grupp med namn, roll och antal, och en direktlänk.
 * Ägare och administratörer ser hur många som väntar på bekräftelse. "Ny klubbyta" och "Ny grupp" är små åtgärder i remsan.
 * Ankarna `#mina-klubbar` och `#mina-grupper` nås från kontomenyn på alla sidor.
 */
export function MyPlacesStrip({ onClubs, clubQuestionShown = false }: {
  /** Klubbytorna när de har lästs in (organizer-workspace döljer klubbfrågan för den som redan är med i en). */
  onClubs?: (clubs: readonly ClubSummary[]) => void;
  /** Användartest 2026-11-12: "Välj din klubb under Mitt konto" visas inte när klubbfrågan står ovanför. */
  clubQuestionShown?: boolean } = {}) {
  const text = useTexts(myPlacesSv, myPlacesEn);
  const trainingGroupText = useTexts(trainingGroupSv, trainingGroupEn);
  const clubArchiveText = useTexts(clubArchiveSv, clubArchiveEn);
  const mapProjectText = useTexts(mapProjectSv, mapProjectEn);
  const [clubs, setClubs] = useState<ClubSummary[]>();
  const [groups, setGroups] = useState<GroupSummary[]>();
  const [creating, setCreating] = useState<"club" | "group">();
  const [projects, setProjects] = useState<MapProjectSummary[]>([]);

  useEffect(() => {
    let active = true;
    void clubRequest("/api/organizer/clubs").then(result => {
      if (!active) return;
      const list = result.status === 200 ? (result.json as { clubs: ClubSummary[] }).clubs : [];
      setClubs(list); onClubs?.(list);
    });
    void groupRequest("/api/organizer/groups").then(result => {
      if (active) setGroups(result.status === 200 ? (result.json as { groups: GroupSummary[] }).groups : []);
    });
    // ADR-0219: kartprojekten visas bara för den som är med i något.
    void clubRequest("/api/organizer/map-projects").then(result => {
      if (active && result.status === 200) setProjects((result.json as { projects: MapProjectSummary[] }).projects);
    });
    return () => { active = false; };
  }, []);

  // Kontomenyns länk till ett ankare här: rulla dit när listorna har kommit (sidan ritas först utan dem).
  useEffect(() => {
    if (!clubs || !groups) return;
    const id = window.location.hash.slice(1);
    if (id === "mina-klubbar" || id === "mina-grupper") document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [clubs !== undefined && groups !== undefined]);

  const loaded = clubs !== undefined && groups !== undefined;
  const none = loaded && clubs.length === 0 && groups.length === 0;
  const toggle = (kind: "club" | "group") => setCreating(current => current === kind ? undefined : kind);
  return <div className={styles.strip} aria-label={text.label} role="group" data-testid="my-places">
    {none && !clubQuestionShown && <p className={styles.none}>{text.noneAtAll} <Link href="/konto#konto-klubbar">{text.noneAtAllLink}</Link></p>}
    <section id="mina-klubbar" className={styles.place} aria-labelledby="my-clubs-heading">
      <h2 id="my-clubs-heading">{text.clubs}</h2>
      <NewClubForm open={creating === "club"} onToggle={() => toggle("club")} />
      {clubs && clubs.length > 0 && <ul className={styles.chips}>
        {clubs.map(club => <li key={club.clubId}>
          <Link className={styles.chip} href={`/organizer/clubs/${encodeURIComponent(club.clubId)}`}>
            <strong>{club.name}</strong>
            <span>{clubArchiveText.roles[club.role]} · {clubArchiveText.myClubs.entries(club.entries)}</span>
            {(club.pending ?? 0) > 0 && <span className={styles.badge}>{text.pending(club.pending!)}</span>}
          </Link>
        </li>)}
      </ul>}
      {clubs && clubs.length === 0 && !none && <p className={styles.empty}>{text.noClubs}</p>}
    </section>
    <section id="mina-grupper" className={styles.place} aria-labelledby="my-groups-heading">
      <h2 id="my-groups-heading">{text.groups}</h2>
      <NewGroupForm open={creating === "group"} onToggle={() => toggle("group")} />
      {groups && groups.length > 0 && <ul className={styles.chips}>
        {groups.map(group => <li key={group.groupId}>
          <Link className={styles.chip} href={group.role === "LEADER" ? `/organizer/groups/${encodeURIComponent(group.groupId)}` : `/g/${group.code}`}>
            <strong>{group.name}</strong>
            <span>{trainingGroupText.myGroups.role[group.role]} · {trainingGroupText.myGroups.sessions(group.sessions)}</span>
          </Link>
        </li>)}
      </ul>}
      {groups && groups.length === 0 && !none && <p className={styles.empty}>{text.noGroups}</p>}
    </section>
    {/* Kartritningen syns alltid, också utan projekt (ägaren 2026-11-08: den var svår att hitta). */}
    <section id="mina-kartprojekt" className={styles.place} aria-labelledby="my-map-projects-heading">
      <h2 id="my-map-projects-heading"><Link href="/organizer/map-projects">{mapProjectText.list.title}</Link></h2>
      {projects.length === 0 && <p className={styles.empty}>{text.noMapProjects}{" "}
        <Link href="/organizer/map-projects#nytt-kartprojekt" data-testid="my-places-new-map-project">{text.newMapProject}</Link></p>}
      {projects.length > 0 && <ul className={styles.chips}>
        {projects.map(project => <li key={project.projectId}>
          <Link className={styles.chip} href={`/organizer/map-projects/${encodeURIComponent(project.projectId)}`}>
            <strong>{project.name}</strong>
            <span>{mapProjectText.roles[project.role]} · {mapProjectText.list.changed(project.changedObjects)}</span>
          </Link>
        </li>)}
      </ul>}
    </section>
    {!loaded && <p className={styles.none} role="status">{text.loading}</p>}
  </div>;
}
