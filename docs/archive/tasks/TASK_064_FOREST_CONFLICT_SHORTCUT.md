# TASK064: direktgranskning från skogsrapport

Status: implementerad och riktat verifierad 2026-09-12. Se docs/status.md.

Avgränsat UI-snitt enligt ADR-0097; ingen ny behörighet eller domänlogik.
Adminens rader med ogranskade rapporter får en genväg som väljer deltagaren
och hämtar nytt granskningsunderlag. Ingen automatisk granskning.
Personalvy och utskrift får ingen ny knapp. Befintligt TASK063-browserprov
återanvänds för klick, rätt deltagare och exakt retry. Web lint/typecheck/build.
