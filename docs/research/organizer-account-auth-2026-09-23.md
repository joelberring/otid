# Underlag för arrangörskonto, 2026-09-23

Detta är faktaunderlag för ADR-0144, inte ett påstående om att O-Tid i dag har
kontoinloggning. Inga externa system eller användardata kontaktades.

- [NIST SP 800-63B-4, autentisering](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/):
  lösenordsverifierare behöver begränsa misslyckade försök; lösenordshanterare
  och inklistring ska fungera. Detta motiverar serverbeständig throttling och
  en vanlig lösenordsruta utan kompositionskrav.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html):
  lösenord lagras som saltade, arbetskrävande verifierare. När Argon2id inte
  används anger guiden bland annat scrypt `N=2^15, r=8, p=3` som en miniminivå.
  Värdet måste även hållas inom serverns minnes-/konkurrensbudget.
- [NIST SP 800-63B-4, sessioner](https://pages.nist.gov/800-63-4/sp800-63b/session/)
  och [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html):
  en browsercookie är ett kortlivat sessionsbevis, inte ett lösenord.
  Serverstyrd giltighet, utloggning, Secure/HttpOnly/SameSite och opakt värde
  är relevanta för det nya kontot.

Detta underlag säger inget om en lämplig extern identitetsleverantör. ADR-0144
väljer ett litet lokalt konto utan ny leverantör för första arrangörssnittet.
Det är ett projektspecifikt avvägningsbeslut, inte en rekommendation från
källorna. Flerfaktor, publik självregistrering och e-poståterställning är
fortsatta separata produktbeslut.
