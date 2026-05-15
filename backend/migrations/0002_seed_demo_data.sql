INSERT INTO sites (site_code, site_name, site_type, city, country, is_remote)
VALUES
('MAIN-WH', 'Main Warehouse', 'Warehouse', 'Dammam', 'Saudi Arabia', 0),
('RIG-01', 'Remote Rig Site 01', 'Remote Site', 'Remote Area', 'Saudi Arabia', 1),
('YARD-01', 'Maintenance Yard 01', 'Yard', 'Dammam', 'Saudi Arabia', 0),
('CLIENT-SITE', 'Client Site', 'Project Site', 'Jubail', 'Saudi Arabia', 0);

INSERT INTO users (name, email, role, site_id)
VALUES
('System Admin', 'admin@tmmdsrp.local', 'Admin', 1),
('Site User Demo', 'siteuser@tmmdsrp.local', 'Site User', 2),
('Auditor Demo', 'auditor@tmmdsrp.local', 'Viewer/Auditor', NULL);

INSERT INTO assets (asset_code, equipment_name, serial_number, manufacturer, model, category, current_site_id, status, remarks)
VALUES
('EQ-001', 'Electrical Grinder', 'GRD-1001', 'Bosch', 'GWS 2200', 'Power Tool', 1, 'Active', 'Demo asset from master list'),
('EQ-002', 'Hand Tool Set', 'HTS-2001', 'Stanley', 'Mixed Set', 'Hand Tools', 1, 'Active', 'Demo hand tools'),
('EQ-003', 'Blower', 'BLW-3001', 'Makita', 'UB1103', 'Power Tool', 3, 'Active', 'Demo blower equipment'),
('EQ-004', 'Lifting Sling', 'LS-4001', 'Generic', '5 Ton', 'Lifting Gear', 2, 'Active', 'Demo lifting equipment');
