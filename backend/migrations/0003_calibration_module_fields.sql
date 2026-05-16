ALTER TABLE calibration_records ADD COLUMN certificate_type TEXT;
ALTER TABLE calibration_records ADD COLUMN calibration_agency TEXT;
ALTER TABLE calibration_records ADD COLUMN result TEXT;
ALTER TABLE calibration_records ADD COLUMN attachment_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_calibration_expiry_date ON calibration_records(expiry_date);
CREATE INDEX IF NOT EXISTS idx_calibration_status ON calibration_records(status);
