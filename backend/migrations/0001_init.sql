PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Site User', 'Viewer/Auditor')),
  site_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_code TEXT NOT NULL UNIQUE,
  site_name TEXT NOT NULL,
  site_type TEXT,
  city TEXT,
  country TEXT,
  is_remote INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT,
  equipment_name TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  manufacturer TEXT,
  model TEXT,
  category TEXT,
  current_site_id INTEGER,
  status TEXT NOT NULL DEFAULT 'Active',
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (current_site_id) REFERENCES sites(id)
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  from_site_id INTEGER,
  to_site_id INTEGER NOT NULL,
  movement_datetime TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  remarks TEXT,
  handed_over_by TEXT,
  received_by TEXT,
  proof_attachment_id INTEGER,
  updated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (from_site_id) REFERENCES sites(id),
  FOREIGN KEY (to_site_id) REFERENCES sites(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  related_module TEXT NOT NULL,
  related_id INTEGER,
  file_name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS calibration_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  certificate_number TEXT,
  calibration_date TEXT,
  expiry_date TEXT,
  status TEXT,
  attachment_id INTEGER,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (attachment_id) REFERENCES attachments(id)
);

CREATE TABLE IF NOT EXISTS checklist_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  checklist_type TEXT NOT NULL CHECK (checklist_type IN ('PM', 'Inspection', 'NDT')),
  checklist_date TEXT NOT NULL,
  result TEXT,
  performed_by TEXT,
  next_due_date TEXT,
  remarks TEXT,
  attachment_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (attachment_id) REFERENCES attachments(id)
);

CREATE TABLE IF NOT EXISTS manifest_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  verification_date TEXT NOT NULL,
  verified_by TEXT,
  total_items INTEGER DEFAULT 0,
  matched_items INTEGER DEFAULT 0,
  missing_items INTEGER DEFAULT 0,
  extra_items INTEGER DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_serial_number ON assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_assets_current_site ON assets(current_site_id);
CREATE INDEX IF NOT EXISTS idx_movements_asset_id ON movements(asset_id);
CREATE INDEX IF NOT EXISTS idx_movements_datetime ON movements(movement_datetime);
CREATE INDEX IF NOT EXISTS idx_movements_from_to ON movements(from_site_id, to_site_id);
CREATE INDEX IF NOT EXISTS idx_calibration_asset ON calibration_records(asset_id);
CREATE INDEX IF NOT EXISTS idx_checklist_asset ON checklist_records(asset_id);
