CREATE TABLE IF NOT EXISTS asset_repair_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  site_id INTEGER,
  repair_date TEXT NOT NULL,
  fault_description TEXT NOT NULL,
  action_taken TEXT,
  repaired_by TEXT,
  parts_used TEXT,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Pending Parts', 'Completed', 'Closed')),
  remarks TEXT,
  attachment_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (site_id) REFERENCES sites(id),
  FOREIGN KEY (attachment_id) REFERENCES attachments(id)
);

CREATE INDEX IF NOT EXISTS idx_asset_repair_history_asset ON asset_repair_history(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_repair_history_site ON asset_repair_history(site_id);
CREATE INDEX IF NOT EXISTS idx_asset_repair_history_date ON asset_repair_history(repair_date);
CREATE INDEX IF NOT EXISTS idx_asset_repair_history_status ON asset_repair_history(status);
