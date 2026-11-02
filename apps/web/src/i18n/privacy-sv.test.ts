import { describe, expect, it } from "vitest";
import { aboutSv } from "./about-sv";
import { accountSv } from "./account-sv";
import { helpArticles } from "./help-sv";
import { raceTypeSv } from "./race-type-sv";

/** Steg 46: /integritet, /om och hjälpen säger det som appen faktiskt gör (genomlysningen, säkerhet #4 och #10). */
describe("personuppgifter och om O-Tid", () => {
  const privacy = accountSv.privacy;
  const all = JSON.stringify(privacy);

  it("nämner fest, självregistrering och IP-hashen", () => {
    expect(privacy.party).toMatch(/köp/);
    expect(privacy.party).toMatch(/checkade in och ut/);
    expect(privacy.party).toMatch(/visningsnamn/);
    expect(privacy.selfRegistration).toMatch(/hash med en hemlig nyckel/);
    expect(privacy.selfRegistration).toMatch(/två dygn/);
  });

  it("säger vad som är publikt: bricknummer bara när arrangören slår på det, live och sträcktider, fest utan belopp, inte för sökmotorer", () => {
    const visible = privacy.publicItems.join(" ");
    // ADR-0186: bricknumren är av för nya tävlingar, varianten och kartan publikt först efter start, inget indexeras.
    expect(visible).toContain("visar inte bricknummer i nya tävlingar");
    expect(visible).toMatch(/Variantens bokstav .* kartan visas publikt först efter start/);
    expect(privacy.public).toMatch(/stängda för sökmotorer och AI-tjänster/);
    expect(visible).toContain("Visa bricknummer i den publika startlistan");
    expect(visible).toMatch(/sträcktider/);
    expect(visible).toMatch(/Live/);
    expect(visible).toMatch(/aldrig belopp/);
    expect(visible).toMatch(/sökmotorer/);
    expect(visible).toContain("självreg.");
  });

  it("säger hur länge och hur radering fungerar", () => {
    expect(privacy.howLong).toMatch(/Tills tävlingen \(festen\) eller kontot tas bort/);
    expect(privacy.howLong).toMatch(/två dygn/);
    expect(privacy.howLong).toMatch(/14 dagar/);
    // ADR-0186: träningsgrupper, banläggningens notiser och foton, utskrifterna och säkerhetskopiorna står också med.
    expect(privacy.groups).toMatch(/ledare och medlemmar/);
    expect(privacy.courseSetting).toMatch(/foto/);
    expect(privacy.printJobs).toMatch(/30 dagar/);
    expect(privacy.backup).toMatch(/varje timme/);
    expect(privacy.responsible).toMatch(/driver den här O-Tid-installationen/);
    expect(all).not.toMatch(/syns för arrangören\."/);
  });

  it("Om O-Tid nämner fest, självregistrering och sträcktider", () => {
    const features = aboutSv.features.join(" ");
    expect(features).toMatch(/Fest med bar/);
    expect(features).toMatch(/Självregistrering/);
    expect(features).toMatch(/sträcktider/);
  });

  it("hjälpen och Personer med behörighet säger att funktionären ser fullt namn och kan ladda ner CSV", () => {
    const staff = helpArticles.find(article => article.id === "funktionarer")!.body.flat().join(" ");
    expect(staff).toMatch(/fulla namn/);
    expect(staff).toMatch(/CSV/);
    expect(raceTypeSv.settings.people.help).toMatch(/fulla namn.*CSV/);
  });
});
