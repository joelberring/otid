-- Steg 60 (ADR-0179 beslut 11–12): vägvalsanalysens inställningar per tävling och de bästa vägar som arrangören publicerat.
-- Analysen räknas i arrangörens webbläsare och sparas inte. settings är RouteChoiceSettings (klass per symbol, farter,
-- ekvidistans, stigningsfaktor, referensfart). published är { mapSha256, courses: [{ courseId, variantCode, publishedAt,
-- legs: { "31.1-32.1": [[x, y], …] } }] } med förenklade linjer i kartfilens mm; mapSha256 är kartfilen de räknades på,
-- så att gamla linjer inte visas när kartfilen byts.
CREATE TABLE IF NOT EXISTS race_route_choice (
    race_id uuid NOT NULL,
    settings jsonb NOT NULL,
    published jsonb,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT race_route_choice_pkey PRIMARY KEY (race_id),
    CONSTRAINT race_route_choice_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT race_route_choice_settings_check CHECK (jsonb_typeof(settings) = 'object' AND settings->>'version' = '1'),
    CONSTRAINT race_route_choice_published_check CHECK (published IS NULL OR (jsonb_typeof(published) = 'object'
      AND published->>'mapSha256' ~ '^[a-f0-9]{64}$' AND jsonb_typeof(published->'courses') = 'array'))
);
