# ADR-0095: valbar automatisk uppdatering av skogsrapport

Accepterad 2026-09-12 för TASK060. Utvidgar ADR-0090:s manuella
uppdateringsflöde, utan att ändra lästjänst eller rapportens bevisvärde.

Erbjud en tydlig checkbox för automatisk uppdatering. Manuell uppdatering
finns kvar och är standard; valet sparas inte över logout. När automatiskt
läge är valt sker högst ett försök per15 sekunder under inaktivitet.

Hämta bara när adminsessionen är aktiv, dokumentet synligt och rapporten
öppen. Pausa medan en begäran körs, en granskning/okänd skrivkvittens väntar,
journalen läses eller användaren redigerar ett fält. Ingen överlappande
fetch, kö av missade tick eller automatisk omsändning av skrivningar.

Återanvänd samma privata GET och versionsvalidering som manuell uppdatering.
Lyckad hämtning uppdaterar datum och data. Nätfel behåller gammalmärkt underlag;
sessionens utgång rensar underlaget enligt befintlig låsning. Auto-läget får
inte tömma journalen eller skriva över en fryst rättningsbegäran.

Ingen ny SSE-ström, serverworker, roll eller offlinekö. Timer är endast en
klientfunktion medan vyn används, inte bakgrundsövervakning. Serverlagrade
uppgifter kan fortfarande sakna osynkade mobilobservationer. Stängd rapport,
logout och avmontering stoppar timern. UI beskriver dessa pauser.
