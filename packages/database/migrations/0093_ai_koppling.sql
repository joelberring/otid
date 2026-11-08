-- ADR-0219 (steg K2, tillägget om AI-kopplingen): O-Tid som inloggningsserver (OAuth 2.1) och MCP-server för Claude med
-- personens eget konto, och kartjobben (läsa kartfilen, rita bilder, lista objekt, normkontroll) som utskriftsarbetaren gör.
--
-- Bara tillägg (migrations/README.md): fyra nya tabeller och rättigheter för utskriftsarbetarens roll. Inga hemligheter sparas i
-- klartext: koder och nycklar sparas som sha256. Kopplingarna tas bort med kontot (purge i koden); klienterna (Claude och
-- liknande, dynamisk registrering) har inget konto.

-- Klienter som registrerat sig (RFC 7591, publika klienter med PKCE). Namnet visas när personen godkänner kopplingen.
CREATE TABLE IF NOT EXISTS oauth_client (
  id text NOT NULL,
  name text NOT NULL,
  redirect_uris jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL,
  last_used_at timestamp with time zone,
  CONSTRAINT oauth_client_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_client_id_check CHECK (id ~ '^[A-Za-z0-9_-]{16,64}$'),
  CONSTRAINT oauth_client_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT oauth_client_redirect_check CHECK (jsonb_typeof(redirect_uris) = 'array' AND jsonb_array_length(redirect_uris) BETWEEN 1 AND 10
    AND pg_column_size(redirect_uris) <= 8192)
);
CREATE INDEX IF NOT EXISTS oauth_client_created_idx ON oauth_client (created_at);

-- Koder från godkännandet: används en gång inom några minuter, med PKCE (S256).
CREATE TABLE IF NOT EXISTS oauth_code (
  code_sha256 text NOT NULL,
  client_id text NOT NULL,
  account_id uuid NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL,
  resource text,
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  CONSTRAINT oauth_code_pkey PRIMARY KEY (code_sha256),
  CONSTRAINT oauth_code_client_fkey FOREIGN KEY (client_id) REFERENCES oauth_client (id),
  CONSTRAINT oauth_code_sha_check CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT oauth_code_challenge_check CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT oauth_code_redirect_check CHECK (char_length(redirect_uri) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS oauth_code_account_idx ON oauth_code (account_id);
CREATE INDEX IF NOT EXISTS oauth_code_expires_idx ON oauth_code (expires_at);

-- En koppling (ett godkännande): nyckel för åtkomst (kort) och för förnyelse (längre, byts vid varje förnyelse). Återkallad =
-- revoked_at. Raden står kvar en tid efter återkallelsen så att kontot ser vad som hänt, och rensas sedan.
CREATE TABLE IF NOT EXISTS oauth_grant (
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  client_id text NOT NULL,
  client_name text NOT NULL,
  scope text NOT NULL,
  resource text,
  access_sha256 text NOT NULL,
  access_expires_at timestamp with time zone NOT NULL,
  refresh_sha256 text NOT NULL,
  refresh_expires_at timestamp with time zone NOT NULL,
  -- Förnyelsenyckeln före den senaste förnyelsen: används den igen har någon kopierat den, och kopplingen återkallas.
  previous_refresh_sha256 text,
  created_at timestamp with time zone NOT NULL,
  refreshed_at timestamp with time zone,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT oauth_grant_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_grant_access_key UNIQUE (access_sha256),
  CONSTRAINT oauth_grant_refresh_key UNIQUE (refresh_sha256),
  CONSTRAINT oauth_grant_sha_check CHECK (access_sha256 ~ '^[0-9a-f]{64}$' AND refresh_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT oauth_grant_client_name_check CHECK (char_length(btrim(client_name)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS oauth_grant_account_idx ON oauth_grant (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oauth_grant_refresh_expires_idx ON oauth_grant (refresh_expires_at);
CREATE INDEX IF NOT EXISTS oauth_grant_previous_refresh_idx ON oauth_grant (previous_refresh_sha256) WHERE previous_refresh_sha256 IS NOT NULL;

-- Kartjobben: webben lägger jobbet och väntar några sekunder på svaret; utskriftsarbetaren (låg prioritet, egen barnprocess per
-- jobb) läser grundfilen och projektets ändrade objekt och skriver resultatet (bild och/eller json). Resultaten rensas efter en
-- kort tid och tas inte med i säkerhetskopian (de kan göras om).
CREATE TABLE IF NOT EXISTS map_project_job (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL,
  request jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  created_at timestamp with time zone NOT NULL,
  started_at timestamp with time zone,
  heartbeat_at timestamp with time zone,
  finished_at timestamp with time zone,
  attempts integer NOT NULL DEFAULT 0,
  worker text,
  error text,
  result jsonb,
  image bytea,
  CONSTRAINT map_project_job_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_job_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_job_kind_check CHECK (kind ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_job_status_check CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  CONSTRAINT map_project_job_request_check CHECK (jsonb_typeof(request) = 'object' AND pg_column_size(request) <= 262144),
  CONSTRAINT map_project_job_image_check CHECK (image IS NULL OR octet_length(image) <= 8388608)
);
CREATE INDEX IF NOT EXISTS map_project_job_queue_idx ON map_project_job (status, created_at);
CREATE INDEX IF NOT EXISTS map_project_job_account_idx ON map_project_job (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS map_project_job_project_idx ON map_project_job (project_id);

-- Utskriftsarbetaren (otid_print) tar kartjobben: kön, projektets grundfil (map_project) och dess ändrade objekt. Rollerna som
-- läser race_map_source får rättigheterna (som 0044 och 0063); webbens rättigheter kommer från ägarens förvalda rättigheter.
-- Utan rollerna (en superuser) görs inget. deploy/db-roles.sh ger samma rättigheter.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ro.rolname
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles ro ON ro.oid = a.grantee
    WHERE c.oid = 'race_map_source'::regclass AND a.privilege_type = 'SELECT' AND a.grantee <> c.relowner AND NOT ro.rolsuper
      AND NOT has_table_privilege(ro.rolname, 'race', 'INSERT')
  LOOP
    EXECUTE format('GRANT SELECT, UPDATE, DELETE ON map_project_job TO %I', r.rolname);
    EXECUTE format('GRANT SELECT ON map_project, map_project_object TO %I', r.rolname);
  END LOOP;
END;
$$;
