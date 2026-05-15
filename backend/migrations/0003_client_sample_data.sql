ALTER TABLE assets ADD COLUMN days_until_expiry INTEGER;

INSERT OR IGNORE INTO sites (site_code, site_name, site_type, city, country, is_remote)
VALUES
('HILONG', 'Hilong', 'Client Location', NULL, 'UAE', 0),
('SDC', 'SDC', 'Client Location', NULL, 'UAE', 0),
('AL-GAITH', 'AL Gaith', 'Client Location', NULL, 'UAE', 0),
('PST', 'PST', 'Client Location', NULL, 'UAE', 0),
('TASMAN', 'Tasman', 'Client Location', NULL, 'UAE', 0),
('TSI-MB30', 'TSI Yard MB-30', 'Yard', NULL, 'UAE', 0),
('WF-FRE-PCE', 'WF FRE & PCE', 'Client Location', NULL, 'UAE', 0),
('AUH', 'AUH', 'Client Location', 'Abu Dhabi', 'UAE', 0),
('KMN-TOOLS', 'KMN Tools Box', 'Tool Box', NULL, 'UAE', 0),
('TRS', 'TRS', 'Client Location', NULL, 'UAE', 0),
('WF-ADM', 'WF ADM', 'Client Location', NULL, 'UAE', 0),
('WF-RENTAL', 'WF RENTAL', 'Rental Location', NULL, 'UAE', 0);

INSERT OR IGNORE INTO assets (
  asset_code,
  equipment_name,
  serial_number,
  manufacturer,
  model,
  category,
  current_site_id,
  status,
  days_until_expiry,
  remarks
)
VALUES
('CL-001', 'A/C Yoke', '2016123816', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'HILONG'), 'Active', 25, 'Client sample data - expiry days imported'),
('CL-002', 'AC/DC YOKE', '2023115281', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'SDC'), 'Active', 22, 'Client sample data - expiry days imported'),
('CL-003', 'AC/DC YOKE', '2023115282', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'AL-GAITH'), 'Active', 22, 'Client sample data - expiry days imported'),
('CL-004', 'AC/DC YOKE', '2019074365', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'PST'), 'Active', 22, 'Client sample data - expiry days imported'),
('CL-005', 'A/C Yoke', '2024125640', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'TASMAN'), 'Active', 24, 'Client sample data - expiry days imported'),
('CL-006', 'A/C Yoke', '2023115279', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'TSI-MB30'), 'Active', 3, 'Client sample data - expiry days imported'),
('CL-007', 'AC/DC YOKE', '2024045410', NULL, NULL, 'NDT Equipment', (SELECT id FROM sites WHERE site_code = 'WF-FRE-PCE'), 'Active', 26, 'Client sample data - expiry days imported'),
('CL-008', 'Analog vernier', '23214465', NULL, NULL, 'Measuring Instrument', (SELECT id FROM sites WHERE site_code = 'AUH'), 'Active', 28, 'Client sample data - expiry days imported'),
('CL-009', 'Analog vernier', '23174492', NULL, NULL, 'Measuring Instrument', (SELECT id FROM sites WHERE site_code = 'KMN-TOOLS'), 'Active', 28, 'Client sample data - expiry days imported'),
('CL-010', 'Dig.Vernier', 'HD311699', NULL, NULL, 'Measuring Instrument', (SELECT id FROM sites WHERE site_code = 'TRS'), 'Active', 28, 'Client sample data - expiry days imported'),
('CL-011', 'Dig.Vernier', '0707232864', NULL, NULL, 'Measuring Instrument', (SELECT id FROM sites WHERE site_code = 'WF-ADM'), 'Active', 28, 'Client sample data - expiry days imported'),
('CL-012', 'Digital Depth Vernier', '00047976', NULL, NULL, 'Measuring Instrument', (SELECT id FROM sites WHERE site_code = 'WF-RENTAL'), 'Active', 28, 'Client sample data - expiry days imported');
