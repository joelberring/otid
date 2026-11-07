"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MapProjectList } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectFailure, mapProjectsBase } from "../../lib/map-project-client";
import { AccountMenu } from "../account-menu";
import { Notice } from "../ui";
import styles from "./map-project.module.css";

const text = mapProjectSv.list;

/** ADR-0219: kontots kartprojekt (som medlem eller som administratör i projektets klubb). */
export function MyMapProjects() {
  const [list, setList] = useState<MapProjectList>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    void clubRequest(mapProjectsBase).then(result => {
      if (result.status === 200) setList(result.json as MapProjectList);
      else setProblem(mapProjectFailure(result.status));
    });
  }, []);
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}><Link href="/organizer">Mina tävlingar</Link></p><h1>{text.title}</h1></div>
      <AccountMenu />
    </header>
    <p className={styles.muted}>{text.hint}</p>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    {list && list.projects.length === 0 && <p className={styles.muted}>{text.empty}</p>}
    {list && list.projects.length > 0 && <ul className={styles.list} data-testid="map-projects">
      {list.projects.map(project => <li key={project.projectId}>
        <div><Link href={`/organizer/map-projects/${project.projectId}`}>{project.name}</Link>
          <span>{[project.club.name, project.base.fileName, mapProjectSv.roles[project.role], text.changed(project.changedObjects),
            project.status === "CLOSED" ? text.closed : ""].filter(Boolean).join(" · ")}</span></div>
      </li>)}
    </ul>}
  </main>;
}
