"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { homeSlidesEn } from "../../i18n/home-slides-en";
import { homeSlidesSv } from "../../i18n/home-slides-sv";
import { pickTexts, type Language } from "../../lib/language";
import { HOME_SLIDE_INTERVAL_MS, HOME_SLIDE_SIZE, HOME_SLIDES, homeSlideSrc, stepSlide, swipeStep } from "../../lib/home-slides";
import styles from "./start.module.css";

/**
 * Startsidans bildspel för den som inte är inloggad (ägaren 2026-11-24). En bild i taget med rubrik och en mening, Föregående,
 * Nästa och punkterna (i telefonen «3 av 9» i stället för punkterna), piltangenterna och svep. Bytet är direkt, utan övergång
 * (inga dekorativa animationer). Växlar själv var 5:e sekund men pausar vid hovring och fokus, stannar helt efter ett eget val
 * eller Pausa och startar aldrig med `prefers-reduced-motion`. Bara bilden som visas finns i sidan (den första laddas direkt,
 * nästa hämtas i förväg).
 */
export function HomeSlideshow({ language }: { language: Language }) {
  const text = pickTexts(language, homeSlidesSv, homeSlidesEn);
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [held, setHeld] = useState({ hover: false, focus: false });
  const [reduced, setReduced] = useState(true);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // Bilder som saknas på besökarens språk visas på svenska.
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const srcOf = (key: (typeof HOME_SLIDES)[number]) => homeSlideSrc(key, missing.has(key) ? "sv" : language);
  const running = !stopped && !reduced && !held.hover && !held.focus;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setIndex(current => stepSlide(current, 1)), HOME_SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  // Nästa bild hämtas i förväg, så att bytet blir direkt.
  const nextSrc = srcOf(HOME_SLIDES[stepSlide(index, 1)]!);
  useEffect(() => { new Image().src = nextSrc; }, [nextSrc]);

  const choose = (next: number) => { setStopped(true); setIndex(next); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); choose(stepSlide(index, -1)); }
    if (event.key === "ArrowRight") { event.preventDefault(); choose(stepSlide(index, 1)); }
  };
  const onPointerDown = (event: PointerEvent) => { if (event.pointerType !== "mouse") swipe.current = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const step = swipeStep(event.clientX - start.x, event.clientY - start.y);
    if (step !== 0) choose(stepSlide(index, step));
  };

  const slide = HOME_SLIDES[index]!;
  const current = text.slides[slide];
  return <section className={styles.slideshow} aria-roledescription="carousel" aria-label={text.label} data-testid="home-slideshow"
    data-slide={slide} data-running={running ? "true" : "false"} onKeyDown={onKeyDown}
    onMouseEnter={() => setHeld(value => ({ ...value, hover: true }))} onMouseLeave={() => setHeld(value => ({ ...value, hover: false }))}
    onFocus={() => setHeld(value => ({ ...value, focus: true }))}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(value => ({ ...value, focus: false })); }}>
    <div className={styles.slide} role="group" aria-roledescription="slide" aria-label={text.position(index + 1, HOME_SLIDES.length)}
      aria-live={running ? "off" : "polite"} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
      onPointerCancel={() => { swipe.current = null; }}>
      <a href={srcOf(slide)} className={styles.slideImage} title={text.enlarge} draggable={false}>
        <img key={srcOf(slide)} src={srcOf(slide)} width={HOME_SLIDE_SIZE.width} height={HOME_SLIDE_SIZE.height} alt={current.alt}
          loading={index === 0 ? "eager" : "lazy"} decoding="async" draggable={false}
          onError={() => { if (language !== "sv" && !missing.has(slide)) setMissing(value => new Set(value).add(slide)); }} />
      </a>
      <h2>{current.title}</h2>
      <p>{current.text}</p>
    </div>
    <div className={styles.slideControls}>
      <button type="button" className="secondary" onClick={() => choose(stepSlide(index, -1))} aria-label={text.previous}>‹</button>
      <ol className={styles.slideDots}>
        {HOME_SLIDES.map((key, position) => <li key={key}>
          <button type="button" onClick={() => choose(position)} aria-label={text.choose(position + 1, text.slides[key].title)}
            aria-current={position === index ? "true" : undefined} />
        </li>)}
      </ol>
      <span className={styles.slideCount} aria-hidden="true">{text.position(index + 1, HOME_SLIDES.length)}</span>
      <button type="button" className="secondary" onClick={() => choose(stepSlide(index, 1))} aria-label={text.next}>›</button>
      {!reduced && <button type="button" className={`secondary ${styles.slidePause}`} onClick={() => setStopped(value => !value)}>
        {stopped ? text.play : text.pause}</button>}
    </div>
  </section>;
}
