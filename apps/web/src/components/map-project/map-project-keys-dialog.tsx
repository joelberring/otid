"use client";

import { useEffect, useId, useRef, useState } from "react";
import { mapProjectKeysEn } from "../../i18n/map-project-tools-en";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { bindingOf, DEFAULT_KEYS, isReserved, KEY_COMMANDS, keyLabel, KEYS_STORAGE, parseKeys, withBinding, type KeyCommand, type KeyMap } from "../../lib/map-project-keys";
import { useTexts } from "../language-provider";
import { Button, Dialog } from "../ui";
import styles from "./map-project-keys-dialog.module.css";

/** Ritlägets tangenter: förvalet tills webbläsarens sparade uppsättning är läst, och sparade vid varje ändring. */
export function useMapProjectKeys(): [KeyMap, (keys: KeyMap) => void] {
  const [keys, setKeys] = useState<KeyMap>(DEFAULT_KEYS);
  useEffect(() => { try { setKeys(parseKeys(localStorage.getItem(KEYS_STORAGE))); } catch { /* utan lagring: förvalet */ } }, []);
  const save = (next: KeyMap) => { setKeys(next); try { localStorage.setItem(KEYS_STORAGE, JSON.stringify(next)); } catch { /* utan lagring */ } };
  return [keys, save];
}

/**
 * Ägaren 2026-11-10 ("man kanske ska få ändra manuellt … sen kan folk ändra och spara inställningar"): listan med ritlägets
 * kommandon och deras tangenter. Ett klick på en rad och sedan en tangent byter; hade ett annat kommando tangenten står det
 * utan tangent efteråt, och det sägs i klartext. Sparas i webbläsaren.
 */
export function MapProjectKeysDialog({ keys, onKeys, onClose }: { keys: KeyMap; onKeys: (keys: KeyMap) => void; onClose: () => void }) {
  const text = useTexts(mapProjectKeysSv, mapProjectKeysEn);
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [listening, setListening] = useState<KeyCommand>();
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setListening(undefined); return; }
      const binding = bindingOf(event);
      if (!binding) return;
      if (isReserved(binding)) { setMessage(text.reserved(keyLabel(binding, text.space))); return; }
      const result = withBinding(keys, listening, binding);
      onKeys(result.keys);
      setMessage(result.displaced ? text.displaced(text.commands[result.displaced], keyLabel(binding, text.space)) : undefined);
      setListening(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, keys, onKeys, text]);

  return <Dialog dialogRef={dialog} className={styles.dialog} labelledBy={title} onClose={onClose} closeOnBackdrop>
    <div className={styles.body} data-testid="map-project-keys">
      <h2 id={title}>{text.title}</h2>
      <p className={styles.help}>{text.help}</p>
      <ul className={styles.list}>
        {KEY_COMMANDS.map(command => <li key={command}>
          <span>{text.commands[command]}</span>
          <button type="button" className={styles.key} aria-pressed={listening === command} data-testid={`map-project-key-${command}`}
            aria-label={text.change(text.commands[command])} onClick={() => { setMessage(undefined); setListening(listening === command ? undefined : command); }}>
            {listening === command ? text.press : keys[command] ? keyLabel(keys[command], text.space) : text.none}
          </button>
        </li>)}
      </ul>
      <p className={styles.fixed}>{text.fixed}</p>
      <p className={styles.message} role="status" data-testid="map-project-keys-message">{message}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => { onKeys(DEFAULT_KEYS); setListening(undefined); setMessage(text.wasReset); }}
          data-testid="map-project-keys-reset">{text.reset}</Button>
        <Button onClick={() => dialog.current?.close()}>{text.done}</Button>
      </div>
    </div>
  </Dialog>;
}
