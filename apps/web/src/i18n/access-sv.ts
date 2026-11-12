/**
 * Användartestet 2026-11-12: besked när en tävlingssida inte öppnas, efter läget (inte inloggad, inloggad utan behörighet,
 * inloggad med obekräftad adress), och erbjudandet att bekräfta adressen (inbjudningssidan och tävlingssidan).
 */
export const accessSv = {
  checking: "Kontrollerar inloggningen …",
  signedOut: "Du är inte inloggad. Logga in med ditt konto.",
  signIn: "Logga in",
  noAccess: (email: string) => `Du är inloggad som ${email} men har inte behörighet till den här tävlingen.`,
  noAccessHelp: "Be tävlingens administratör att bjuda in dig med den adressen, eller logga ut och logga in med ett annat konto.",
  unverified: (email: string) => `Du är inloggad som ${email}, men adressen är inte bekräftad. Har du bjudits in: bekräfta din e-postadress för att behörigheten ska gälla.`,
  myRaces: "Gå till Mina tävlingar",
  confirmHeading: "Bekräfta din e-postadress",
  confirmInvitation: (email: string) => `Du är inloggad som ${email}, men adressen är inte bekräftad, så inbjudan gäller inte än. Bekräfta din e-postadress för att behörigheten ska gälla.`,
  confirmHow: "Du får ett mejl med en länk. Öppna länken och välj lösenord; då är adressen bekräftad och behörigheten gäller.",
  send: "Skicka bekräftelsemejl",
  sending: "Skickar …",
  sent: (email: string) => `Mejlet är skickat till ${email}. Öppna länken i det; den gäller en timme.`,
  mailOff: "E-post är inte inställd på servern, så inget mejl kan skickas. Be den som driver O-Tid att bekräfta adressen.",
  failed: "Mejlet kunde inte skickas. Försök igen om en stund."
} as const;
