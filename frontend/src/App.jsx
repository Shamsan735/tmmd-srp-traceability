import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev";
const AUTH_STORAGE_KEY = "tmmd_srp_auth";

function getInitialAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function createAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "⌂" },
  { id: "movement", label: "Movement Entry", icon: "⇄" },
  { id: "traceability", label: "Traceability", icon: "◎" },
  { id: "assets", label: "Asset Master", icon: "▦" },
  { id: "calibration", label: "Calibration", icon: "◷" },
  { id: "pm", label: "PM / Checklist", icon: "☑" },
  { id: "reports", label: "Reports", icon: "↧" },
];

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload?.[key] && Array.isArray(payload[key])) return payload[key];
  if (payload?.data && Array.isArray(payload.data)) return payload.data;
  return [];
}

function pickId(row) {
  return row?.id ?? row?.asset_id ?? row?.site_id ?? "";
}

function getSiteName(site) {
  return site?.site_name || site?.name || site?.location || site?.site || "Unknown Site";
}

function getAssetName(asset) {
  return asset?.equipment_name || asset?.asset_name || asset?.name || asset?.equipment || "Unnamed Asset";
}

function getAssetSerial(asset) {
  return asset?.serial_number || asset?.identification_number || asset?.equipment_no || asset?.tag_number || "-";
}

