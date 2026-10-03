# TASK210: tät arbetsrad i tävlingsöversikten

Status: genomfört och syntetiskt verifierat 2026-09-27.

## Problem och avsikt

Den breda `/manage`-översikten visar redan klass- och uppföljningstabeller,
men har en separat deltagarrad följd av tre arbetsområden. Det ger en extra
fullbreddsrad utan ny information. Behåll de fyra vägarna (Före, Deltagare,
Under, Efter) och deras nuvarande fakta, men samla dem i ett sammanhängande,
tätt navigationsband efter tabellerna. Vid paddbredd används två kolumner;
mobilen behåller stora, staplade tryckytor. Tabellen ska fortfarande vara
översiktens första operativa innehåll.

## Gräns

Endast `RaceWorkspaceOverview`, dess lokala CSS och den inloggade
`/manage`-vyns generella header via arbetsytans CSS. Inga nya funktioner,
ändrade beräkningar, API-/domänändringar eller fast/sticky topp. Bilderna av
MeOS är beteendereferens för informationsdensitet, inte layout- eller kodmall.
Ingen ADR behövs eftersom teknikval och domängränser inte ändras.

## Kontroll

Riktat syntetiskt browserfall på mobil, padda och dator: fyra tillgängliga
vägar, ingen horisontell sidscroll, minst 44 px tryckyta på mobil och
klass-/uppföljningsinformationen kvar. Web lint, typecheck och build. Detta
är inte fysisk användbarhetsacceptans.

## Utfall

Den separata deltagarraden har ersatts av den fjärde cellen i arbetsbandet.
På 1280 px står fyra vägar i en rad, på 900 px i två rader och på 390 px
fortsatt som fyra läsbara mobilkort med minst 44 px knappar. Den befintliga
underlagsvarningen kortades utan att dölja dess begränsning och ryms i en rad
vid 900 px. Klass-/uppföljningstabellerna ligger kvar före bandet. Inga
statusmått eller navigationsvägar försvann. Den generella O-Tid-headern
döljs enbart i den inloggade `/manage`-arbetsytan från 721 px; tävlingsnamn,
tillbaka-länk och status är kvar. På mobil syns headern fortfarande. Ingen
header eller navigation är sticky/fixed och ingen sådan toppyta har lagts till.

Senare TASK217 ändrar enbart den inloggade mobilens dubbla generiska header:
den döljs nu också där, medan tävlingens egen identitet och status behålls.
Ovanstående beskriver TASK210:s dåvarande verifierade tillstånd.

Ett befintligt syntetiskt browserflöde passerade **1/1, exit 0** efter sista
ändringen; skärmbilder vid 390, 900 och 1280 px granskades. Web lint,
typecheck, build och browser-TS/ESLint gav var för sig **exit 0**. Första
browserförsöket stoppades av sandboxens loopbackspärr (`EPERM`, exit 1);
lokalt godkänd omkörning passerade. Ingen riktig tävling/databas eller fysisk
enhet användes. Långa namn, större textzoom och verklig operatörsanvändning
återstår att prova.
