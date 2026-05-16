ALTER TABLE checklist_records ADD COLUMN pm_frequency TEXT;
ALTER TABLE checklist_records ADD COLUMN attachment_ref TEXT;
ALTER TABLE asset_repair_history ADD COLUMN attachment_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_checklist_date ON checklist_records(checklist_date);
CREATE INDEX IF NOT EXISTS idx_checklist_type ON checklist_records(checklist_type);
CREATE INDEX IF NOT EXISTS idx_checklist_result ON checklist_records(result);
