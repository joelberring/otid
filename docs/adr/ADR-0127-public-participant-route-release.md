# ADR-0127: publik, exakt deltagarrutt efter uttryckligt samtycke

- Status: Accepterad, implementerad i TASK117
- Datum: 2026-09-21

## Kontext

TASK106 kan göra en vald rasterkarta publik men har ingen deltagarrutt.
TASK114 kalibrerar exakt en privat rasterversion och TASK115 kan privat
förhandsgranska exakt en GPX-rutt ovanpå den. TASK116 låter deltagaren ge eller
återta samtycke för exakt en immutable GPX-manifestversion, men samtycke är
inte själv en publicering och väljer varken karta eller kalibrering.

Att vid publik läsning välja "senaste" rutt, kartrelease eller georeferens
skulle kunna ändra det som deltagaren eller arrangören faktiskt avsåg. En
`publicResultId` identifierar ett publikt resultat men får inte användas som
skrivbehörighet eller samtycke.

## Beslut

TASK117 inför en separat, append-only `route_publication`-journal. En
`MANAGE_RACE`-administratör kan bara släppa eller återta en deltagares rutt
efter att servern har verifierat ett aktivt TASK116-`GRANT` för samma
route-manifest. Varje release binder exakt:

- race och entry;
- ruttmanifest och dess SHA-256;
- redan publicerat rastermanifest och dess SHA-256;
- en tidigare immutable georeferensrevision för samma rastermanifest.

Första målgruppen är **offentlig efter tävlingen**: den syns endast på den
redan publika resultatsidan för exakt deltagare. Den är inte en privat
"deltagare själv"-länk och kräver inget konto. Alla andra privata eller
framtida målgrupper kräver en ny ADR.

Varje publik läsning kontrollerar att den senaste route-publication-raden är
`RELEASE`, att senaste samtycke för exakt ruttmanifest fortfarande är `GRANT`
och att den aktiva TASK106-kartreleasen fortfarande är samma exakta
rastermanifest. Annars blir svaret `404`; historik, rå GPX och kartobjekt
raderas aldrig. Ett återtaget samtycke eller kartans återtagande stänger alltså
nya routehämtningar utan att skriva en ny publiceringsrad.

Den publika projektionen innehåller endast resultatsidans redan publika namn,
en serverhärledd pixelbana, bilddimensioner och en kort
"inte GPS-verifierad"-markering. WGS84-punkter, internal UUID:n, entry-/grant-
id, hashes och objektlagringsidentifierare exponeras aldrig. Rasterbilden läses
server-side från den releasebundna objektversionen, aldrig från en bucket-URL.

Administratören väljer explicit rutt, karta och georeferens. Release- och
withdraw-requester är CSRF-skyddade, idempotenta och konflikterar när samma
request-id får annat intent, annan aktör eller annan scope. Publik läsning är
helt skrivfri. Resultat, stationens offlinekö och resultatrevisioner ändras
inte.

## Konsekvenser

Det skapar den första användbara egna post-event-ruttvyn utan att låtsas vara
en full analysprodukt. En senare ADR måste besluta flera rutter, jämförelse,
tidsuppspelning, kontrollanalys, mobilinspelning, FIT/TCX, OMAP-rendering,
andra målgrupper och hantering av redan kopierat material.

## Alternativ

- Att göra TASK116-`GRANT` automatiskt publikt avvisas: samtycke väljer inte
  karta eller kalibrering och ska inte aktivera en release av misstag.
- Att använda aktuell/senaste karta eller georeferens avvisas: publiceringen
  skulle inte vara versionsbestämd.
- Att använda `publicResultId` som deltagarbehörighet avvisas: den är en
  offentlig resultatlänk.
- Att skapa en Livelox-lik analysvy nu avvisas: flera rutter, tid och analys
  är ett senare, separat problem.
