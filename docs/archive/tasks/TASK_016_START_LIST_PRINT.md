# TASK016 – Privat utskrift av startlistans aktuella urval

Status: implementerad och verifierad i browserns print-media; fysisk utskrift
och flersidig pagination återstår att verifiera. Se docs/status.md.

Startpersonal ska kunna öppna browserns utskrift för den redan behörigt
hämtade, filtrerade listan. Ingen ny hämtning, filserver, PDF-lagring eller
publicering. Befintligt race-id, version, tidszon/lästid och klass-/sökfilter
identifierar underlaget. Antal visar urvalets omfattning. Listan ska säga
privat arbetslista/planerad start, inte faktisk start. Stale-varning och
saknade tider/brickvarningar får aldrig försvinna vid utskrift.

Web-only: start-list-admin, svenska texter, avgränsad print-CSS och fokuserad
browseracceptans. Ingen schema-/API-/behörighets-/domänändring eller dependency.
Ingen ny ADR för browserns rena presentationsutskrift. Detta är inte en ny
offlinekälla eller kvittens. Personuppgifter och söktext skrivs bara efter
uttryckligt printval; sparade/papperskopior kan inte återkallas vid logout.
Inga riktiga tävlingsdata eller externa system används i provet.

Acceptans: printknapp bara för hämtad icke-tom lista, inaktiv under pågående
anrop; bara filtrerade rader, identitet/version/filter/lästid synliga i print;
UI-kontroller, lösenord och navigation utelämnas; ingen mobilkortlayout på
papper; tabellhuvud upprepningsbart och rader hålls ihop där browsern kan.
Stale-varning bevaras. Efter logout saknas data och printknapp. Browserns
print-media kontrolleras med syntetiska API-svar; fysisk skrivare och alla
browser-/pappersinställningar är inte därmed verifierade. Fokuserade tester,
lint/typecheck/build. Ingen omfattande backend-/hårdvarutestning för denna CSS.
