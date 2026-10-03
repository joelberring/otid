ALTER TABLE start_list_publication ADD COLUMN iof_start_list_xml text;
ALTER TABLE start_list_publication ADD CONSTRAINT start_list_publication_xml_check
  CHECK (iof_start_list_xml IS NULL OR
    (action = 'PUBLISH' AND octet_length(iof_start_list_xml) BETWEEN 1 AND 67108864));
-- Existing rows deliberately remain NULL: display names cannot reconstruct
-- structured names. The existing immutable trigger protects this column too.
-- Rollback: disable new writer/export; retain historical rows and column.
