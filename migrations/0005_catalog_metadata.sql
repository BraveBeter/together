-- Optional public catalog provenance and edition facts; existing records are untouched.
ALTER TABLE entries ADD COLUMN metadata TEXT;
