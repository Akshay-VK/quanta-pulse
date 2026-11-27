-- Extra literal source fields and a freshness flag for omitted grade rows.
ALTER TABLE academic_grades ADD COLUMN details TEXT;
ALTER TABLE academic_grades ADD COLUMN omitted INTEGER NOT NULL DEFAULT 0;
