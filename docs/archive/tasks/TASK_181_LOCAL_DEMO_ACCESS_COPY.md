# TASK181: kopiera lokal demobehörighet utan manuell JSON-letning

Status: implementerat och riktat verifierat 2026-09-23. Detta är ett litet användbarhetssnitt för den
redan isolerade syntetiska demon, oberoende av TASK180:s driftgrind.

## Utfall

En testare på macOS kan ange den privata fil som `demo:provision` redan har
skapat och få just `MANAGE_RACE`-behörigheten kopierad till urklipp. Därefter
klistras den in i befintlig `/admin/{raceId}/manage`. Inget nytt lösenord,
ingen automatisk inloggning och ingen ändring av behörighetsgränsen införs.

## Gräns och acceptans

- Verktyget läser bara ett uttryckligt valt, privat, vanligt manifest på den
  lokala datorn. Det kräver befintligt `DemoInstallationSchema` och en ännu
  giltig behörighet för manifestets lopp.
- Endast hemligheten för `MANAGE_RACE` skickas via stdin till macOS `pbcopy`.
  Tokenmaterial skrivs aldrig i argument, stdout, stderr eller URL. Urklippet
  är tillfälligt och kan läsas av andra lokala appar; testaren informeras om
  detta och kan skriva över det efter inloggning.
- Fel, utgången fil och annat operativsystem ger generiskt avslag utan att
  exponera manifestets innehåll. Befintlig fil ändras inte.
- Riktad TypeScript-/lintkontroll samt ett manuellt prov med enbart den
  isolerade syntetiska testdemon räcker. Inga riktiga tävlings- eller
  Eventoruppgifter används.

## Ingår inte

Kort statisk kod, auth-bypass, browseruppladdning av manifestet, automatiskt
skapade konton, förlängd giltighetstid eller driftbehörigheter. Den mer
användbara kontobaserade demoentrén är en separat senare uppgift om den
prioriteras; den får inte skapas implicit av det här kommandot.
