"use client";

import React from "react";
import { listsSv } from "../i18n/lists-sv";
import styles from "./follow-star.module.css";

const text = listsSv.follow;

/** Följ eller sluta följa (PLAN.md steg 30). `name` är löparens eller klubbens namn och ingår i knappens namn. */
export function FollowStar({ name, followed, onToggle, compact = false }: { name: string; followed: boolean; onToggle: () => void; compact?: boolean }) {
  const label = followed ? text.unfollow(name) : text.follow(name);
  return <button type="button" className={compact ? `${styles.star} ${styles.compact}` : styles.star} data-followed={followed ? "true" : undefined} aria-label={label}
    title={label} onClick={onToggle}><span aria-hidden="true">{followed ? "★" : "☆"}</span></button>;
}
