-- ADR-0197: papperet i utskriften ("paper space"). Bara nya tabeller.
-- Papperets bilder (logotyper, sponsorer) sparas en gång per innehåll (sha256) och pekas ut av banläggningens dokument.
-- De är små (högst 2 MB) och räknas inte i kartinnehållets kvot (ADR-0189). Utskriftsarbetaren läser dem för PDF:en.
CREATE TABLE IF NOT EXISTS course_setting_paper_image (
  sha256 text NOT NULL,
  media_type text NOT NULL,
  image bytea NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT course_setting_paper_image_pkey PRIMARY KEY (sha256),
  CONSTRAINT course_setting_paper_image_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES user_account (id),
  CONSTRAINT course_setting_paper_image_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT course_setting_paper_image_type_check CHECK (media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT course_setting_paper_image_size_check CHECK (octet_length(image) BETWEEN 1 AND 2097152
    AND width BETWEEN 1 AND 20000 AND height BETWEEN 1 AND 20000)
);

-- Papperets mallar i kontots bibliotek (för andra tävlingar). Mallen är JSON som paketet prövar (validatePaperTemplate).
CREATE TABLE IF NOT EXISTS course_setting_paper_template (
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  name text NOT NULL,
  template jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT course_setting_paper_template_pkey PRIMARY KEY (id),
  CONSTRAINT course_setting_paper_template_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id),
  CONSTRAINT course_setting_paper_template_name_unique UNIQUE (account_id, name),
  CONSTRAINT course_setting_paper_template_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT course_setting_paper_template_size_check CHECK (octet_length(template::text) <= 65536)
);

-- Utskriftsarbetaren (otid_print) läser bilderna, som kartfilen (ADR-0186). Rollerna som läser race_map_source får läsa
-- bilderna; webbens rättigheter på nya tabeller kommer från ägarens förvalda rättigheter. Utan rollerna görs inget.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ro.rolname
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles ro ON ro.oid = a.grantee
    WHERE c.oid = 'race_map_source'::regclass AND a.privilege_type = 'SELECT' AND a.grantee <> c.relowner AND NOT ro.rolsuper
  LOOP
    EXECUTE format('GRANT SELECT ON course_setting_paper_image TO %I', r.rolname);
  END LOOP;
END;
$$;
