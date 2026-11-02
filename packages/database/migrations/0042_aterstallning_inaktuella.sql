-- ADR-0187 beslut 5 (uppföljning): ett resultat som väntade på omräkning när säkerhetskopian togs ska vara inaktuellt också
-- efter återställningen. Utlösaren räknar som förut ut underlagets hash för varje ny resultatrevision. Bara när transaktionen
-- har satt `otid.restore` (återställningen, set_config(..., true)) och raden redan bär en hash som skiljer sig från den
-- uträknade behålls den medförda hashen. Så kan en återställning bara göra ett resultat inaktuellt, aldrig aktuellt.
-- Ersätter bara funktionen; inga data skrivs om och gammal kod (som aldrig sätter inställningen) beter sig som förut.
CREATE OR REPLACE FUNCTION public.set_result_revision_basis_hash() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  computed text := otid_result_basis_hash(NEW.entry_id);
BEGIN
  IF computed IS NULL THEN
    RAISE EXCEPTION 'result_revision saknar bedömningsunderlag för deltagaren %', NEW.entry_id;
  END IF;
  IF current_setting('otid.restore', true) = 'on' AND NEW.basis_hash ~ '^[a-f0-9]{64}$' AND NEW.basis_hash <> computed THEN
    RETURN NEW;
  END IF;
  NEW.basis_hash := computed;
  RETURN NEW;
END;
$$;
