import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8787";

function App() {
  const [sites, setSites] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [history, setHistory] = useState(null);
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

  async function handleMovementSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const payload = {
        ...movementForm,
        asset_id: Number(movementForm.asset_id),
        to_site_id: Number(movementForm.to_site_id),
        movement_datetime: movementForm.movement_datetime,
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
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Cloud-Based Web System</p>
          <h1>TMMD & SRP Management and Traceability System</h1>
          <p className="subtitle">
            Live equipment movement, current location tracking, audit trail, and full history traceability.
          </p>
        </div>
        <div className="status-pill">API Connected</div>
      </header>

      {message && <div className="message">{message}</div>}

      <section className="stats-grid">
        <div className="stat-card">
          <span>Total Assets</span>
          <strong>{assets.length}</strong>
        </div>
        <div className="stat-card">
          <span>Total Sites</span>
          <strong>{sites.length}</strong>
        </div>
        <div className="stat-card">
          <span>Remote Sites</span>
          <strong>{sites.filter((site) => site.is_remote).length}</strong>
        </div>
        <div className="stat-card">
          <span>System Mode</span>
          <strong>Demo</strong>
        </div>
      </section>

      <main className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Equipment Movement Entry</h2>
              <p>Move equipment from current site to new site. Current location updates automatically.</p>
            </div>
          </div>

          <form className="form-grid" onSubmit={handleMovementSubmit}>
            <label>
              Equipment
              <select
                value={movementForm.asset_id}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    asset_id: e.target.value,
                  }))
                }
                required
              >
                <option value="">Select equipment</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.equipment_name} — {asset.serial_number}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Current / From Site
              <input
                value={selectedMovementAsset?.current_location || "Select equipment first"}
                disabled
              />
            </label>

            <label>
              To Site
              <select
                value={movementForm.to_site_id}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    to_site_id: e.target.value,
                  }))
                }
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
              Movement Date & Time
              <input
                type="datetime-local"
                value={movementForm.movement_datetime}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    movement_datetime: e.target.value,
                  }))
                }
                required
              />
            </label>

            <label>
              Movement Type
              <select
                value={movementForm.movement_type}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    movement_type: e.target.value,
                  }))
                }
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
              Handed Over By
              <input
                value={movementForm.handed_over_by}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    handed_over_by: e.target.value,
                  }))
                }
                placeholder="Store Keeper / Sender"
              />
            </label>

            <label>
              Received By
              <input
                value={movementForm.received_by}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    received_by: e.target.value,
                  }))
                }
                placeholder="Receiver name"
              />
            </label>

            <label className="full-width">
              Remarks
              <textarea
                value={movementForm.remarks}
                onChange={(e) =>
                  setMovementForm((prev) => ({
                    ...prev,
                    remarks: e.target.value,
                  }))
                }
                placeholder="Add movement remarks..."
              />
            </label>

            <div className="full-width upload-note">
              Proof photo upload will be added after R2 storage activation. Images will be compressed before upload.
            </div>

            <button className="primary-btn full-width" disabled={loading}>
              {loading ? "Saving..." : "Save Movement & Update Location"}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Traceability Search</h2>
              <p>Search by equipment name, asset code, or identification / serial number.</p>
            </div>
          </div>

          <form className="search-row" onSubmit={handleSearch}>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Example: GRD-1001"
            />
            <button className="secondary-btn">Search</button>
          </form>

          <div className="quick-list">
            {assets.map((asset) => (
              <button
                key={asset.id}
                className={String(selectedAssetId) === String(asset.id) ? "quick-item active" : "quick-item"}
                onClick={() => loadAssetHistory(asset.id)}
              >
                <span>{asset.equipment_name}</span>
                <small>{asset.serial_number}</small>
              </button>
            ))}
          </div>
        </section>
      </main>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Equipment Current Location</h2>
            <p>Live location is updated from movement entries.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Identification No.</th>
                <th>Asset Code</th>
                <th>Category</th>
                <th>Expiry Days</th><th>Current Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.equipment_name}</td>
                  <td>{asset.serial_number}</td>
                  <td>{asset.asset_code}</td>
                  <td>{asset.category}</td>
                  <td><span className={asset.days_until_expiry === null || asset.days_until_expiry === undefined ? "expiry-badge neutral" : Number(asset.days_until_expiry) <= 7 ? "expiry-badge critical" : Number(asset.days_until_expiry) <= 30 ? "expiry-badge warning" : "expiry-badge safe"}>{asset.days_until_expiry ?? "-"}</span></td><td>{asset.current_location}</td>
                  <td>
                    <span className="badge">{asset.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {history && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Full Movement History</h2>
              <p>
                {history.asset.equipment_name} — {history.asset.serial_number}
              </p>
            </div>
            <div className="location-box">
              Current Location: <strong>{history.asset.current_location}</strong>
            </div>
          </div>

          {history.movements.length === 0 ? (
            <div className="empty-state">No movement history yet.</div>
          ) : (
            <div className="timeline">
              {history.movements.map((move) => (
                <div className="timeline-item" key={move.id}>
                  <div className="timeline-dot" />
                  <div className="timeline-content">
                    <div className="timeline-title">
                      {move.from_site || "Not Available"} {" -> "} {move.to_site}
                    </div>
                    <div className="timeline-meta">
                      {move.movement_datetime} • {move.movement_type} • Updated by {move.updated_by || "N/A"}
                    </div>
                    <p>{move.remarks || "No remarks"}</p>
                    <div className="timeline-extra">
                      <span>Handed over by: {move.handed_over_by || "N/A"}</span>
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
    </div>
  );
}

export default App;





