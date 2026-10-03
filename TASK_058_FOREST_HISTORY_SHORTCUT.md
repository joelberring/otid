# TASK058: journalgenväg från kvar-i-skogen

Status: implementerad 2026-09-12; browseracceptans passerad.

Klicka Journal på en deltagarrad i adminvyns kvar-i-skogen för att välja
deltagaren, öppna journalytan och läsa senaste sidan. Återanvänd TASK057:s
skyddade läsning och befintliga väntande-begäran-spärr. Gamla uppgifter rensas
före läsning. Ingen skrivning eller extra inloggning.

Endast web presentation/i18n och befintligt browserprov berörs. Ingen ny ADR:
ADR-0094:s läsmodell och behörighetsgräns ändras inte. Personalens fristående
rapport och utskriften förblir utan denna adminåtgärd.

Acceptans: genvägen öppnar rätt journal utan föregående val i deltagarlistan,
utskriften saknar knappen, och befintlig sidvisning/logout fortsätter fungera.
Utöka ett browserfall; web lint/typecheck/build. Ingen ny DB-testmatris.

Utfall: valfri callback på rapporten används endast i gemensam adminvy.
Journalytan öppnas och fokuseras; vald deltagare binds direkt till läsningen,
utan att invänta Reacts uppdatering av entryId. Pending/busy blockerar åtgärden.
Printkopian och fristående personalrapporten får ingen callback/knapp.
Ett utökat browserfall passerade (8,6s), inklusive äldre sidor och rensning.
Fysisk mobil/skrivare och produktion är inte verifierade; inga nya API-prov
behövdes då tjänsten är oförändrad.
