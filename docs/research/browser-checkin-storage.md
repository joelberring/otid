# Browserlagring för TASK 006W

Kontrollerat 2026-09-05. Ingen extern kod kopieras.

- MDN, IDBDatabase.transaction: readwrite med durability=strict är den
  dokumenterade begäran om verifierad beständig skrivning före complete.
  API-stöd är inte ett prov på fysisk mobil/flash eller skydd mot profilradering.
  https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
- MDN, SubtleCrypto.deriveKey: PBKDF2 kan härleda en AES-GCM-nyckel med
  explicit hash, salt och iterationstal; extractable=false väljs av oss.
  https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey
- OWASP Password Storage Cheat Sheet anger 600 000 iterationer för
  PBKDF2-HMAC-SHA-256. Detta är underlag för arbetstal, inte ett påstående
  att en kort PIN är säker eller att krypterad browserlagring löser XSS.
  https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

O-Tids beslut finns i ADR-0053. Alternativa server-/native-keystores, ny
credentialöverlåtelse och fysisk fälttestning är inte bevisade av referenserna.

## Service worker-appskal, kontrollerat 2026-09-05

MDN beskriver install-eventets waitUntil, cacheförberedelse och separata
install/activate-faser. skipWaiting kan ta en ny worker förbi väntan på gamla
klienter; ADR-0054 väljer att inte forcera detta under operativt arbete.

- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting
