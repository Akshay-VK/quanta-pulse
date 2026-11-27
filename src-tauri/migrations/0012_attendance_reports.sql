-- Scoped report facts are optional for existing A0 observations.
ALTER TABLE academic_attendance ADD COLUMN details TEXT;
