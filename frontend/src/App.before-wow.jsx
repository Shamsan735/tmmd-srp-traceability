import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev";

function expiryClass(days) {
  if (days === null || days === undefined || days === "") return "neutral";
  const value = Number(days);
  if (value <= 7) return "critical";
  if (value <= 30) return "warning";
  return "safe";
}

function formatDate(value) {
  if (!value) return "N/A";
  return String(value).replace("T", " ");
}

function App() {
  const [sites, setSites] = useState([]);
  const [assets, setAssets] = useState([]);
  const [history, setHistory] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [movementForm, setMovementForm] = useState({
    asset_id: "",
    to_site_id: "",
    movement_datetime: new Date().toISOString().slice(0, 16),
    movement_type: "Transfer",
    remarks: "",
    handed_over_by: "",
    received_by: "",
    updated_by_user_id: 1,
  });

  async function loadSites() {
    const res = await fetch(`${API_BASE}/api/sites`);
    const data = await res.json();
    if (data.success) setSites(data.data);
  }

  async function loadAssets() {
    const res = await fetch(`${API_BASE}/api/assets`);
    const data = await res.json();
    if (data.success) setAssets(data.data);
  }

  async function loadAssetHistory(assetId) {
    if (!assetId) return;
    const res = await fetch(`${API_BASE}/api/assets/${assetId}/history`);
    const data = await res.json();

    if (data.success) {
      setHistory(data.data);
      setSelectedAssetId(String(assetId));
    }
  }

  useEffect(() => {
    loadSites();
    loadAssets();
  }, []);

  const selectedMovementAsset = useMemo(() => {
    return assets.find((asset) => String(asset.id) === String(movementForm.asset_id));
  }, [assets, movementForm.asset_id]);

  const criticalAssets = useMemo(() => {
    return assets.filter((asset) => asset.days_until_expiry !== null && asset.days_until_expiry !== undefined && Number(asset.days_until_expiry) <= 7);
  }, [assets]);

  const warningAssets = useMemo(() => {
    return assets.filter((asset) => asset.days_until_expiry !== null && asset.days_until_expiry !== undefined && Number(asset.days_until_expiry) > 7 && Number(asset.days_until_expiry) <= 30);
  }, [assets]);

  const remoteSites = useMemo(() => sites.filter((site) => site.is_remote), [sites]);

  async function handleMovementSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const payload = {
        ...movementForm,
        asset_id: Number(movementForm.asset_id),
        to_site_id: Number(movementForm.to_site_id),
      };

      const res = await fetch(`${API_BASE}/api/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        setMessage("Movement saved successfully. Current location updated.");
        await loadAssets();
        await loadAssetHistory(payload.asset_id);

        setMovementForm((prev) => ({
          ...prev,
          remarks: "",
          handed_over_by: "",
          received_by: "",
        }));
      } else {
        setMessage(data.message || "Something went wrong.");
      }
    } catch (error) {
      setMessage("Backend connection failed. Make sure Worker is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();

    const q = searchText.trim();
    if (!q) return;

    const found = assets.find((asset) => {
      const combined = `${asset.serial_number} ${asset.asset_code} ${asset.equipment_name}`.toLowerCase();
      return combined.includes(q.toLowerCase());
    });

    if (found) {
      await loadAssetHistory(found.id);
      setMessage("");
    } else {
      setHistory(null);
      setMessage("No equipment found for this search.");
    }
  }

  return (
    <div className="premium-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">TS</div>
          <div>
            <h2>TMMD SRP</h2>
            <p>Traceability Control</p>
          </div>
        </div>

        <nav className="nav-menu">
          <a className="active">Command Center</a>
          <a>Asset Master</a>
          <a>Movement Control</a>
          <a>Traceability Search</a>
          <a>Calibration</a>
          <a>PM / Checklist</a>
          <a>Audit Reports</a>
        </nav>

        <div className="sidebar-card">
          <span>System Status</span>
          <strong>Live Demo</strong>
          <p>Frontend, Worker API and D1 database connected.</p>
        </div>
      </aside>

      <main className="content-area">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Cloud-Based Web System</p>
            <h1>TMMD & SRP Management and Traceability System</h1>
            <p className="hero-text">
              Live equipment movement, current location tracking, audit traceability,
              expiry visibility and complete equipment history for remote and site operations.
            </p>
          </div>

          <div className="hero-actions">
            <div className="live-pill">
              <span></span>
              API Connected
            </div>
            <button onClick={() => loadAssets()}>Refresh Data</button>
          </div>
        </section>

        {message && <div className="message-banner">{message}</div>}

        <section className="kpi-grid">
          <div className="kpi-card dark">
            <span>Total Assets</span>
            <strong>{assets.length}</strong>
            <p>Active master equipment</p>
          </div>

          <div className="kpi-card">
            <span>Total Sites</span>
            <strong>{sites.length}</strong>
            <p>Client and remote locations</p>
          </div>

          <div className="kpi-card">
            <span>Remote Sites</span>
            <strong>{remoteSites.length}</strong>
            <p>Field locations enabled</p>
          </div>

          <div className="kpi-card danger">
            <span>Critical Expiry</span>
            <strong>{criticalAssets.length}</strong>
            <p>Due within 7 days</p>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="glass-panel movement-panel">
            <div className="section-heading">
              <div>
                <span className="mini-label">Movement Control</span>
                <h2>Equipment Movement Entry</h2>
                <p>Save movement and update current location automatically.</p>
              </div>
            </div>

            <form className="premium-form" onSubmit={handleMovementSubmit}>
              <label className="wide">
                Equipment / Identification
                <select
                  value={movementForm.asset_id}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, asset_id: e.target.value }))}
                  required
                >
                  <option value="">Select equipment</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.equipment_name} - {asset.serial_number}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Current / From Site
                <input value={selectedMovementAsset?.current_location || "Select equipment first"} disabled />
              </label>

              <label>
                To Site
                <select
                  value={movementForm.to_site_id}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, to_site_id: e.target.value }))}
                  required
                >
                  <option value="">Select destination</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Movement Type
                <select
                  value={movementForm.movement_type}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, movement_type: e.target.value }))}
                >
                  <option>Transfer</option>
                  <option>Return</option>
                  <option>Issue</option>
                  <option>Repair</option>
                  <option>Calibration</option>
                  <option>Inspection</option>
                </select>
              </label>

              <label>
                Date & Time
                <input
                  type="datetime-local"
                  value={movementForm.movement_datetime}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, movement_datetime: e.target.value }))}
                  required
                />
              </label>

              <label>
                Handed Over By
                <input
                  value={movementForm.handed_over_by}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, handed_over_by: e.target.value }))}
                  placeholder="Sender name"
                />
              </label>

              <label>
                Received By
                <input
                  value={movementForm.received_by}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, received_by: e.target.value }))}
                  placeholder="Receiver name"
                />
              </label>

              <label className="wide">
                Remarks
                <textarea
                  value={movementForm.remarks}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, remarks: e.target.value }))}
                  placeholder="Movement remarks, driver detail, document reference..."
                />
              </label>

              <div className="upload-strip wide">
                Proof photo upload will be connected after R2 activation. Images will be compressed before upload.
              </div>

              <button className="primary-action wide" disabled={loading}>
                {loading ? "Saving Movement..." : "Save Movement & Update Location"}
              </button>
            </form>
          </div>

          <div className="glass-panel search-panel">
            <div className="section-heading">
              <div>
                <span className="mini-label">Audit Search</span>
                <h2>Traceability Cockpit</h2>
                <p>Search by equipment name, asset code or serial number.</p>
              </div>
            </div>

            <form className="search-box" onSubmit={handleSearch}>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search e.g. 2016123816"
              />
              <button>Search</button>
            </form>

            <div className="alert-card">
              <div>
                <span>Critical Expiry</span>
                <strong>{criticalAssets.length}</strong>
              </div>
              <p>
                {criticalAssets.length > 0
                  ? `${criticalAssets[0].equipment_name} needs attention in ${criticalAssets[0].days_until_expiry} days.`
                  : "No critical expiry found."}
              </p>
            </div>

            <div className="asset-short-list">
              {assets.slice(0, 9).map((asset) => (
                <button
                  key={asset.id}
                  className={String(selectedAssetId) === String(asset.id) ? "asset-chip active" : "asset-chip"}
                  onClick={() => loadAssetHistory(asset.id)}
                >
                  <div>
                    <strong>{asset.equipment_name}</strong>
                    <span>{asset.serial_number}</span>
                  </div>
                  <em className={`expiry-dot ${expiryClass(asset.days_until_expiry)}`}>
                    {asset.days_until_expiry ?? "-"}
                  </em>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel">
          <div className="section-heading table-heading">
            <div>
              <span className="mini-label">Live Register</span>
              <h2>Equipment Current Location</h2>
              <p>Real-time current location updated from movement transactions.</p>
            </div>
            <div className="table-summary">
              <span>{warningAssets.length} expiry warning</span>
              <span>{criticalAssets.length} critical</span>
            </div>
          </div>

          <div className="premium-table-wrap">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Identification No.</th>
                  <th>Asset Code</th>
                  <th>Category</th>
                  <th>Expiry Days</th>
                  <th>Current Location</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <strong>{asset.equipment_name}</strong>
                    </td>
                    <td>{asset.serial_number}</td>
                    <td>{asset.asset_code}</td>
                    <td>{asset.category}</td>
                    <td>
                      <span className={`expiry-badge ${expiryClass(asset.days_until_expiry)}`}>
                        {asset.days_until_expiry ?? "-"}
                      </span>
                    </td>
                    <td>{asset.current_location}</td>
                    <td>
                      <span className="status-badge">{asset.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {history && (
          <section className="glass-panel history-card">
            <div className="section-heading table-heading">
              <div>
                <span className="mini-label">Audit Trail</span>
                <h2>Full Movement History</h2>
                <p>
                  {history.asset.equipment_name} - {history.asset.serial_number}
                </p>
              </div>

              <div className="current-location-box">
                Current Location
                <strong>{history.asset.current_location}</strong>
              </div>
            </div>

            {history.movements.length === 0 ? (
              <div className="empty-state">No movement history yet for this equipment.</div>
            ) : (
              <div className="premium-timeline">
                {history.movements.map((move) => (
                  <div className="timeline-row" key={move.id}>
                    <div className="timeline-pin"></div>

                    <div className="timeline-card">
                      <div className="timeline-top">
                        <strong>
                          {move.from_site || "Not Available"} {" -> "} {move.to_site}
                        </strong>
                        <span>{move.movement_type}</span>
                      </div>

                      <p>{move.remarks || "No remarks added."}</p>

                      <div className="timeline-meta-grid">
                        <span>Date: {formatDate(move.movement_datetime)}</span>
                        <span>Updated by: {move.updated_by || "N/A"}</span>
                        <span>Handed over: {move.handed_over_by || "N/A"}</span>
                        <span>Received by: {move.received_by || "N/A"}</span>
                        <span>Stayed: {move.stayed_days_at_to_site} days</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
