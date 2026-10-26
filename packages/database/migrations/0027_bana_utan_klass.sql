-- Steg 55: "Ny bana" utan klassnamn skapar bara banan. Journalen för den förfrågan har då ingen klass (NULL);
-- främmande nyckeln (class_id, race_id) kontrolleras bara när klassen finns.
ALTER TABLE manual_course_class_create_request ALTER COLUMN class_id DROP NOT NULL;