function daysUntilExpiry(asset) {
  const value = asset?.days_until_expiry ?? asset?.daysUntilExpiry ?? asset?.expiry_days;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCurrentSiteName(asset, sites) {
  if (asset?.current_site_name) return asset.current_site_name;
  if (asset?.site_name) return asset.site_name;
  if (asset?.current_location) return asset.current_location;
  if (asset?.current_site) return asset.current_site;
  if (asset?.location) return asset.location;
  const currentSiteId = asset?.current_site_id ?? asset?.site_id;
  const site = sites.find((item) => String(pickId(item)) === String(currentSiteId));
  return site ? getSiteName(site) : "Not assigned";
}

function statusFromDays(days) {
  if (days === null) return { label: "No Expiry", className: "neutral" };
  if (days <= 7) return { label: "Critical", className: "danger" };
  if (days <= 15) return { label: "Warning", className: "warning" };
  return { label: "Valid", className: "success" };
}

function csvSafe(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvSafe).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [assets, setAssets] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState("Checking");
  const [auth, setAuth] = useState(getInitialAuth);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [destinationSiteId, setDestinationSiteId] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);
  const [movementMessage, setMovementMessage] = useState("");
  const [traceQuery, setTraceQuery] = useState("");
  const [traceAsset, setTraceAsset] = useState(null);
  const [traceHistory, setTraceHistory] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);

  async function loadData() {
    if (!auth?.token) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const authHeaders = createAuthHeaders(auth.token);

      const [healthRes, assetsRes, sitesRes] = await Promise.all([
        fetch(`${API_BASE}/api/health`),
        fetch(`${API_BASE}/api/assets`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/sites`, { headers: authHeaders }),
      ]);

      if (assetsRes.status === 401 || sitesRes.status === 401) {
        throw new Error("Unauthorized");
      }

      setApiStatus(healthRes.ok ? "Live" : "Issue");

      const assetsJson = await assetsRes.json();
      const sitesJson = await sitesRes.json();

      setAssets(normalizeList(assetsJson, "assets"));
      setSites(normalizeList(sitesJson, "sites"));
    } catch (error) {
      console.error(error);
      setApiStatus("Offline");

      if (error.message === "Unauthorized") {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.token) {
        throw new Error(result?.message || "Login failed");
      }

      const nextAuth = {
        token: result.token,
        user: result.user || { name: "System Admin", role: "Administrator" },
      };

      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
      setAuth(nextAuth);
      setLoginForm({ username: "", password: "" });
    } catch (error) {
      console.error(error);
      setLoginError(error.message || "Invalid username or password");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuth(null);
    setAssets([]);
    setSites([]);
    setActiveTab("dashboard");
  }

  useEffect(() => {
    if (auth?.token) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [auth?.token]);

  const selectedAsset = useMemo(() => {
    return assets.find((asset) => String(pickId(asset)) === String(selectedAssetId));
  }, [assets, selectedAssetId]);

  const filteredAssets = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((asset) => {
      const text = [
        getAssetName(asset),
        getAssetSerial(asset),
        getCurrentSiteName(asset, sites),
        asset?.category,
        asset?.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(term);
    });
  }, [assets, query, sites]);

  const dashboardData = useMemo(() => {
    const critical = assets.filter((asset) => {
      const days = daysUntilExpiry(asset);
      return days !== null && days <= 7;
    });

    const warning = assets.filter((asset) => {
      const days = daysUntilExpiry(asset);
      return days !== null && days > 7 && days <= 15;
    });

    const valid = assets.filter((asset) => {
      const days = daysUntilExpiry(asset);
      return days !== null && days > 15;
    });

    const distributionMap = new Map();
    assets.forEach((asset) => {
      const siteName = getCurrentSiteName(asset, sites);
      distributionMap.set(siteName, (distributionMap.get(siteName) || 0) + 1);
    });

    const distribution = [...distributionMap.entries()]
      .map(([site, total]) => ({ site, total }))
      .sort((a, b) => b.total - a.total);

    const expirySorted = [...assets]
      .filter((asset) => daysUntilExpiry(asset) !== null)
      .sort((a, b) => daysUntilExpiry(a) - daysUntilExpiry(b));

    return { critical, warning, valid, distribution, expirySorted };
  }, [assets, sites]);

  async function saveMovement(e) {
    e.preventDefault();

    if (!selectedAssetId || !destinationSiteId) {
      setMovementMessage("Please select asset and destination site.");
      return;
    }

    setSavingMovement(true);
    setMovementMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/movements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders(auth?.token),
        },
        body: JSON.stringify({
          asset_id: selectedAssetId,
          to_site_id: destinationSiteId,
          movement_datetime: new Date().toISOString(),
          movement_type: "TRANSFER",
          remarks: movementNote || null,
          handed_over_by: "System Admin",
          received_by: "Destination Receiver",
          updated_by_user_id: null,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (response.status === 401) {
        handleLogout();
        throw new Error("Session expired. Please login again.");
      }

      if (!response.ok) {
        throw new Error(result?.message || result?.error || "Movement save failed");
      }

      setMovementMessage("Movement saved successfully. Current location updated.");
      setMovementNote("");
      setDestinationSiteId("");
      await loadData();
    } catch (error) {
      console.error(error);
      setMovementMessage(error.message || "Unable to save movement.");
    } finally {
      setSavingMovement(false);
    }
  }

  async function runTraceSearch(e) {
    e?.preventDefault();
    const term = traceQuery.trim();

    if (!term || !auth?.token) return;

    setTraceLoading(true);
    setTraceAsset(null);
    setTraceHistory([]);

    try {
      const authHeaders = createAuthHeaders(auth.token);

      const searchRes = await fetch(`${API_BASE}/api/assets/search?q=${encodeURIComponent(term)}`, {
        headers: authHeaders,
      });

      if (searchRes.status === 401) {
        handleLogout();
        return;
      }

      const searchJson = await searchRes.json();
      const results = normalizeList(searchJson, "assets");
      const asset = results[0];

      if (!asset) {
        setTraceLoading(false);
        return;
      }

      setTraceAsset(asset);

      const assetId = pickId(asset);
      const historyRes = await fetch(`${API_BASE}/api/assets/${assetId}/history`, {
        headers: authHeaders,
      });

      if (historyRes.status === 401) {
        handleLogout();
        return;
      }

      const historyJson = await historyRes.json();
      setTraceAsset(historyJson?.data?.asset || asset);
      setTraceHistory(historyJson?.data?.movements || normalizeList(historyJson, "history"));
    } catch (error) {
      console.error(error);
    } finally {
      setTraceLoading(false);
    }
  }

  if (!auth?.token) {
    return (
      <LoginScreen
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginError={loginError}
        loginLoading={loginLoading}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandMark">T</div>
          <div>
            <h1>TMMD & SRP</h1>
            <p>Traceability Command</p>
          </div>
        </div>

        <nav className="navList">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`navButton ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebarFooter">
          <span className={`pulse ${apiStatus.toLowerCase()}`} />
          <div>
            <strong>Backend {apiStatus}</strong>
            <small>Cloudflare Worker + D1</small>
          </div>
        </div>
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div>
            <p className="eyebrow">Client Demo Portal</p>
            <h2>{navItems.find((item) => item.id === activeTab)?.label}</h2>
          </div>

          <div className="topActions">
            <button className="ghostButton" onClick={loadData}>Refresh Data</button>
            <button className="ghostButton" onClick={handleLogout}>Logout</button>
            <button className="primaryButton" onClick={() => setActiveTab("movement")}>New Movement</button>
          </div>
        </header>

        {activeTab === "dashboard" && (
          <section className="pageGrid">
            <div className="dashboardIntro">
              <div>
                <p className="eyebrow">Executive Overview</p>
                <h3>TMMD & SRP Asset Visibility Dashboard</h3>
                <p>
                  Compact operational overview for asset location, expiry attention, and traceability status.
                </p>
              </div>

              <div className="summaryChips">
                <div className="summaryChip">
                  <span>Database</span>
                  <strong>Live</strong>
                </div>
                <div className="summaryChip">
                  <span>Assets</span>
                  <strong>{assets.length}</strong>
                </div>
                <div className="summaryChip">
                  <span>Sites</span>
                  <strong>{sites.length}</strong>
                </div>
              </div>
            </div>

            <div className="kpiGrid">
              <Kpi title="Total Assets" value={assets.length} note="Tracked equipment register" />
              <Kpi title="Critical Expiry" value={dashboardData.critical.length} note="Immediate attention needed" tone="danger" />
              <Kpi title="Warning Expiry" value={dashboardData.warning.length} note="Upcoming expiry attention" tone="warning" />
              <Kpi title="Active Sites" value={sites.length} note="Current deployed locations" tone="success" />
            </div>

            <div className="twoColumn">
              <Panel title="Critical Expiry Watchlist" action={`${dashboardData.expirySorted.slice(0, 6).length} items`}>
                <div className="watchList">
                  {dashboardData.expirySorted.slice(0, 6).map((asset) => {
                    const days = daysUntilExpiry(asset);
                    const status = statusFromDays(days);
                    return (
                      <div className="watchItem" key={pickId(asset)}>
                        <div>
                          <strong>{getAssetName(asset)}</strong>
                          <span>{getAssetSerial(asset)} • {getCurrentSiteName(asset, sites)}</span>
                        </div>
                        <span className={`badge ${status.className}`}>
                          {days === null ? "N/A" : `${days} days`}
                        </span>
                      </div>
                    );
                  })}
                  {!dashboardData.expirySorted.length && <Empty text="No expiry data available." />}
                </div>
              </Panel>

              <Panel title="Location Distribution" action={`${dashboardData.distribution.length} locations`}>
                <div className="barList">
                  {dashboardData.distribution.slice(0, 6).map((item) => {
                    const width = assets.length ? Math.max(10, (item.total / assets.length) * 100) : 0;
                    return (
                      <div className="barItem" key={item.site}>
                        <div>
                          <span>{item.site}</span>
                          <strong>{item.total}</strong>
                        </div>
                        <div className="barTrack">
                          <div className="barFill" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {!dashboardData.distribution.length && <Empty text="No location distribution available." />}
                </div>
              </Panel>
            </div>

            <div className="twoColumn">
              <Panel title="Asset Register Snapshot" action={`${filteredAssets.slice(0, 6).length} shown`}>
                <input
                  className="searchInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search asset, identification no., or location..."
                />
                <AssetTable assets={filteredAssets.slice(0, 6)} sites={sites} compact />
              </Panel>

              <Panel title="Operational Summary" action="Live status">
                <div className="summaryGrid">
                  <div className="summaryBox">
                    <span>Critical</span>
                    <strong>{dashboardData.critical.length}</strong>
                    <small>0-7 days remaining</small>
                  </div>
                  <div className="summaryBox">
                    <span>Warning</span>
                    <strong>{dashboardData.warning.length}</strong>
                    <small>8-15 days remaining</small>
                  </div>
                  <div className="summaryBox">
                    <span>Valid</span>
                    <strong>{dashboardData.valid.length}</strong>
                    <small>15+ days remaining</small>
                  </div>
                  <div className="summaryBox">
                    <span>Status</span>
                    <strong>{apiStatus}</strong>
                    <small>Backend connectivity</small>
                  </div>
                </div>

                <div className="miniSection">
                  <h4>Top Locations</h4>
                  <div className="miniList">
                    {dashboardData.distribution.slice(0, 5).map((item) => (
                      <div className="miniListItem" key={item.site}>
                        <span>{item.site}</span>
                        <strong>{item.total}</strong>
                      </div>
                    ))}
                    {!dashboardData.distribution.length && <Empty text="No location stats yet." />}
                  </div>
                </div>
              </Panel>
            </div>
          </section>
        )}

        {activeTab === "movement" && (
          <section className="pageGrid">
            <div className="twoColumn">
              <Panel title="Movement Entry" action="Live location update">
                <form className="formGrid" onSubmit={saveMovement}>
                  <label>
                    Select Asset
                    <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}>
                      <option value="">Choose asset</option>
                      {assets.map((asset) => (
                        <option key={pickId(asset)} value={pickId(asset)}>
                          {getAssetName(asset)} — {getAssetSerial(asset)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Current Location
                    <input value={selectedAsset ? getCurrentSiteName(selectedAsset, sites) : ""} readOnly placeholder="Auto shown after asset selection" />
                  </label>

                  <label>
                    Destination Site
                    <select value={destinationSiteId} onChange={(e) => setDestinationSiteId(e.target.value)}>
                      <option value="">Choose destination</option>
                      {sites.map((site) => (
                        <option key={pickId(site)} value={pickId(site)}>
                          {getSiteName(site)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Movement Note
                    <input value={movementNote} onChange={(e) => setMovementNote(e.target.value)} placeholder="Optional note / reference" />
                  </label>

                  <button className="primaryButton wide" disabled={savingMovement}>
                    {savingMovement ? "Saving..." : "Save Movement"}
                  </button>

                  {movementMessage && <div className="messageBox">{movementMessage}</div>}
                </form>
              </Panel>

              <Panel title="Selected Asset Snapshot" action="Before saving">
                {selectedAsset ? (
                  <div className="assetProfile">
                    <div className="assetAvatar">EQ</div>
                    <div>
                      <h3>{getAssetName(selectedAsset)}</h3>
                      <p>{getAssetSerial(selectedAsset)}</p>
                      <div className="profileMeta">
                        <span>Current: {getCurrentSiteName(selectedAsset, sites)}</span>
                        <span>Expiry: {daysUntilExpiry(selectedAsset) ?? "N/A"} days</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Empty text="Select an asset to view movement snapshot." />
                )}
              </Panel>
            </div>
          </section>
        )}

        {activeTab === "traceability" && (
          <section className="pageGrid">
            <Panel title="Asset Traceability Search" action="History timeline">
              <form className="traceSearch" onSubmit={runTraceSearch}>
                <input
                  className="searchInput"
                  value={traceQuery}
                  onChange={(e) => setTraceQuery(e.target.value)}
                  placeholder="Enter identification number e.g. GRD-1001"
                />
                <button className="primaryButton" disabled={traceLoading}>
                  {traceLoading ? "Searching..." : "Search History"}
                </button>
              </form>
            </Panel>

            <div className="twoColumn">
              <Panel title="Asset Profile" action="Current record">
                {traceAsset ? (
                  <div className="assetProfile vertical">
                    <div className="assetAvatar">SRP</div>
                    <h3>{getAssetName(traceAsset)}</h3>
                    <p>{getAssetSerial(traceAsset)}</p>
                    <div className="profileMeta">
                      <span>Current Location: {getCurrentSiteName(traceAsset, sites)}</span>
                      <span>Days Until Expiry: {daysUntilExpiry(traceAsset) ?? "N/A"}</span>
                    </div>
                  </div>
                ) : (
                  <Empty text="Search asset identification number to load profile." />
                )}
              </Panel>

              <Panel title="Movement Timeline" action={`${traceHistory.length} record(s)`}>
                <div className="timeline">
                  {traceHistory.map((item, index) => (
                    <div className="timelineItem" key={item.id || index}>
                      <span className="timelineDot" />
                      <div>
                        <strong>{item.from_site_name || item.from_location || "Previous Site"} → {item.to_site_name || item.to_location || "New Site"}</strong>
                        <p>{item.movement_date || item.created_at || "Date not available"}</p>
                        <small>{item.notes || item.stayed_duration || "Movement recorded in audit trail"}</small>
                      </div>
                    </div>
                  ))}
                  {!traceHistory.length && <Empty text="No movement history loaded yet." />}
                </div>
              </Panel>
            </div>
          </section>
        )}

        {activeTab === "assets" && (
          <section className="pageGrid">
            <Panel title="Asset Master Register" action={`${filteredAssets.length} asset(s)`}>
              <input
                className="searchInput"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter asset master..."
              />
              <AssetTable assets={filteredAssets} sites={sites} />
            </Panel>
          </section>
        )}

        {activeTab === "calibration" && (
          <PlaceholderPage
            title="Calibration Control"
            subtitle="Next phase module for calibration certificates, expiry proof, attachments, and compliance status."
            cards={[
              "Calibration expiry dashboard",
              "Certificate upload after R2 activation",
              "Due / overdue alerts",
              "Asset-wise calibration history",
            ]}
          />
        )}

        {activeTab === "pm" && (
          <PlaceholderPage
            title="PM / Checklist Control"
            subtitle="Professional placeholder for preventive maintenance and checklist records."
            cards={[
              "Monthly / 3-month PM frequency",
              "Equipment checklist by ID",
              "Inspection result tracking",
              "Photo proof after R2 activation",
            ]}
          />
        )}

        {activeTab === "reports" && (
          <section className="pageGrid">
            <div className="dashboardIntro">
              <div>
                <p className="eyebrow">Export Center</p>
                <h3>Reports & Download Center</h3>
                <p>
                  Download client-ready CSV reports for asset master, expiry visibility, and location summary.
                </p>
              </div>

              <div className="summaryChips">
                <div className="summaryChip">
                  <span>Assets</span>
                  <strong>{assets.length}</strong>
                </div>
                <div className="summaryChip">
                  <span>Critical</span>
                  <strong>{dashboardData.critical.length}</strong>
                </div>
                <div className="summaryChip">
                  <span>Sites</span>
                  <strong>{sites.length}</strong>
                </div>
              </div>
            </div>

            <div className="reportGrid">
              <div className="reportCard">
                <span>01</span>
                <h4>Asset Master Report</h4>
                <p>Complete equipment list with identification number, current location, expiry days, and status.</p>
                <button className="primaryButton" onClick={exportAssetsCsv}>Download CSV</button>
              </div>

              <div className="reportCard">
                <span>02</span>
                <h4>Expiry Visibility Report</h4>
                <p>Sorted expiry report showing critical, warning, valid, and no-expiry equipment records.</p>
                <button className="primaryButton" onClick={exportExpiryCsv}>Download CSV</button>
              </div>

              <div className="reportCard">
                <span>03</span>
                <h4>Location Summary Report</h4>
                <p>Site-wise asset distribution summary for operational visibility and management review.</p>
                <button className="primaryButton" onClick={exportLocationCsv}>Download CSV</button>
              </div>
            </div>
          </section>
        )}

        {loading && <div className="loadingOverlay">Loading live data...</div>}
      </main>
    </div>
  );
}

function LoginScreen({ loginForm, setLoginForm, loginError, loginLoading, onLogin }) {
  return (
    <div className="loginPage">
      <div className="loginGlow loginGlowOne" />
      <div className="loginGlow loginGlowTwo" />

      <div className="loginShell">
        <section className="loginVisual">
          <div className="loginVisualInner">
            <p className="eyebrow">Enterprise Access Portal</p>
            <h1>Secure Traceability Portal</h1>
            <p className="loginLead">
              Securely access executive dashboards, movement control, traceability history,
              asset registers, and downloadable operational reports from one command center.
            </p>

            <div className="loginHighlights">
              <div className="loginHighlightCard">
                <strong>Authorized Access</strong>
                <span>Access is restricted to approved users only.</span>
              </div>

              <div className="loginHighlightCard">
                <strong>Protected Dashboard</strong>
                <span>Dashboard and reports are available after successful login.</span>
              </div>

              <div className="loginHighlightCard">
                <strong>Audit Ready System</strong>
                <span>Operational records remain behind secure authentication.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="loginCardWrap">
          <div className="loginCard">
            <div className="loginBrand">
              <div className="brandMark">T</div>
              <div>
                <h1>TMMD & SRP</h1>
                <p>Management & Traceability System</p>
              </div>
            </div>

            <div className="loginHeader">
              <p className="eyebrow">Secure Access</p>
              <h2>Login to Command Center</h2>
              <p>
                Enter your authorized credentials to access dashboard, reports,
                movements, and traceability records.
              </p>
            </div>

            <form className="loginForm" onSubmit={onLogin}>
              <label>
                Username
                <input
                  value={loginForm.username}
                  onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
                  placeholder="Enter username"
                  autoComplete="username"
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
              </label>

              {loginError && <div className="loginError">{loginError}</div>}

              <button className="primaryButton wide" disabled={loginLoading}>
                {loginLoading ? "Signing in..." : "Login"}
              </button>
            </form>

            <div className="loginFooterNote">
              Authorized personnel only • Secure operational access
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ title, value, note, tone = "" }) {
  return (
    <div className={`kpiCard ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h3>{title}</h3>
        {action && <span>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function AssetTable({ assets, sites, compact = false }) {
  return (
    <div className="tableWrap">
      <table className={compact ? "compactTable" : ""}>
        <thead>
          <tr>
            <th>Equipment</th>
            <th>Identification No.</th>
            <th>Current Location</th>
            <th>Expiry</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const days = daysUntilExpiry(asset);
            const status = statusFromDays(days);
            return (
              <tr key={pickId(asset)}>
                <td><strong>{getAssetName(asset)}</strong></td>
                <td>{getAssetSerial(asset)}</td>
                <td>{getCurrentSiteName(asset, sites)}</td>
                <td>{days === null ? "N/A" : `${days} days`}</td>
                <td><span className={`badge ${status.className}`}>{status.label}</span></td>
              </tr>
            );
          })}
          {!assets.length && (
            <tr>
              <td colSpan="5">
                <Empty text="No assets found." />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }) {
  return <div className="emptyState">{text}</div>;
}

function PlaceholderPage({ title, subtitle, cards }) {
  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Next Phase Ready</p>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="placeholderGrid">
        {cards.map((card) => (
          <div className="placeholderCard" key={card}>
            <span>◇</span>
            <strong>{card}</strong>
            <p>Structured module panel ready for backend expansion.</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default App;








