# ADR-0117: Tävlingsadministratören utfärdar begränsad operativ åtkomst i webben

- Status: Accepterad för TASK102
- Datum: 2026-09-20

## Kontext

O-Tid har redan racebundna, kortlivade bearer-credentials för full
`MANAGE_RACE`-administration samt begränsat `START_CHECKIN` och
`FINISH_FOREST_WATCH`. De kan skapas i en betrodd CLI, men en tävlingsledare
kan inte ge en start- eller måloperatör tillgång i den vanliga
administratörsvyn. Det skapar onödigt beroende av serveroperatören under en
tävling.

Det finns ännu inget konto-, klubb- eller medlemsregister. Att låtsas tilldela
en namngiven person skulle därför vara missvisande: en label beskriver bara
vem arrangören tänker lämna en credential till, inte en verifierad identitet.

## Beslut

En autentiserad `MANAGE_RACE`-administratör får i sin racebundna webbsession:

1. utfärda en ny, kortlivad credential för exakt en av `MANAGE_RACE`,
   `START_CHECKIN` eller `FINISH_FOREST_WATCH`;
2. se hemlighetsfri metadata för de credentials som skapats genom denna
   administratörsväg, inklusive label, roll, utfärdande-/utgångstid och om den
   är spärrad;
3. spärra en sådan credential. Befintlig sessions- och credentialspärr gör
   den omedelbart obrukbar enligt nuvarande modell.

Credentialens hemlighet returneras bara i utfärdandesvaret över den befintliga
skyddade adminrouten. Webben visar den för kopiering/överlämning men skriver
den aldrig till `localStorage`, `sessionStorage`, URL, logg, historik eller
den vanliga metadata-listan. Svar som tappas eller avbryts återförsöks inte
automatiskt: eftersom hemligheten då inte säkert nått operatören ska
administratören spärra den synliga osäkra metadata-raden och utfärda en ny.

Samma befintliga capabilitypolicy begränsar livslängden. Ingen credential för
Eventor, PM, stationpairing, speaker eller andra specialgränser kan utfärdas i
detta första snitt. De kräver egna operativa beslut och får inte bli en
implicit wildcard-rättighet.

Utfärdande och spärr sker efter verklig `MANAGE_RACE`-autentisering, race-scope,
Origin/CSRF och `no-store`. En extra auditpost binder utfärdande/spärr till den
faktiska utfärdande administratörens credential-id; den befintliga credential-
och spärrhistoriken behålls oförändrad. Detta är inte en medlemsmodell och ger
inte en begränsad operatör rätt att utfärda vidare access.

## Konsekvenser och gränser

- Ingen datamigrering krävs: credential-, spärr- och audit-tabeller finns redan.
- En label kan innehålla ett operativt namn men får inte tolkas som verifierad
  personidentitet. Kontaktuppgifter samlas inte in.
- Full `MANAGE_RACE` återanvänder den redan integrerade administratörsvyn,
  inklusive klass-/starttids-/brick- och resultatarbete. Start och mål behåller
  sina begränsade vyer och får inte tillgång till administrationen.
- Ingen ny inloggningsleverantör, permanent användarprofil, e-postutskick,
  automatisk retry, offlineutfärdande, GPS, USB eller stafett ingår.

## Återställning

Vid fel stängs den nya routen/panelen. Utfärdade credentials spärras med
befintlig append-only spärrjournal; de tas inte bort. Ingen rådata,
resultatrevision eller äldre credentialhistorik ändras.
