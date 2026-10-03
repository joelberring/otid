# TASK116: deltagarens samtycke till framtida ruttpublicering

Status: implementerad och riktat verifierad.

## Användarvärde

En deltagare som redan har laddat upp sin privata GPX-rutt kan ge eller ta
tillbaka ett tydligt samtycke för en senare ruttpublicering. Rutten förblir
privat i denna uppgift.

## Avgränsning

- Privat route-upload-session, exakt en manifestversion och append-only
  `GRANT`/`WITHDRAW`-journal med hashbindning.
- Privat svensk deltagarvy visar status och kräver uttrycklig handling för
  varje beslut.
- Exakt retry, konflikt vid ändrat intent och fail-closed vid saknad/utgången
  session, spärrat grant eller saknad manifest.
- Ingen publik route-/kartändpunkt och inga ändringar av publika resultat.

## Acceptans

1. En deltagare utan lagrad rutt kan inte samtycka; standard och återtagande
   ger alltid privat status.
2. `GRANT` och `WITHDRAW` binds till den exakta manifest- och hashversion som
   servern resolverar från sessionens grant. Browsern kan inte välja entry,
   manifest eller en äldre route.
3. Exakt retry återger samma beslut; samma request-id med annat val, annan
   session-scope eller annat manifest ger konflikt. Beslut och ruttdata är
   oföränderliga.
4. En ny route-version får ingen ärvd publiceringsberedskap. Återtagande
   blockerar varje framtida publikeringsläsning, men raderar ingen historik.
5. Browserprovet använder syntetiska data, är användbart vid 390 px och
   anropar ingen publik rutt- eller kartväg.

## Utanför uppgiften

Publik/deltagarstyrd routevisning, vald målgrupp, samtyckesperiod,
kartsläppsvillkor, publicerad kopieringshantering, karta, OMAP, GPS-live,
flera rutter, analys, FIT/TCX, stafett och hårdvara.
