# Browserlagring för startavprickning

Granskat 2026-09-05, officiell webplattformdokumentation (MDN):

- https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
  beskriver transaktioner och durability-alternativet strict. Lokal UI-kvittens
  ska vänta på complete, inte en enskild request-success.
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
  beskriver begäran om persistent storage. Utfallet måste hanteras; det är inte
  ett skydd mot användarens medvetna dataradering.
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
  beskriver offlinecachning av appresurser. Cache är inte markeringsjournal.

Inga snippets kopierades. Faktiskt stöd, kvotfel, omladdning och persistens
måste testas i målwebbläsarna innan offlinefunktionen kan kallas verifierad.
