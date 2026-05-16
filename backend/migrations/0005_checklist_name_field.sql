ALTER TABLE checklist_records ADD COLUMN checklist_name TEXT;

CREATE INDEX IF NOT EXISTS idx_checklist_name ON checklist_records(checklist_name);
