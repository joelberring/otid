"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { newsListSchema, newsSaveResponseSchema, type NewsItem, type NewsList } from "@o-tid/contracts";
import { newsEn } from "../../i18n/news-en";
import { newsSv } from "../../i18n/news-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { prepareNewsImage, type NewsImageUpload } from "../../lib/news-image";
import { useLocale, useTexts } from "../language-provider";
import { Button, Field, Hint, Notice, Section } from "../ui";
import styles from "./news.module.css";

type Draft = { newsId?: string; title: string; body: string; link: string; hidden: boolean; image: NewsImageUpload | null | undefined;
  hasImage: boolean };
const EMPTY: Draft = { title: "", body: "", link: "", hidden: false, image: undefined, hasImage: false };

/**
 * ADR-0230: skriva, ändra, dölja och ta bort nyheter. På /superadmin (`base` = /api/superadmin/news: allmänna nyheter och
 * moderering av klubbarnas) och på klubbytan (klubbens nyheter; medlemmar ser bara listan). Servern prövar behörigheten.
 */
export function NewsEditor({ base, scope }: { base: string; scope: "superadmin" | "club" }) {
  const text = useTexts(newsSv, newsEn).editor;
  const locale = useLocale();
  const [list, setList] = useState<NewsList>();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const requestId = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await clubRequest(base);
    const parsed = newsListSchema.safeParse(response.json);
    if (response.status === 200 && parsed.success) setList(parsed.data);
    else setMessage({ tone: "error", text: response.status === 403 ? text.forbidden : text.failed });
  }, [base, text]);
  useEffect(() => { void load(); }, [load]);

  const failed = (status: number) => setMessage({ tone: "error", text: status === 400 ? text.invalid : status === 403 ? text.forbidden : text.failed });

  async function choose(selected: File | undefined) {
    if (!selected) return;
    const prepared = await prepareNewsImage(selected);
    if (typeof prepared === "string") {
      setMessage({ tone: "error", text: prepared === "too-large" ? text.imageTooLarge : text.imageFailed });
      if (file.current) file.current.value = "";
      return;
    }
    setMessage(undefined);
    setDraft(current => ({ ...current, image: prepared }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const body = { formatVersion: 1, requestId: requestId.current, title: draft.title, body: draft.body, link: draft.link, hidden: draft.hidden,
        ...(draft.image !== undefined ? { image: draft.image } : {}) };
      const response = await clubRequest(draft.newsId ? `${base}/${draft.newsId}` : base, draft.newsId ? "PUT" : "POST", body);
      if (!newsSaveResponseSchema.safeParse(response.json).success) { failed(response.status); return; }
      requestId.current = crypto.randomUUID();
      setDraft(EMPTY);
      if (file.current) file.current.value = "";
      setMessage({ tone: "ok", text: text.saved });
      await load();
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }

  async function toggle(item: NewsItem) {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await clubRequest(`${base}/${item.newsId}`, "PUT", { formatVersion: 1, requestId: crypto.randomUUID(), title: item.title,
        body: item.body, link: item.link ?? "", hidden: !item.hidden });
      if (response.status !== 200) { failed(response.status); return; }
      await load();
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }

  async function remove(item: NewsItem) {
    if (!window.confirm(text.confirmRemove(item.title))) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await clubRequest(`${base}/${item.newsId}`, "DELETE");
      if (response.status !== 200) { failed(response.status); return; }
      if (draft.newsId === item.newsId) setDraft(EMPTY);
      setMessage({ tone: "ok", text: text.removed });
      await load();
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }

  const edit = (item: NewsItem) => {
    setDraft({ newsId: item.newsId, title: item.title, body: item.body, link: item.link ?? "", hidden: item.hidden, image: undefined,
      hasImage: item.imageUrl !== null });
    setMessage(undefined);
    form.current?.scrollIntoView({ block: "start" });
  };
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const canWrite = list?.canWrite ?? false;
  const title = scope === "superadmin" ? text.generalTitle : text.clubTitle;
  const help = scope === "superadmin" ? text.generalHelp : canWrite ? text.clubHelp : text.clubReadHelp;

  return <Section id="nyheter" title={title} help={help}>
    {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
    {!list && !message && <p role="status">{text.loading}</p>}
    {canWrite && <form ref={form} className={styles.form} onSubmit={event => void submit(event)} noValidate aria-label={draft.newsId ? text.editItem : text.newItem}
      data-testid="news-form">
      <h3>{draft.newsId ? text.editItem : text.newItem}</h3>
      <Field label={text.heading}><input value={draft.title} maxLength={120} required onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
      <Field label={text.body}><textarea value={draft.body} maxLength={400} rows={3} onChange={event => setDraft({ ...draft, body: event.target.value })} /></Field>
      <Field label={text.link} help={text.linkHelp}><input value={draft.link} maxLength={500} inputMode="url" autoComplete="off"
        onChange={event => setDraft({ ...draft, link: event.target.value })} /></Field>
      <Field label={text.image} help={text.imageHelp}><input ref={file} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={event => void choose(event.target.files?.[0])} /></Field>
      {draft.image && <img className={styles.preview} src={`data:${draft.image.mediaType};base64,${draft.image.base64}`} alt="" />}
      {draft.newsId && draft.hasImage && draft.image === undefined && <Hint>{text.keepImage}{" "}
        <Button variant="quiet" onClick={() => setDraft({ ...draft, image: null })}>{text.removeImage}</Button></Hint>}
      <label className={styles.check}><input type="checkbox" checked={draft.hidden} onChange={event => setDraft({ ...draft, hidden: event.target.checked })} />
        {text.hidden}</label>
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || draft.title.trim() === ""}>{draft.newsId ? text.save : text.publish}</Button>
        {draft.newsId && <Button variant="secondary" disabled={busy} onClick={() => { setDraft(EMPTY); if (file.current) file.current.value = ""; }}>{text.cancel}</Button>}
      </div>
    </form>}
    {list && (list.items.length === 0 ? <p className={styles.muted}>{text.empty}</p> : <ul className={styles.list} aria-label={title}>
      {list.items.map(item => <li key={item.newsId} className={styles.row}>
        <span className={styles.date}>{date(item.publishedAt)}</span>
        <div className={styles.main}>
          <strong>{item.title}</strong>
          {item.body && <span>{item.body}</span>}
          <span className={styles.meta}>{[scope === "superadmin" ? item.clubName ?? text.general : null, item.link, item.hidden ? text.hiddenBadge : null]
            .filter(Boolean).join(" · ")}</span>
        </div>
        {canWrite && <div className={styles.rowActions}>
          <Button variant="quiet" disabled={busy} aria-label={`${text.edit} ${item.title}`} onClick={() => edit(item)}>{text.edit}</Button>
          <Button variant="quiet" disabled={busy} aria-label={`${item.hidden ? text.show : text.hide} ${item.title}`} onClick={() => void toggle(item)}>
            {item.hidden ? text.show : text.hide}</Button>
          <Button variant="quiet" disabled={busy} aria-label={`${text.remove} ${item.title}`} onClick={() => void remove(item)}>{text.remove}</Button>
        </div>}
      </li>)}
    </ul>)}
  </Section>;
}
