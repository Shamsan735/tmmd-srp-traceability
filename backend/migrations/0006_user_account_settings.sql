CREATE TABLE IF NOT EXISTS user_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  allowed_tabs TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO user_accounts (username, password, display_name, role, allowed_tabs, is_active)
VALUES
('admin', 'Admin@123', 'System Admin', 'Admin', '["dashboard","movement","traceability","assets","sites","calibration","pm","repair","reports","import","settings"]', 1),
('store', 'Store@123', 'Store User', 'Store', '["dashboard","movement","traceability","sites","repair","reports"]', 1),
('operator', 'Operator@123', 'Operator', 'Operator', '["dashboard","movement","traceability","pm"]', 1),
('viewer', 'Viewer@123', 'Viewer', 'Viewer', '["dashboard","traceability"]', 1);

CREATE INDEX IF NOT EXISTS idx_user_accounts_username ON user_accounts(username);
CREATE INDEX IF NOT EXISTS idx_user_accounts_role ON user_accounts(role);
