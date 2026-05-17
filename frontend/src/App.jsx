import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import "./App.css";

const API_BASE = "https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev";
const APP_TIME_ZONE = "Asia/Dubai";
const APP_TIME_ZONE_LABEL = "UAE Time";
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
  { id: "dashboard", label: "Dashboard", icon: "D" },
  { id: "movement", label: "Movement Entry", icon: "M" },
  { id: "traceability", label: "Traceability", icon: "T" },
  { id: "assets", label: "Asset Master", icon: "A" },
  { id: "sites", label: "Site Master", icon: "S" },
  { id: "calibration", label: "Calibration", icon: "C" },
  { id: "pm", label: "PM / Checklist", icon: "P" },
  { id: "repair", label: "Asset Repair", icon: "R" },
  { id: "reports", label: "Reports", icon: "R" },
  { id: "import", label: "Excel Import", icon: "X" },
  { id: "settings", label: "Settings", icon: "S" },
];

const ROLE_TAB_ACCESS = {
  Admin: ["dashboard", "movement", "traceability", "assets", "sites", "calibration", "pm", "repair", "reports", "import", "settings"],
  Store: ["dashboard", "movement", "traceability", "sites", "repair", "reports"],
  Operator: ["dashboard", "movement", "traceability", "pm"],
  Viewer: ["dashboard", "traceability"],
};

function normalizeUserRole(role) {
  const value = String(role || "").trim().toLowerCase();

  if (value === "admin" || value === "administrator") return "Admin";
  if (value === "store" || value === "store user") return "Store";
  if (value === "operator") return "Operator";
  if (value === "viewer" || value === "viewer/auditor") return "Viewer";

  return "Viewer";
}

function getAllowedTabsForRole(role) {
  return ROLE_TAB_ACCESS[normalizeUserRole(role)] || ROLE_TAB_ACCESS.Viewer;
}

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

function normalizeDashboardDateValue(value) {
  if (value === null || value === undefined) return "";

  const convertExcelSerial = (serialValue) => {
    const serial = Number(serialValue);
    if (!Number.isFinite(serial) || serial < 25000 || serial > 70000) return "";
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsed = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  };

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return convertExcelSerial(value);
  }

  const text = String(value).trim();
  if (!text) return "";

  // Excel serials imported as +046416-01, +046052-01, +045873-01
  const plusSerialMatch = text.match(/^\+?0*(\d{5})(?:-\d+)?$/);
  if (plusSerialMatch) {
    const converted = convertExcelSerial(plusSerialMatch[1]);
    if (converted) return converted;
  }

  // Plain Excel serial text only if it is 5 digits and inside realistic Excel serial range
  const plainSerialMatch = text.match(/^0*(\d{5})$/);
  if (plainSerialMatch) {
    const converted = convertExcelSerial(plainSerialMatch[1]);
    if (converted) return converted;
  }

  // YYYY-MM-DD only
  const ymd = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    if (year >= 2000 && year <= 2100) {
      return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmy) {
    const yearText = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
    const year = Number(yearText);
    if (year >= 2000 && year <= 2100) {
      return `${yearText}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }
  }

  // Avoid JS parsing equipment numbers like 2511-PG/01 as future dates
  return "";
}

function daysUntilDateValue(value) {
  const normalizedDate = normalizeDashboardDateValue(value);
  if (!normalizedDate) return null;

  const parsedDate = new Date(normalizedDate);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  parsedDate.setHours(0, 0, 0, 0);

  const days = Math.ceil((parsedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // Client equipment max validity is around 3 years, so ignore impossible dates
  if (!Number.isFinite(days) || days < -3650 || days > 2000) return null;

  return days;
}

function getAssetCalibrationDays(asset, calibrationRecords) {
  const assetId = String(pickId(asset) ?? asset?.id ?? "").trim();

  const relatedRecords = calibrationRecords
    .filter((record) => String(record?.asset_id ?? "").trim() === assetId)
    .map((record) => ({
      ...record,
      expiryDays: daysUntilDateValue(record?.expiry_date || record?.calibration_expiry_date || record?.due_date),
    }))
    .filter((record) => record.expiryDays !== null)
    .sort((a, b) => a.expiryDays - b.expiryDays);

  if (relatedRecords.length) return relatedRecords[0].expiryDays;

  return daysUntilExpiry(asset);
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

function getPmDashboardStatus(asset) {
  const statusText = String(
    asset?.pm_status ||
    asset?.pmStatus ||
    asset?.checklist_status ||
    asset?.status ||
    ""
  ).toLowerCase();

  const frequencyText = String(
    asset?.pm_frequency ||
    asset?.frequency ||
    asset?.maintenance_frequency ||
    ""
  ).toLowerCase();

  const nextPmDate =
    asset?.next_pm_due_date ||
    asset?.next_pm_due ||
    asset?.pm_due_date ||
    asset?.next_pm_date ||
    asset?.next_due_date;

  const lastPmDate =
    asset?.last_pm_date ||
    asset?.pm_date ||
    asset?.inspection_date ||
    asset?.checklist_date;

  const dueDays = daysUntilDateValue(nextPmDate);

  if (statusText.includes("overdue") || statusText.includes("expired") || (dueDays !== null && dueDays < 0)) {
    return "overdue";
  }

  if (dueDays !== null && dueDays <= 10) {
    return "dueSoon";
  }

  if (statusText.includes("valid") || statusText.includes("completed") || statusText.includes("ok") || (dueDays !== null && dueDays > 10)) {
    return "valid";
  }

  if (!frequencyText || frequencyText.includes("not applicable") || (!nextPmDate && !lastPmDate)) {
    return "missing";
  }

  return "missing";
}

function isCalibrationGeneratedPmRecord(record) {
  const checklistName = String(record?.checklist_name || "").toLowerCase();
  const attachment = String(record?.attachment_ref || record?.file_name || "").toLowerCase();
  const remarks = String(record?.remarks || "").toLowerCase();

  return (
    checklistName.includes("imported calibration master") ||
    checklistName.includes("calibration master pm") ||
    checklistName.includes("calibration certificate") ||
    attachment.includes("master calibration") ||
    remarks.includes("master calibration")
  );
}

function getCleanPmRecords(records) {
  return normalizeList(records, "checklist_records").filter((record) => {
    const checklistType = String(record?.checklist_type || "").toLowerCase();
    if (checklistType && checklistType !== "pm") return false;
    return !isCalibrationGeneratedPmRecord(record);
  });
}

function getDashboardPmFrequencyMonths(value) {
  const text = String(value || "").toLowerCase().trim();

  if (!text) return null;
  if (text.includes("monthly")) return 1;
  if (text.includes("quarter") || text.includes("3 month") || text.includes("3-month")) return 3;
  if (text.includes("6 month") || text.includes("6-month")) return 6;
  if (text.includes("annual") || text.includes("year") || text.includes("12 month")) return 12;

  const numeric = Number(text.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0 && numeric <= 36) return Math.round(numeric);

  return null;
}

function addDashboardMonths(dateValue, months) {
  if (!dateValue || !months) return "";

  const normalizedDate = typeof normalizeDashboardDateValue === "function"
    ? normalizeDashboardDateValue(dateValue)
    : String(dateValue || "");

  if (!normalizedDate) return "";

  const date = new Date(normalizedDate);
  if (Number.isNaN(date.getTime())) return "";

  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function isDashboardCalibrationGeneratedPmRecord(record) {
  const checklistName = String(record?.checklist_name || "").toLowerCase();
  const attachment = String(record?.attachment_ref || record?.file_name || "").toLowerCase();
  const remarks = String(record?.remarks || "").toLowerCase();

  const helperResult = typeof isCalibrationGeneratedPmRecord === "function"
    ? isCalibrationGeneratedPmRecord(record)
    : false;

  return helperResult ||
    checklistName.includes("imported calibration master") ||
    checklistName.includes("calibration master pm") ||
    attachment.includes("master calibration") ||
    remarks.includes("master calibration");
}

function getPmDashboardRecordDueDate(record) {
  if (record?.next_due_date) return record.next_due_date;

  const checklistDate = record?.checklist_date || record?.inspection_date || record?.pm_date;
  const months = getDashboardPmFrequencyMonths(record?.pm_frequency || record?.frequency);

  return addDashboardMonths(checklistDate, months);
}

function getPmDashboardRecordStatus(record) {
  const existing = String(record?.result || record?.status || "").toLowerCase();

  if (existing.includes("overdue")) return "overdue";
  if (existing.includes("due within")) return "dueSoon";

  const nextDueDate = getPmDashboardRecordDueDate(record);
  const days = daysUntilDateValue(nextDueDate);

  if (days !== null && days < 0) return "overdue";
  if (days !== null && days <= 10) return "dueSoon";
  if (days !== null && days > 10) return "valid";

  if (existing.includes("valid") || existing.includes("completed") || existing.includes("pass") || existing.includes("ok")) {
    return "valid";
  }

  return "missing";
}

function getPmRecordSortScore(record) {
  const dateValue =
    getPmDashboardRecordDueDate(record) ||
    record?.checklist_date ||
    record?.inspection_date ||
    record?.pm_date ||
    record?.created_at;

  const normalizedDate = typeof normalizeDashboardDateValue === "function"
    ? normalizeDashboardDateValue(dateValue)
    : String(dateValue || "");

  const time = normalizedDate ? new Date(normalizedDate).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function buildPmDashboardDataFromChecklistRecords(assets, checklistRecords) {
  const rawRecords = Array.isArray(checklistRecords) ? checklistRecords : [];

  const cleanRecords = rawRecords.filter((record) => {
    const checklistType = String(record?.checklist_type || "").toLowerCase();
    if (checklistType && checklistType !== "pm") return false;
    return !isDashboardCalibrationGeneratedPmRecord(record);
  });

  const latestRecordByAsset = new Map();

  cleanRecords.forEach((record) => {
    const assetId = String(record?.asset_id || "").trim();
    if (!assetId) return;

    const existing = latestRecordByAsset.get(assetId);
    if (!existing || getPmRecordSortScore(record) >= getPmRecordSortScore(existing)) {
      latestRecordByAsset.set(assetId, record);
    }
  });

  const result = {
    valid: [],
    dueSoon: [],
    overdue: [],
    missing: [],
  };

  assets.forEach((asset) => {
    const assetId = String(pickId(asset) ?? asset?.id ?? "").trim();
    const record = latestRecordByAsset.get(assetId);

    if (!record) {
      result.missing.push(asset);
      return;
    }

    const status = getPmDashboardRecordStatus(record);

    if (status === "overdue") result.overdue.push(asset);
    else if (status === "dueSoon") result.dueSoon.push(asset);
    else if (status === "valid") result.valid.push(asset);
    else result.missing.push(asset);
  });

  return result;
}

function getCurrentCalibrationRecords(records) {
  const list = Array.isArray(records) ? records : normalizeList(records, "calibration_records");
  const latestByAsset = new Map();

  function safeDateTime(value) {
    if (!value) return 0;

    let normalized = "";
    if (typeof normalizeDashboardDateValue === "function") {
      normalized = normalizeDashboardDateValue(value);
    }

    if (!normalized) {
      normalized = String(value || "").trim();
    }

    const parsed = new Date(normalized);
    const time = parsed.getTime();

    return Number.isFinite(time) ? time : 0;
  }

  list.forEach((record) => {
    const key = String(
      record?.asset_id ||
      record?.serial_number ||
      record?.identification_number ||
      record?.equipment_no ||
      record?.tag_number ||
      [record?.equipment_name, record?.certificate_number].filter(Boolean).join("::")
    ).trim();

    if (!key) return;

    const existing = latestByAsset.get(key);

    const recordTime =
      safeDateTime(record?.expiry_date) ||
      safeDateTime(record?.calibration_date) ||
      safeDateTime(record?.created_at) ||
      Number(record?.id || 0);

    const existingTime = existing
      ? (
          safeDateTime(existing?.expiry_date) ||
          safeDateTime(existing?.calibration_date) ||
          safeDateTime(existing?.created_at) ||
          Number(existing?.id || 0)
        )
      : -1;

    if (!existing || recordTime >= existingTime) {
      latestByAsset.set(key, record);
    }
  });

  return Array.from(latestByAsset.values())
    .sort((a, b) => {
      const left = safeDateTime(a?.expiry_date) || Number(a?.id || 0);
      const right = safeDateTime(b?.expiry_date) || Number(b?.id || 0);
      return left - right;
    });
}

function csvSafe(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}



function formatUaeDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "") + " UAE";
}

function formatUaeDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function xlsxDateStamp() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace(",", "") + " UAE";
}

function daysBetweenToday(dateValue) {
  if (!dateValue) return "";
  const today = new Date();
  const due = new Date(dateValue);
  if (Number.isNaN(due.getTime())) return "";
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function excelStatusStyle(statusText) {
  const text = String(statusText || "").toLowerCase();

  if (text.includes("due") || text.includes("fail")) {
    return { fill: { fgColor: { rgb: "FF0000" } }, font: { color: { rgb: "FFFFFF" }, bold: true } };
  }

  if (text.includes("pending") || text.includes("attention") || text.includes("critical")) {
    return { fill: { fgColor: { rgb: "FFC000" } }, font: { color: { rgb: "000000" }, bold: true } };
  }

  if (text.includes("ok") || text.includes("valid") || text.includes("pass") || text.includes("active")) {
    return { fill: { fgColor: { rgb: "70AD47" } }, font: { color: { rgb: "FFFFFF" }, bold: true } };
  }

  return { fill: { fgColor: { rgb: "D9EAF7" } }, font: { color: { rgb: "000000" }, bold: true } };
}

function styleReportWorksheet(ws, rangeRef, headerRowNumber, statusColumnLetter) {
  const border = {
    top: { style: "thin", color: { rgb: "7F7F7F" } },
    bottom: { style: "thin", color: { rgb: "7F7F7F" } },
    left: { style: "thin", color: { rgb: "7F7F7F" } },
    right: { style: "thin", color: { rgb: "7F7F7F" } },
  };

  const range = XLSX.utils.decode_range(rangeRef);

  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        ...(ws[cellAddress].s || {}),
        border,
        alignment: { vertical: "center", horizontal: row === headerRowNumber - 1 ? "center" : "left", wrapText: true },
        font: { name: "Calibri", sz: row === headerRowNumber - 1 ? 10 : 9, bold: row === headerRowNumber - 1 },
      };
    }
  }

  for (let col = range.s.c; col <= range.e.c; col++) {
    const headerCell = XLSX.utils.encode_cell({ r: headerRowNumber - 1, c: col });
    if (ws[headerCell]) {
      ws[headerCell].s = {
        ...(ws[headerCell].s || {}),
        fill: { fgColor: { rgb: "B4C6E7" } },
        font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "000000" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border,
      };
    }
  }

  if (statusColumnLetter) {
    for (let row = headerRowNumber + 1; row <= range.e.r + 1; row++) {
      const cellAddress = `${statusColumnLetter}${row}`;
      if (ws[cellAddress]) {
        ws[cellAddress].s = {
          ...(ws[cellAddress].s || {}),
          ...excelStatusStyle(ws[cellAddress].v),
          alignment: { horizontal: "center", vertical: "center" },
          border,
        };
      }
    }
  }

  ws["!autofilter"] = { ref: rangeRef };
}

function downloadStyledWorkbook(filename, sheetName, rows, options = {}) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!merges"] = options.merges || [];
  ws["!cols"] = options.cols || [];
  ws["!rows"] = options.rows || [];

  const rangeRef = XLSX.utils.encode_range({
    s: { r: options.headerRow - 1, c: 0 },
    e: { r: rows.length - 1, c: Math.max(...rows.map((row) => row.length)) - 1 },
  });

  styleReportWorksheet(ws, rangeRef, options.headerRow, options.statusColumn);

  if (ws["A1"]) {
    ws["A1"].s = {
      font: { name: "Calibri", sz: 16, bold: true, color: { rgb: "000000" } },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "E2F0D9" } },
    };
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
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

function pmStatusFromDueDate(nextDueDate) {
  if (!nextDueDate) return { label: "Not Applicable", className: "neutral", days: null };

  const today = new Date();
  const due = new Date(nextDueDate);

  if (Number.isNaN(due.getTime())) {
    return { label: "Not Applicable", className: "neutral", days: null };
  }

  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (days < 0) return { label: "PM Due", className: "danger", days };
  if (days <= 10) return { label: "PM Due Soon", className: "warning", days };
  return { label: "PM Valid", className: "success", days };
}

function getLatestPmRecord(records) {
  if (!Array.isArray(records) || !records.length) return null;

  return [...records].sort((a, b) => {
    const left = new Date(a.checklist_date || a.created_at || 0).getTime();
    const right = new Date(b.checklist_date || b.created_at || 0).getTime();
    return right - left;
  })[0];
}

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [assets, setAssets] = useState([]);
  const [sites, setSites] = useState([]);
  const [calibrationRecords, setCalibrationRecords] = useState([]);
  const [checklistRecords, setChecklistRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState("Checking");
  const [auth, setAuth] = useState(getInitialAuth);
  const userRole = normalizeUserRole(auth?.user?.role);
  const allowedTabIds = useMemo(() => auth?.user?.allowed_tabs?.length ? auth.user.allowed_tabs : getAllowedTabsForRole(userRole), [auth?.user?.allowed_tabs, userRole]);
  const canAccessTab = (tabId) => allowedTabIds.includes(tabId);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [destinationSiteId, setDestinationSiteId] = useState("");
  const [movementCategory, setMovementCategory] = useState("");
  const [movementEquipmentName, setMovementEquipmentName] = useState("");
  const [movementType, setMovementType] = useState("Mobilization");
  const [movementNote, setMovementNote] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);
  const [movementMessage, setMovementMessage] = useState("");
  const [traceQuery, setTraceQuery] = useState("");
  const [traceAsset, setTraceAsset] = useState(null);
  const [traceHistory, setTraceHistory] = useState([]);
  const [tracePmRecords, setTracePmRecords] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);

  async function loadData() {
    if (!auth?.token) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const authHeaders = createAuthHeaders(auth.token);

      const [healthRes, assetsRes, sitesRes, calibrationRes, checklistRes] = await Promise.all([
        fetch(`${API_BASE}/api/health`),
        fetch(`${API_BASE}/api/assets`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/sites`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/calibration-records`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/checklist-records`, { headers: authHeaders }),
      ]);

      if (assetsRes.status === 401 || sitesRes.status === 401 || calibrationRes.status === 401 || checklistRes.status === 401) {
        throw new Error("Unauthorized");
      }

      setApiStatus(healthRes.ok ? "Live" : "Issue");

      const assetsJson = await assetsRes.json();
      const sitesJson = await sitesRes.json();
      const calibrationJson = calibrationRes.ok ? await calibrationRes.json() : { calibration_records: [] };
      const checklistJson = checklistRes.ok ? await checklistRes.json() : { checklist_records: [] };

      setAssets(normalizeList(assetsJson, "assets"));
      setSites(normalizeList(sitesJson, "sites"));
      setCalibrationRecords(normalizeList(calibrationJson, "calibration_records"));
      setChecklistRecords(normalizeList(checklistJson, "checklist_records"));
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
    setCalibrationRecords([]);
    setChecklistRecords([]);
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


  const movementCategories = useMemo(() => {
    return Array.from(
      new Set(assets.map((asset) => asset?.category || "Uncategorized"))
    ).sort();
  }, [assets]);

  const movementEquipmentNames = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((asset) => !movementCategory || (asset?.category || "Uncategorized") === movementCategory)
          .map((asset) => getAssetName(asset))
      )
    ).sort();
  }, [assets, movementCategory]);

  const movementEquipmentNumbers = useMemo(() => {
    return assets.filter((asset) => {
      const categoryMatch = !movementCategory || (asset?.category || "Uncategorized") === movementCategory;
      const nameMatch = !movementEquipmentName || getAssetName(asset) === movementEquipmentName;
      return categoryMatch && nameMatch;
    });
  }, [assets, movementCategory, movementEquipmentName]);
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
      const days = getAssetCalibrationDays(asset, calibrationRecords);
      return days !== null && days <= 7;
    });

    const warning = assets.filter((asset) => {
      const days = getAssetCalibrationDays(asset, calibrationRecords);
      return days !== null && days > 7 && days <= 30;
    });

    const valid = assets.filter((asset) => {
      const days = getAssetCalibrationDays(asset, calibrationRecords);
      return days !== null && days > 30;
    });

    const noExpiry = assets.filter((asset) => getAssetCalibrationDays(asset, calibrationRecords) === null);

    const pmDashboard = buildPmDashboardDataFromChecklistRecords(assets, checklistRecords);
    const pmValid = pmDashboard.valid;
    const pmDueSoon = pmDashboard.dueSoon;
    const pmOverdue = pmDashboard.overdue;
    const pmMissing = pmDashboard.missing;

    const distributionMap = new Map();
    assets.forEach((asset) => {
      const siteName = getCurrentSiteName(asset, sites);
      distributionMap.set(siteName, (distributionMap.get(siteName) || 0) + 1);
    });

    const distribution = [...distributionMap.entries()]
      .map(([site, total]) => ({ site, total }))
      .sort((a, b) => b.total - a.total);

    const expirySorted = [...assets]
      .map((asset) => ({ ...asset, dashboardExpiryDays: getAssetCalibrationDays(asset, calibrationRecords) }))
      .filter((asset) => asset.dashboardExpiryDays !== null)
      .sort((a, b) => a.dashboardExpiryDays - b.dashboardExpiryDays);

    return { critical, warning, valid, noExpiry, distribution, expirySorted, pmValid, pmDueSoon, pmOverdue, pmMissing };
  }, [assets, sites, calibrationRecords, checklistRecords]);



  function exportAssetsExcel() {
    const rows = [
      ["TMMD & SRP TraceControl - Asset Master Report"],
      [`Generated: ${xlsxDateStamp()}`],
      [],
      ["Equipment Name", "Equipment Number", "Category", "Manufacturer", "Model", "Current Site", "Status", "Remarks"],
      ...assets.map((asset) => [
        getAssetName(asset),
        getAssetSerial(asset),
        asset?.category || "",
        asset?.manufacturer || "",
        asset?.model || "",
        getCurrentSiteName(asset, sites),
        asset?.status || "Active",
        asset?.remarks || "",
      ]),
    ];

    downloadStyledWorkbook("asset-master-report.xlsx", "Asset Master", rows, {
      headerRow: 4,
      statusColumn: "G",
      merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }],
      cols: [
        { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
        { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 40 },
      ],
      rows: [{ hpt: 28 }, { hpt: 20 }, { hpt: 8 }, { hpt: 28 }],
    });
  }

  async function exportCalibrationExcel() {
    const response = await fetch(`${API_BASE}/api/calibration-records`, {
      headers: createAuthHeaders(auth?.token),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      alert(result.message || result.error || "Unable to export calibration Excel report.");
      return;
    }

    const records = getCurrentCalibrationRecords(normalizeList(result, "calibration_records"));

    const rows = [
      ["Calibration Status of Inspection, Monitoring & Test Equipments-UAE"],
      [`Generated: ${xlsxDateStamp()}`, "", "", "", "", "", "", "", "", "", "", "OK", "PENDING", "Due in 30 Days"],
      [],
      [
        "Sr.",
        "Unique Identification",
        "Description",
        "Model",
        "Manufacturer",
        "Certificate Type",
        "Frequency/Months",
        "Tubestar / Outside Agency",
        "Date",
        "Certificate No.",
        "Due Date",
        "Status",
        "Location",
        "Remarks",
        "Days",
        "Attachment Ref",
      ],
      ...records.map((record, index) => {
        const statusInfo = calibrationStatusFromExpiry(record.expiry_date);
        return [
          index + 1,
          record.serial_number || "",
          record.equipment_name || "",
          record.model || "",
          record.manufacturer || "",
          record.certificate_type || "Calibration Certificate",
          record.frequency_months || "",
          record.calibration_agency || "",
          record.calibration_date || "",
          record.certificate_number || "",
          record.expiry_date || "",
          statusInfo.label === "Valid" ? "OK" : statusInfo.label,
          record.current_site_name || record.current_site_code || "",
          record.remarks || "",
          daysBetweenToday(record.expiry_date),
          record.attachment_ref || "",
        ];
      }),
    ];

    downloadStyledWorkbook("calibration-status-report.xlsx", "Calibration Status", rows, {
      headerRow: 4,
      statusColumn: "L",
      merges: [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      ],
      cols: [
        { wch: 8 }, { wch: 22 }, { wch: 24 }, { wch: 16 },
        { wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 24 },
        { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 18 },
        { wch: 18 }, { wch: 34 }, { wch: 10 }, { wch: 28 },
      ],
      rows: [{ hpt: 30 }, { hpt: 22 }, { hpt: 8 }, { hpt: 34 }],
    });
  }

  function exportAssetsCsv() {
    const rows = [
      ["Equipment Name", "Equipment Number", "Category", "Manufacturer", "Model", "Current Site", "Status", "Remarks"],
      ...assets.map((asset) => [
        getAssetName(asset),
        getAssetSerial(asset),
        asset?.category || "",
        asset?.manufacturer || "",
        asset?.model || "",
        getCurrentSiteName(asset, sites),
        asset?.status || "",
        asset?.remarks || "",
      ]),
    ];

    downloadCsv("asset-master-report.csv", rows);
  }

  function exportExpiryCsv() {
    const expiryRows = assets
      .map((asset) => {
        const days = getAssetCalibrationDays(asset, calibrationRecords);
        const status = statusFromDays(days);

        return {
          days,
          row: [
            getAssetName(asset),
            getAssetSerial(asset),
            getCurrentSiteName(asset, sites),
            days === null ? "N/A" : days,
            status.label,
          ],
        };
      })
      .filter((item) => item.days !== null && item.days <= 30)
      .sort((a, b) => a.days - b.days)
      .map((item) => item.row);

    const rows = [
      ["Equipment Name", "Equipment Number", "Current Site", "Days Until Expiry", "Expiry Status"],
      ...expiryRows,
    ];

    if (!expiryRows.length) {
      rows.push(["No assets found within 30 days expiry range", "", "", "", ""]);
    }

    downloadCsv("expiry-visibility-under-30-days.csv", rows);
  }

  function exportLocationCsv() {
    const rows = [
      ["Site Code", "Site Name", "City", "Country", "Mode", "Status", "Total Assets"],
      ...sites.map((site) => {
        const siteId = String(pickId(site));
        const totalAssets = assets.filter((asset) => String(asset?.current_site_id ?? asset?.site_id) === siteId).length;

        return [
          site?.site_code || "",
          getSiteName(site),
          site?.city || "",
          site?.country || "",
          isRemoteSite(site) ? "Remote" : "Normal",
          isSiteActive(site) ? "Active" : "Inactive",
          totalAssets,
        ];
      }),
    ];

    downloadCsv("current-site-location-report.csv", rows);
  }

  async function exportMovementTrackingCsv() {
    const response = await fetch(`${API_BASE}/api/movements`, {
      headers: createAuthHeaders(auth?.token),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      alert(result.message || result.error || "Unable to export movement report.");
      return;
    }

    const movements = normalizeList(result, "movements");

    const rows = [
      ["Equipment Name", "Equipment Number", "Category", "From Site", "To Site", "Current Site", "Movement Date", "Movement Type", "Handed Over By", "Received By", "Remarks", "Status"],
      ...movements.map((item) => [
        item?.equipment_name || "",
        item?.serial_number || "",
        item?.category || "",
        item?.from_site_name || item?.from_site || "",
        item?.to_site_name || item?.to_site || "",
        item?.current_site_name || "",
        formatUaeDateTime(item?.movement_datetime || item?.created_at) || "",
        item?.movement_type || "",
        item?.handed_over_by || "",
        item?.received_by || "",
        item?.remarks || "",
        item?.status || "Recorded",
      ]),
    ];

    downloadCsv("complete-mobilization-movement-tracking-report.csv", rows);
  }

  async function exportCalibrationCsv() {
    try {
      const response = await fetch(API_BASE + "/api/calibration-records", {
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load calibration records.");
      }

      const records = getCurrentCalibrationRecords(normalizeList(result, "calibration_records"));

      const rows = [
        [
          "Equipment Name",
          "Equipment Number",
          "Category",
          "Current Site",
          "Certificate Number",
          "Calibration Date",
          "Expiry Date",
          "Days Until Expiry",
          "Status",
          "Calibration Agency",
          "Attachment",
          "Remarks",
        ],
        ...records.map((record) => {
          const expiryDate = record.expiry_date || record.calibration_expiry_date || record.due_date || "";
          const calibrationDate = record.calibration_date || record.date_of_calibration || "";
          const days = daysUntilDateValue(expiryDate);
          const status = calibrationStatusFromExpiry(expiryDate);

          return [
            record.equipment_name || record.asset_name || record.name || "",
            record.serial_number || record.identification_number || record.equipment_no || record.tag_number || "",
            record.category || record.asset_category || "",
            record.current_site_name || record.site_name || record.current_location || record.location || "",
            record.certificate_number || "",
            calibrationDate || "",
            expiryDate || "",
            days === null ? "N/A" : days,
            status.label,
            record.calibration_agency || "",
            record.attachment_ref || "",
            record.remarks || "",
          ];
        }),
      ];

      if (!records.length) {
        rows.push(["No calibration records found", "", "", "", "", "", "", "", "", "", "", ""]);
      }

      downloadCsv("calibration-current-report.csv", rows);
    } catch (error) {
      console.error(error);
      alert(error.message || "Unable to download calibration report.");
    }
  }


  async function exportAssetRepairCsv() {
    const response = await fetch(`${API_BASE}/api/asset-repairs`, {
      headers: createAuthHeaders(auth?.token),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      alert(result.message || result.error || "Unable to export asset repair report.");
      return;
    }

    const repairRecords = normalizeList(result, "asset_repairs");

    const rows = [
      ["Equipment Name", "Equipment Number", "Category", "Site", "Repair Date", "Fault / Issue", "Action Taken", "Repaired By", "Parts Used", "Status", "Attachment", "Remarks"],
      ...repairRecords.map((record) => [
        record?.equipment_name || "",
        record?.serial_number || "",
        record?.category || "",
        record?.site_name || record?.site_code || "",
        record?.repair_date || "",
        record?.fault_description || "",
        record?.action_taken || "",
        record?.repaired_by || "",
        record?.parts_used || "",
        record?.status || "",
        record?.attachment_ref || "",
        record?.remarks || "",
      ]),
    ];

    downloadCsv("asset-repair-history-report.csv", rows);
  }
  async function exportPmChecklistCsv() {
    try {
      const response = await fetch(API_BASE + "/api/checklist-records", {
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load PM checklist records.");
      }

      const pmRecords = getCleanPmRecords(result);

      const rows = [
        [
          "Equipment Name",
          "Equipment Number",
          "Category",
          "Site",
          "Checklist Type",
          "Checklist Name",
          "Inspection / PM Date",
          "Next PM Due",
          "PM Frequency",
          "Status",
          "Performed By",
          "Attachment",
          "Remarks",
        ],
        ...pmRecords.map((record) => [
          record.equipment_name || record.asset_name || record.name || record.equipment || "",
          record.serial_number || record.identification_number || record.equipment_no || record.tag_number || "",
          record.category || record.asset_category || "",
          record.current_site_name || record.site_name || record.current_location || record.location || "",
          record.checklist_type || "PM",
          record.checklist_name || "",
          record.checklist_date || record.inspection_date || record.pm_date || "",
          record.next_due_date || "",
          record.pm_frequency || "",
          record.result || record.status || "",
          record.performed_by || record.inspector_name || "",
          record.attachment_ref || "",
          record.remarks || "",
        ]),
      ];

      if (!pmRecords.length) {
        rows.push(["No PM checklist records found", "", "", "", "", "", "", "", "", "", "", "", ""]);
      }

      downloadCsv("pm-checklist-report.csv", rows);
    } catch (error) {
      console.error(error);
      alert(error.message || "Unable to download PM checklist report.");
    }
  }
  async function saveMovement(e) {
    e.preventDefault();

    if (!movementCategory || !movementEquipmentName || !selectedAssetId || !destinationSiteId || !movementType) {
      setMovementMessage("Please select category, equipment name, equipment number, movement type, and destination site.");
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
          movement_type: movementType,
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
      setSelectedAssetId("");
      setMovementEquipmentName("");
      setMovementCategory("");
      setMovementType("Mobilization");
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
    setTracePmRecords([]);

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

      if (!canManageAssets) {
      setAssetMessage("Only Admin can deactivate or reactivate asset records.");
      return;
    }

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

      const pmRes = await fetch(`${API_BASE}/api/checklist-records?asset_id=${assetId}`, {
        headers: authHeaders,
      });

      if (pmRes.status === 401) {
        handleLogout();
        return;
      }

      if (pmRes.ok) {
        const pmJson = await pmRes.json().catch(() => ({}));
        setTracePmRecords(normalizeList(pmJson, "checklist_records"));
      }
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
      <aside className="sidebar premiumSidebar">
        <div className="sidebarTopGlow" />

        <div className="brandBlock premiumBrand">
          <div className="brandMonogram">
            <span>TC</span>
          </div>

          <div className="brandCopy">
            <span>TMMD & SRP</span>
            <h1>TraceControl</h1>
            <p>Enterprise Asset Suite</p>
          </div>
        </div>

        <div className="sidebarStatusStrip">
          <span className={`syncOrb ${apiStatus.toLowerCase()}`} />
          <div>
            <strong>{apiStatus === "Live" ? "Cloud Sync Active" : `Cloud ${apiStatus}`}</strong>
            <p>Protected operational workspace</p>
          </div>
        </div>

        <nav className="navList premiumNav">
          <div className="navSectionLabel">Command</div>
          {navItems
            .filter((item) => ["dashboard", "traceability"].includes(item.id) && canAccessTab(item.id))
            .map((item) => (
              <button
                key={item.id}
                className={`navButton ${activeTab === item.id ? "active" : ""}`}
                onClick={() => setActiveTab(item.id)}
              >
                <i className="navActiveRail" />
                <span>{item.icon}</span>
                <em>{item.label}</em>
              </button>
            ))}

          <div className="navSectionLabel">Operations</div>
          {navItems
            .filter((item) => ["movement", "assets", "sites", "reports", "import", "settings"].includes(item.id) && canAccessTab(item.id))
            .map((item) => (
              <button
                key={item.id}
                className={`navButton ${activeTab === item.id ? "active" : ""}`}
                onClick={() => setActiveTab(item.id)}
              >
                <i className="navActiveRail" />
                <span>{item.icon}</span>
                <em>{item.label}</em>
              </button>
            ))}

          <div className="navSectionLabel">Control Modules</div>
          {navItems
            .filter((item) => ["calibration", "pm", "repair"].includes(item.id) && canAccessTab(item.id))
            .map((item) => (
              <button
                key={item.id}
                className={`navButton ${activeTab === item.id ? "active" : ""}`}
                onClick={() => setActiveTab(item.id)}
              >
                <i className="navActiveRail" />
                <span>{item.icon}</span>
                <em>{item.label}</em>
              </button>
            ))}
        </nav>

        <div className="sidebarFooter premiumFooter">
          <div className="footerAvatar">A</div>
          <div>
            <strong>Admin Access</strong>
            <small>Secure session active</small>
          </div>
        </div>
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div>
            <p className="eyebrow">Enterprise Operations Suite</p>
            <h2>{activeTab === "dashboard" ? "Command Dashboard" : navItems.find((item) => item.id === activeTab)?.label}</h2>
            <p className="eyebrow">Access Role: {userRole}</p>
          </div>

          <div className="topActions">
            <button className="ghostButton" onClick={loadData}>Refresh Data</button>
            <button className="ghostButton" onClick={handleLogout}>Logout</button>
            <button className="primaryButton" onClick={() => setActiveTab("movement")}>New Movement</button>
          </div>
        </header>

        {activeTab === "dashboard" && (
          <section className="dashboardV2">
            <div className="v2Hero">
              <div>
                <p className="eyebrow">Asset Control Tower</p>
                <h3>Live Movement • Expiry Risk • Traceability Intelligence</h3>
                <p>
                  Centralized operational visibility for asset location, expiry attention,
                  movement control, and audit-ready traceability.
                </p>

                <div className="v2HeroActions">
                  <button className="primaryButton" onClick={() => setActiveTab("movement")}>Register Movement</button>
                  <button className="ghostButton" onClick={() => setActiveTab("traceability")}>Trace Asset</button>
                  <button className="ghostButton" onClick={() => setActiveTab("reports")}>Export Reports</button>
                </div>
              </div>

              <div className="v2SyncCard">
                <div className="v2SyncTop">
                  <span className="v2LivePulse" />
                  <small>Cloud Sync</small>
                </div>
                <strong>{apiStatus}</strong>
                <p>Secure live workspace with protected access and real-time operational monitoring.</p>
                <div className="v2SyncPills">
                  <span>Live Monitoring</span>
                  <span>Secure Access</span>
                </div>
              </div>
            </div>

            <div className="v2KpiGrid">
              <div className="v2KpiCard">
                <div className="v2KpiHead"><span>Total Assets</span><b>01</b></div>
                <strong>{assets.length}</strong>
                <p>Tracked equipment register</p>
                <div className="v2MiniTrend"><i style={{height:"28%"}}/><i style={{height:"48%"}}/><i style={{height:"38%"}}/><i style={{height:"72%"}}/><i style={{height:"62%"}}/><i style={{height:"86%"}}/></div>
              </div>

              <div className="v2KpiCard danger">
                <div className="v2KpiHead"><span>Critical Expiry</span><b>02</b></div>
                <strong>{dashboardData.critical.length}</strong>
                <p>Immediate action required</p>
                <div className="v2RiskLine danger" />
              </div>

              <div className="v2KpiCard warning">
                <div className="v2KpiHead"><span>Warning Expiry</span><b>03</b></div>
                <strong>{dashboardData.warning.length}</strong>
                <p>Upcoming attention</p>
                <div className="v2RiskLine warning" />
              </div>

              <div className="v2KpiCard success">
                <div className="v2KpiHead"><span>Active Sites</span><b>04</b></div>
                <strong>{sites.length}</strong>
                <p>Operational locations</p>
                <div className="v2RiskLine success" />
              </div>
            </div>

            <div className="v2MainGrid">
              <Panel title="Calibration Health Intelligence" action="Expiry risk">
                <div className="v2HealthWrap">
                  <div
                    className="v2HealthRing"
                    style={{
                      "--validEnd": `${assets.length ? (dashboardData.valid.length / assets.length) * 100 : 0}%`,
                      "--warningEnd": `${assets.length ? ((dashboardData.valid.length + dashboardData.warning.length) / assets.length) * 100 : 0}%`,
                      "--criticalEnd": `${assets.length ? ((dashboardData.valid.length + dashboardData.warning.length + dashboardData.critical.length) / assets.length) * 100 : 0}%`,
                    }}
                  >
                    <div>
                      <strong>{assets.length ? Math.round((dashboardData.valid.length / assets.length) * 100) : 0}%</strong>
                      <span>Healthy</span>
                    </div>
                  </div>

                  <div className="v2HealthMetrics">
                    <div><span className="v2Dot success" /><p>Valid Calibration</p><strong>{dashboardData.valid.length}</strong></div>
                    <div><span className="v2Dot warning" /><p>Warning Calibration</p><strong>{dashboardData.warning.length}</strong></div>
                    <div><span className="v2Dot danger" /><p>Critical Calibration</p><strong>{dashboardData.critical.length}</strong></div>
                  </div>
                </div>
              </Panel>

              <Panel title="PM Compliance Status" action="Auto status">
                <div className="v2ActionStack">
                  <div className="v2ActionAlert success">
                    <span />
                    <small>PM VALID</small>
                    <strong>{dashboardData.pmValid?.length || 0}</strong>
                    <p>asset(s) currently within PM schedule</p>
                  </div>
                  <div className="v2ActionAlert warning">
                    <span />
                    <small>DUE WITHIN 10 DAYS</small>
                    <strong>{dashboardData.pmDueSoon?.length || 0}</strong>
                    <p>asset(s) requiring upcoming PM attention</p>
                  </div>
                  <div className="v2ActionAlert danger">
                    <span />
                    <small>OVERDUE PM</small>
                    <strong>{dashboardData.pmOverdue?.length || 0}</strong>
                    <p>asset(s) past planned PM due date</p>
                  </div>
                </div>
              </Panel>

              <Panel title="Quick Trace Search" action="Asset lookup">
                <div className="v2TraceCard">
                  <p>Search equipment by identification number and open movement history.</p>
                  <input
                    className="searchInput"
                    value={traceQuery}
                    onChange={(e) => setTraceQuery(e.target.value)}
                    placeholder="Enter identification number..."
                  />
                  <button className="primaryButton wide" onClick={() => setActiveTab("traceability")}>
                    Open Traceability
                  </button>
                </div>
              </Panel>
            </div>

            <div className="v2SecondGrid">
              <Panel title="Site Distribution Board" action={`${dashboardData.distribution.length} locations`}>
                <div className="v2SiteBoard">
                  {dashboardData.distribution.slice(0, 7).map((item, index) => {
                    const width = assets.length ? Math.max(8, (item.total / assets.length) * 100) : 0;
                    return (
                      <div className="v2SiteRow" key={item.site}>
                        <div className="v2SiteRank">{String(index + 1).padStart(2, "0")}</div>
                        <div className="v2SiteInfo">
                          <div><strong>{item.site}</strong><span>{item.total} asset(s)</span></div>
                          <div className="barTrack"><div className="barFill" style={{ width: `${width}%` }} /></div>
                        </div>
                      </div>
                    );
                  })}
                  {!dashboardData.distribution.length && <Empty text="No location distribution available." />}
                </div>
              </Panel>

              <Panel title="Calibration Due Focus" action="Less than 30 days">
                  <div className="v2ActionStack">
                    <div className="v2ActionAlert danger">
                      <span />
                      <small>CRITICAL CALIBRATION</small>
                      <strong>{dashboardData.critical.length}</strong>
                      <p>calibration item(s) due in 7 days or overdue</p>
                    </div>
                    <div className="v2ActionAlert warning">
                      <span />
                      <small>WARNING CALIBRATION</small>
                      <strong>{dashboardData.warning.length}</strong>
                      <p>calibration item(s) due within 30 days</p>
                    </div>
                    <div className="v2ActionAlert success">
                      <span />
                      <small>VALID CALIBRATION</small>
                      <strong>{dashboardData.valid.length}</strong>
                      <p>calibration item(s) currently valid</p>
                    </div>
                  </div>
                </Panel>
            </div>

            <div className="v2BottomGrid">
              <Panel title="Asset Register Snapshot" action={`${filteredAssets.slice(0, 5).length} shown`}>
                <input
                  className="searchInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search asset, identification no., or location..."
                />
                <AssetTable assets={filteredAssets.slice(0, 5)} sites={sites} compact />
              </Panel>

              
            </div>
          </section>
        )}

        {activeTab === "movement" && (
          <section className="pageGrid">
            <div className="twoColumn">
              <Panel title="Movement Entry V2" action="Mobilization / Transfer control">
                <form className="formGrid" onSubmit={saveMovement}>
                  <label>
                    Category
                    <select
                      value={movementCategory}
                      onChange={(e) => {
                        setMovementCategory(e.target.value);
                        setMovementEquipmentName("");
                        setSelectedAssetId("");
                      }}
                    >
                      <option value="">Choose category</option>
                      {movementCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Equipment Name
                    <select
                      value={movementEquipmentName}
                      onChange={(e) => {
                        setMovementEquipmentName(e.target.value);
                        setSelectedAssetId("");
                      }}
                    >
                      <option value="">Choose equipment name</option>
                      {movementEquipmentNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Equipment Number
                    <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}>
                      <option value="">Choose equipment number</option>
                      {movementEquipmentNumbers.map((asset) => (
                        <option key={pickId(asset)} value={pickId(asset)}>
                          {getAssetSerial(asset)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Current Site
                    <input value={selectedAsset ? getCurrentSiteName(selectedAsset, sites) : ""} readOnly placeholder="Auto shown after equipment number selection" />
                  </label>

                  <label>
                    Destination Site
                    <select value={destinationSiteId} onChange={(e) => setDestinationSiteId(e.target.value)}>
                      <option value="">Choose destination</option>
                      {sites.filter(isSiteActive).map((site) => (
                        <option key={pickId(site)} value={pickId(site)}>
                          {getSiteName(site)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Movement Type
                    <select value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                      <option value="Mobilization">Mobilization</option>
                      <option value="Demobilization">Demobilization</option>
                      <option value="Transfer">Transfer</option>
                      <option value="Return">Return</option>
                      <option value="Maintenance Movement">Maintenance Movement</option>
                      <option value="Calibration">Calibration</option>
                      <option value="Site to Site Movement">Site to Site Movement</option>
                    </select>
                  </label>

                  <label className="wide">
                    Remarks
                    <input value={movementNote} onChange={(e) => setMovementNote(e.target.value)} placeholder="Optional remarks / reference" />
                  </label>

                  <button className="primaryButton wide" disabled={savingMovement}>
                    {savingMovement ? "Saving..." : "Save Movement"}
                  </button>

                  {movementMessage && <div className="messageBox wide">{movementMessage}</div>}
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
                      <span>Calibration: {daysUntilExpiry(traceAsset) ?? "N/A"} days</span>
                      {(() => {
                        const latestPm = getLatestPmRecord(tracePmRecords);
                        const pmStatus = pmStatusFromDueDate(latestPm?.next_due_date);
                        return (
                          <>
                            <span>PM Status: {pmStatus.label}</span>
                            <span>Last PM: {latestPm?.checklist_date || "Not Available"}</span>
                            <span>Next PM Due: {latestPm?.next_due_date || "Not Applicable"}</span>
                            <span>PM Frequency: {latestPm?.pm_frequency || "Not Applicable"}</span>
                            <span>Required Checklist: {latestPm?.checklist_name || "Not Applicable"}</span>
                          </>
                        );
                      })()}
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
                        <strong>{item.from_site_name || item.from_site || item.from_location || "Previous Site"} → {item.to_site_name || item.to_site || item.to_location || "New Site"}</strong>
                        <p>{formatUaeDateTime(item.movement_datetime || item.movement_date || item.created_at) || "Date not available"}</p>
                        <small>{item.remarks || item.notes || item.stayed_duration || (item.stayed_days_at_to_site ? `${item.stayed_days_at_to_site} day(s) at site` : "Movement recorded in audit trail")}</small>
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
          <AssetMasterPage
            assets={filteredAssets}
            allAssets={assets}
            sites={sites}
            auth={auth}
            query={query}
            setQuery={setQuery}
            loadData={loadData}
          />
        )}

        {activeTab === "sites" && (
          <SiteMasterPage
            sites={sites}
            auth={auth}
            loadData={loadData}
          />
        )}
        {activeTab === "calibration" && (
          <CalibrationPage
            assets={assets}
            sites={sites}
            auth={auth}
          />
        )}
        {activeTab === "pm" && (
          <PmChecklistPage
            assets={assets}
            sites={sites}
            auth={auth}
          />
        )}

        {activeTab === "repair" && (
          <RepairHistoryPage
            assets={assets}
            sites={sites}
            auth={auth}
          />
        )}

        {activeTab === "import" && (
          <ExcelImportCenter />
        )}

        {activeTab === "settings" && (
          <SettingsPage auth={auth} />
        )}

        {activeTab === "reports" && (
          <section className="pageGrid">
            <div className="dashboardIntro">
              <div>
                <p className="eyebrow">Export Center</p>
                <h3>Reports & Download Center</h3>
                <p>
                  Download client-ready CSV reports for asset master, expiry visibility, current site location, movement tracking, calibration, and PM checklist records.
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
                <div className="v2HeroActions">
                  <button className="primaryButton" onClick={exportAssetsCsv}>Download CSV</button>
                  <button className="ghostButton" onClick={exportAssetsExcel}>Download Excel</button>
                </div>
              </div>

              <div className="reportCard">
                <span>02</span>
                <h4>Expiry Visibility Report</h4>
                <p>Shows only calibration/expiry records due within 30 days, sorted by urgency.</p>
                <button className="primaryButton" onClick={exportExpiryCsv}>Download CSV</button>
              </div>

              <div className="reportCard">
                <span>03</span>
                <h4>Asset Repair History Report</h4>
                <p>Equipment-wise repair history with fault, action taken, repaired by, parts used, repair status, attachment, and remarks.</p>
                <button className="primaryButton" onClick={exportAssetRepairCsv}>Download CSV</button>
              </div>
              <div className="reportCard">
                <span>04</span>
                <h4>Complete Mobilization / Movement Tracking Report</h4>
                <p>Full asset movement history with equipment number, from site, to site, current site, movement date, type, handover, receiver, and remarks.</p>
                <button className="primaryButton" onClick={exportMovementTrackingCsv}>Download CSV</button>
              </div>

              <div className="reportCard">
                <span>05</span>
                <h4>Calibration Report</h4>
                <p>Current calibration report with equipment number, site, certificate number, calibration date, expiry date, days remaining, and status.</p>
                <div className="v2HeroActions">
                  <button className="primaryButton" onClick={exportCalibrationCsv}>Download CSV</button>
                  <button className="ghostButton" onClick={exportCalibrationExcel}>Download Excel</button>
                </div>
              </div>

              <div className="reportCard">
                <span>06</span>
                <h4>PM Checklist Report</h4>
                <p>PM checklist report format with equipment, site, inspection date, inspector, PM frequency, result, attachment, and remarks.</p>
                <button className="primaryButton" onClick={exportPmChecklistCsv}>Download CSV</button>
              </div>
            </div>
          </section>
        )}

        {loading && <div className="loadingOverlay">Loading live data...</div>}
      </main>
    </div>
  );
}



const SETTINGS_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "movement", label: "Movement Entry" },
  { id: "traceability", label: "Traceability" },
  { id: "assets", label: "Asset Master" },
  { id: "sites", label: "Site Master" },
  { id: "calibration", label: "Calibration" },
  { id: "pm", label: "PM / Checklist" },
  { id: "repair", label: "Asset Repair" },
  { id: "reports", label: "Reports" },
  { id: "import", label: "Excel Import" },
  { id: "settings", label: "Settings" },
];

function SettingsPage({ auth }) {
  const [users, setUsers] = useState([]);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  async function loadUsers() {
    setSettingsMessage("Loading user settings...");

    try {
      const response = await fetch(`${API_BASE}/api/settings/users`, {
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load users.");
      }

      setUsers((result.users || []).map((user) => ({
        ...user,
        password: "",
        allowed_tabs: Array.isArray(user.allowed_tabs) ? user.allowed_tabs : [],
        is_active: Number(user.is_active) === 1,
      })));

      setSettingsMessage("User settings loaded.");
    } catch (error) {
      console.error(error);
      setSettingsMessage(error.message || "Unable to load user settings.");
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function updateUser(index, key, value) {
    setUsers((current) => current.map((user, itemIndex) => itemIndex === index ? { ...user, [key]: value } : user));
  }

  function toggleUserTab(index, tabId) {
    setUsers((current) => current.map((user, itemIndex) => {
      if (itemIndex !== index) return user;

      const currentTabs = Array.isArray(user.allowed_tabs) ? user.allowed_tabs : [];
      const exists = currentTabs.includes(tabId);
      const nextTabs = exists ? currentTabs.filter((item) => item !== tabId) : [...currentTabs, tabId];

      return { ...user, allowed_tabs: nextTabs };
    }));
  }

  function applyRoleTemplate(index, role) {
    const tabs = getAllowedTabsForRole(role);
    updateUser(index, "role", role);
    setUsers((current) => current.map((user, itemIndex) => itemIndex === index ? { ...user, role, allowed_tabs: tabs } : user));
  }

  async function saveUsers() {
    setSavingSettings(true);
    setSettingsMessage("Saving user settings...");

    try {
      const response = await fetch(`${API_BASE}/api/settings/users`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders(auth?.token),
        },
        body: JSON.stringify({
          users,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save user settings.");
      }

      setSettingsMessage(result.message || "User settings updated successfully.");
      await loadUsers();
    } catch (error) {
      console.error(error);
      setSettingsMessage(error.message || "Unable to save user settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Admin Control</p>
          <h3>User Settings & Access Control</h3>
          <p>Change passwords, activate/deactivate users, assign roles, and select module access for each user.</p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip"><span>Users</span><strong>{users.length}</strong></div>
          <div className="summaryChip"><span>Security</span><strong>Role Based</strong></div>
        </div>
      </div>

      <Panel title="User Access Settings" action="Admin only">
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Display Name</th>
                <th>Role</th>
                <th>New Password</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, index) => (
                <tr key={user.username}>
                  <td><strong>{user.username}</strong></td>
                  <td>
                    <input value={user.display_name || ""} onChange={(e) => updateUser(index, "display_name", e.target.value)} />
                  </td>
                  <td>
                    <select value={user.role} onChange={(e) => applyRoleTemplate(index, e.target.value)}>
                      <option value="Admin">Admin</option>
                      <option value="Store">Store</option>
                      <option value="Operator">Operator</option>
                      <option value="Viewer">Viewer</option>
                    </select>
                  </td>
                  <td>
                    <input type="text" value={user.password || ""} placeholder="Leave blank to keep current" onChange={(e) => updateUser(index, "password", e.target.value)} />
                  </td>
                  <td>
                    <select value={user.is_active ? "1" : "0"} onChange={(e) => updateUser(index, "is_active", e.target.value === "1")}>
                      <option value="1">Active</option>
                      <option value="0">Inactive</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Module Access Matrix" action="Select allowed modules">
        <div className="settingsGrid">
          {users.map((user, index) => (
            <div className="importGuide" key={user.username}>
              <h4>{user.display_name || user.username}</h4>
              <p><strong>Role:</strong> {user.role}</p>
              <div className="settingsChecks">
                {SETTINGS_MODULES.map((module) => (
                  <label key={module.id} className="settingsCheck">
                    <input
                      type="checkbox"
                      checked={(user.allowed_tabs || []).includes(module.id)}
                      onChange={() => toggleUserTab(index, module.id)}
                    />
                    {module.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="v2HeroActions">
        <button className="primaryButton" type="button" disabled={savingSettings} onClick={saveUsers}>
          {savingSettings ? "Saving..." : "Save User Settings"}
        </button>
        <button className="ghostButton" type="button" onClick={loadUsers}>Reload</button>
      </div>

      <div className="messageBox">{settingsMessage || "Update user access carefully before handover."}</div>
    </section>
  );
}

function ExcelImportCenter() {
  const [servicePreview, setServicePreview] = useState(null);
  const [calibrationPreview, setCalibrationPreview] = useState(null);
  const [importMessage, setImportMessage] = useState("");
  const [applyingImport, setApplyingImport] = useState(false);

  function normalizeHeader(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function findColumn(headers, possibleNames) {
    const normalized = headers.map((header) => normalizeHeader(header));

    for (const name of possibleNames) {
      const needle = normalizeHeader(name);
      if (!needle) continue;

      const needleParts = needle.split(" ").filter(Boolean);

      const index = normalized.findIndex((header) => {
        if (!header) return false;
        if (header === needle) return true;
        if (header.includes(needle)) return true;
        if (needle.includes(header) && header.length >= 4) return true;
        return needleParts.length > 1 && needleParts.every((part) => header.includes(part));
      });

      if (index >= 0) return index;
    }

    return -1;
  }

  function normalizeImportDateValue(value) {
    if (value === null || value === undefined) return "";

    const convertExcelSerial = (serialValue) => {
      const serial = Number(serialValue);
      if (!Number.isFinite(serial) || serial <= 0) return "";
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const parsed = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
      return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
    };

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return convertExcelSerial(value);
    }

    const text = String(value).trim();
    if (!text) return "";

    // Handles imported Excel serials shown like +046052-01, +046416-01, +045873-01
    const plusSerialMatch = text.match(/^\+?0*(\d{4,6})(?:-\d+)?$/);
    if (plusSerialMatch) {
      const converted = convertExcelSerial(plusSerialMatch[1]);
      if (converted) return converted;
    }

    // Handles plain serial text like 46052 / 046052
    const plainSerialMatch = text.match(/^0*(\d{4,6})$/);
    if (plainSerialMatch) {
      const converted = convertExcelSerial(plainSerialMatch[1]);
      if (converted) return converted;
    }

    // Handles dd/mm/yyyy, dd-mm-yyyy
    const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, "0");
      const month = dmy[2].padStart(2, "0");
      const year = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

    return text;
  }

  function isImportDateLikeValue(value) {
    if (value === null || value === undefined) return false;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
    if (typeof value === "number" && Number.isFinite(value) && value > 25000 && value < 70000) return true;

    const text = String(value).trim();
    if (!text) return false;

    if (/^\+?0*\d{4,6}(?:-\d+)?$/.test(text)) return true;
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(text)) return true;
    if (/^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(text)) return true;

    const parsed = new Date(text);
    return !Number.isNaN(parsed.getTime()) && /\d/.test(text);
  }

  function scoreDateColumn(rows, columnIndex) {
    return rows.reduce((score, row) => score + (isImportDateLikeValue(row[columnIndex]) ? 1 : 0), 0);
  }

  function inferDateColumnFromRows(rows, startIndex, endIndex, direction = "forward") {
    if (!rows.length) return -1;

    const firstRow = rows[0] || [];
    const maxIndex = Math.max(...rows.map((row) => row.length), firstRow.length) - 1;

    const start = Math.max(0, startIndex);
    const end = Math.min(maxIndex, endIndex);

    let bestIndex = -1;
    let bestScore = 0;

    if (direction === "backward") {
      for (let index = end; index >= start; index -= 1) {
        const score = scoreDateColumn(rows, index);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
    } else {
      for (let index = start; index <= end; index += 1) {
        const score = scoreDateColumn(rows, index);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
    }

    return bestScore >= Math.max(2, Math.ceil(rows.length * 0.10)) ? bestIndex : -1;
  }

  function detectHeaderRow(rows) {
    let bestIndex = 0;
    let bestScore = -1;

    rows.slice(0, 20).forEach((row, index) => {
      const text = row.map((cell) => normalizeHeader(cell)).join(" ");
      let score = 0;
      ["equipment", "serial", "location", "status", "unique", "identification", "description", "certificate", "due date"].forEach((word) => {
        if (text.includes(word)) score += 1;
      });
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function uniqueCount(values) {
    return new Set(values.filter((value) => String(value || "").trim())).size;
  }

  function buildPreview(rows, type, fileName) {
    if (!rows.length) return null;

    const headerIndex = detectHeaderRow(rows);
    const headers = rows[headerIndex] || [];
    const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell || "").trim()));

    const equipmentCol = findColumn(headers, type === "service" ? ["Equipment Name", "Description"] : ["Description", "Equipment Name"]);
    const serialCol = findColumn(headers, type === "service" ? ["Equipment Serial No", "Serial No", "Unique Identification"] : ["Unique Identification", "Equipment Serial No", "Serial No"]);
    const locationCol = findColumn(headers, ["Location", "Site"]);
    const remarksCol = findColumn(headers, ["Remarks", "Remark"]);
    const statusCol = findColumn(headers, ["Status"]);
    const makeCol = findColumn(headers, ["Make", "Manufacturer"]);
    const certificateCol = findColumn(headers, ["Certificate No", "Certificate Number", "Cert No", "Certificate"]);
    let dueDateCol = findColumn(headers, [
      "Due Date",
      "Expiry Date",
      "Expire Date",
      "Expiration Date",
      "Calibration Due Date",
      "Calibration Expiry Date",
      "Next Calibration Due Date",
      "Next Due Date",
      "Validity Date",
      "Valid Until",
      "Valid Upto",
      "Certificate Expiry",
      "Due"
    ]);
    let calibrationDateCol = findColumn(headers, [
      "Calibration Date",
      "Date of Calibration",
      "Cal Date",
      "Last Calibration Date",
      "Calibration Done Date",
      "Date Calibrated",
      "Certificate Date",
      "Issue Date"
    ]);
    let pmDateCol = type === "service" ? findColumn(headers, [
      "Preventive Maintenance Done",
      "Preventive Maintenance Date",
      "PM Done",
      "PM Date",
      "PM Checklist Date",
      "Maintenance Date",
      "Inspection Date",
      "Checklist Date",
      "Date"
    ]) : -1;
    let pmFrequencyCol = type === "service" ? findColumn(headers, [
      "PM Frequency",
      "Frequency",
      "Preventive Maintenance Frequency",
      "Maintenance Frequency",
      "PM Interval",
      "Interval",
      "Period",
      "Schedule"
    ]) : -1;

    // Some client Excel files have blank/merged headers, but date values appear like +046052-01.
    // For calibration file: date before certificate number = calibration date, date after certificate number = expiry/due date.
    if (type === "calibration") {
      const maxColumnIndex = Math.max(...dataRows.map((row) => row.length), headers.length) - 1;

      if (calibrationDateCol < 0 && certificateCol >= 0) {
        calibrationDateCol = inferDateColumnFromRows(dataRows, 0, Math.max(0, certificateCol - 1), "backward");
      }

      if (dueDateCol < 0 && certificateCol >= 0) {
        dueDateCol = inferDateColumnFromRows(dataRows, certificateCol + 1, maxColumnIndex, "forward");
      }

      if (calibrationDateCol < 0) {
        calibrationDateCol = inferDateColumnFromRows(dataRows, 0, maxColumnIndex, "forward");
      }

      if (dueDateCol < 0) {
        dueDateCol = inferDateColumnFromRows(dataRows, 0, maxColumnIndex, "backward");
      }
    }

    if (type === "service" && pmDateCol < 0) {
      const maxColumnIndex = Math.max(...dataRows.map((row) => row.length), headers.length) - 1;
      pmDateCol = inferDateColumnFromRows(dataRows, 0, maxColumnIndex, "backward");
    }

    const rawLocations = dataRows.map((row) => locationCol >= 0 ? row[locationCol] : "");
    const rawUniqueLocations = uniqueCount(rawLocations);
    const shouldUseRemarksAsLocation = type === "calibration" && remarksCol >= 0 && rawUniqueLocations <= 2;
    const locations = dataRows.map((row) => shouldUseRemarksAsLocation ? row[remarksCol] : row[locationCol]);
    const serials = dataRows.map((row) => row[serialCol]);
    const statuses = dataRows.map((row) => String(row[statusCol] || "").trim());

    return {
      fileName,
      type: type === "service" ? "Service Related Products" : "Master Calibration Log",
      totalRows: dataRows.length,
      uniqueEquipment: uniqueCount(serials),
      uniqueSites: uniqueCount(locations),
      mappedFields: [
        equipmentCol >= 0 ? "Equipment Name" : null,
        serialCol >= 0 ? "Equipment Number / Serial" : null,
        makeCol >= 0 ? "Manufacturer / Make" : null,
        locationCol >= 0 ? "Location / Site" : null,
        shouldUseRemarksAsLocation ? "Remarks as Actual Site / Store" : null,
        statusCol >= 0 ? "Status" : null,
        certificateCol >= 0 ? "Certificate Number" : null,
        calibrationDateCol >= 0 ? "Calibration Date" : null,
        dueDateCol >= 0 ? "Due Date / Expiry Date" : null,
        pmDateCol >= 0 ? "PM Date / Checklist Date" : null,
        pmFrequencyCol >= 0 ? "PM Frequency" : null,
      ].filter(Boolean),
      statusSummary: statuses.reduce((acc, status) => {
        const key = status || "Blank";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      validation: (() => {
        const serialValues = dataRows.map((row) => String(serialCol >= 0 ? row[serialCol] : "").trim());
        const locationValues = dataRows.map((row) => String(shouldUseRemarksAsLocation ? row[remarksCol] : (locationCol >= 0 ? row[locationCol] : "")).trim());
        const statusValues = dataRows.map((row) => String(statusCol >= 0 ? row[statusCol] : "").trim());

        const seen = new Set();
        const duplicates = new Set();

        serialValues.forEach((serial) => {
          if (!serial) return;
          if (seen.has(serial)) duplicates.add(serial);
          seen.add(serial);
        });

        return {
          missingEquipmentNumber: serialValues.filter((serial) => !serial).length,
          duplicateEquipmentNumber: duplicates.size,
          blankLocation: locationValues.filter((location) => !location).length,
          rejectItems: statusValues.filter((status) => /reject/i.test(status)).length,
          pendingItems: statusValues.filter((status) => /pending/i.test(status)).length,
          newSitesDetected: uniqueCount(locationValues),
        };
      })(),
      records: dataRows.map((row) => ({
        equipment: equipmentCol >= 0 ? row[equipmentCol] : "",
        serial: serialCol >= 0 ? row[serialCol] : "",
        location: shouldUseRemarksAsLocation ? row[remarksCol] : (locationCol >= 0 ? row[locationCol] : ""),
        status: statusCol >= 0 ? row[statusCol] : "",
        manufacturer: makeCol >= 0 ? row[makeCol] : "",
        certificate_number: certificateCol >= 0 ? row[certificateCol] : "",
        expiry_date: normalizeImportDateValue(dueDateCol >= 0 ? row[dueDateCol] : ""),
        calibration_date: normalizeImportDateValue(type === "calibration" && calibrationDateCol >= 0 ? row[calibrationDateCol] : ""),
        pm_date: normalizeImportDateValue(type === "service" && pmDateCol >= 0 ? row[pmDateCol] : ""),
        pm_frequency: type === "service" && pmFrequencyCol >= 0 ? row[pmFrequencyCol] : "",
        remarks: remarksCol >= 0 ? row[remarksCol] : "",
        file_name: fileName,
      })).filter((item) => String(item.serial || "").trim() && String(item.equipment || "").trim() && String(item.location || "").trim()),
      sample: dataRows.slice(0, 5).map((row) => ({
        equipment: equipmentCol >= 0 ? row[equipmentCol] : "",
        serial: serialCol >= 0 ? row[serialCol] : "",
        location: shouldUseRemarksAsLocation ? row[remarksCol] : (locationCol >= 0 ? row[locationCol] : ""),
        status: statusCol >= 0 ? row[statusCol] : "",
      })),
    };
  }

  async function readExcelFile(file, type) {
    if (!file) return;
    setImportMessage("Reading Excel file...");

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const preview = buildPreview(rows, type, file.name);

      if (type === "service") {
        setServicePreview(preview);
      } else {
        setCalibrationPreview(preview);
      }

      setImportMessage("Excel preview generated successfully. Database not updated yet.");
    } catch (error) {
      console.error(error);
      setImportMessage(error.message || "Unable to read Excel file.");
    }
  }

  async function applyExcelImport(type, preview) {
    if (!preview?.records?.length) {
      setImportMessage("No valid records available for import.");
      return;
    }

    const confirmed = window.confirm(`Apply ${preview.type} import to live database? Rows with missing equipment number or blank location will be skipped. Valid rows will create/update sites, assets and related records.`);

    if (!confirmed) return;

    setApplyingImport(true);
    setImportMessage("Applying import to live database...");

    try {
      const chunkSize = 75;
      const chunks = [];

      for (let index = 0; index < preview.records.length; index += chunkSize) {
        chunks.push(preview.records.slice(index, index + chunkSize));
      }

      const totalSummary = {
        received: 0,
        skipped: 0,
        assetsCreatedOrUpdated: 0,
        pmRecordsCreated: 0,
        calibrationRecordsCreated: 0,
        duplicatePmSkipped: 0,
        duplicateCalibrationSkipped: 0,
      };

      for (let index = 0; index < chunks.length; index += 1) {
        setImportMessage(`Applying import chunk ${index + 1} of ${chunks.length}...`);

        const response = await fetch(`${API_BASE}/api/import/excel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(getInitialAuth()?.token),
          },
          body: JSON.stringify({
            type,
            records: chunks[index],
          }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || result.success === false) {
          throw new Error(result.message || result.error || `Import failed at chunk ${index + 1}.`);
        }

        const summary = result.summary || {};
        Object.keys(totalSummary).forEach((key) => {
          totalSummary[key] += Number(summary[key] || 0);
        });
      }

      setImportMessage(
        `Import applied successfully. Received: ${totalSummary.received}, Skipped: ${totalSummary.skipped}, Assets: ${totalSummary.assetsCreatedOrUpdated}, PM: ${totalSummary.pmRecordsCreated}, Calibration: ${totalSummary.calibrationRecordsCreated}, Duplicate Calibration Skipped: ${totalSummary.duplicateCalibrationSkipped}`
      );
    } catch (error) {
      console.error(error);
      setImportMessage(error.message || "Unable to apply import.");
    } finally {
      setApplyingImport(false);
    }
  }

  function PreviewCard({ preview, type }) {
    if (!preview) return <div className="messageBox wide">No preview generated yet.</div>;

    return (
      <div className="importGuide wide">
        <h4>{preview.type} Preview</h4>
        <p><strong>File:</strong> {preview.fileName}</p>
        <p><strong>Total Rows:</strong> {preview.totalRows}</p>
        <p><strong>Unique Equipment:</strong> {preview.uniqueEquipment}</p>
        <p><strong>Unique Sites / Locations:</strong> {preview.uniqueSites}</p>
        <p><strong>Mapped Fields:</strong> {preview.mappedFields.join(", ") || "No fields detected"}</p>

        <h4>Import Validation Summary</h4>
        <p><strong>Missing Equipment Number:</strong> {preview.validation?.missingEquipmentNumber ?? 0}</p>
        <p><strong>Duplicate Equipment Number:</strong> {preview.validation?.duplicateEquipmentNumber ?? 0}</p>
        <p><strong>Blank Location:</strong> {preview.validation?.blankLocation ?? 0}</p>
        <p><strong>Reject Items:</strong> {preview.validation?.rejectItems ?? 0}</p>
        <p><strong>Pending Items:</strong> {preview.validation?.pendingItems ?? 0}</p>
        <p><strong>Sites Detected:</strong> {preview.validation?.newSitesDetected ?? preview.uniqueSites}</p>
        <p><strong>Import Readiness:</strong> {(preview.validation?.missingEquipmentNumber || preview.validation?.blankLocation) ? "Ready with skipped invalid rows" : "Ready for Controlled Import"}</p>

        <h4>Status Summary</h4>
        {Object.entries(preview.statusSummary).slice(0, 8).map(([key, value]) => (
          <p key={key}>{key}: {value}</p>
        ))}

        <div className="v2HeroActions">
          <button
            className="primaryButton"
            type="button"
            disabled={applyingImport || !preview.records?.length}
            onClick={() => applyExcelImport(type, preview)}
          >
            {applyingImport ? "Applying..." : "Apply Import"}
          </button>
        </div>

        <h4>Sample Rows</h4>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Number</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((item, index) => (
                <tr key={index}>
                  <td>{item.equipment || "-"}</td>
                  <td>{item.serial || "-"}</td>
                  <td>{item.location || "-"}</td>
                  <td>{item.status || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Admin Only</p>
          <h3>Excel Import Center</h3>
          <p>Safe Excel import preview. Files are read in browser and no live database overwrite happens.</p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip"><span>Status</span><strong>Preview Mode</strong></div>
          <div className="summaryChip"><span>Database</span><strong>Not Updated</strong></div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title="Service Related Products" action="Asset / PM source">
          <div className="formGrid">
            <label className="wide">
              Upload Service Related Products Excel
              <input type="file" accept=".xlsx,.xls" onChange={(e) => readExcelFile(e.target.files?.[0], "service")} />
            </label>
            <PreviewCard preview={servicePreview} type="service" />
          </div>
        </Panel>

        <Panel title="Master Calibration Log" action="Calibration source">
          <div className="formGrid">
            <label className="wide">
              Upload Master Calibration Log Excel
              <input type="file" accept=".xlsx,.xls" onChange={(e) => readExcelFile(e.target.files?.[0], "calibration")} />
            </label>
            <PreviewCard preview={calibrationPreview} type="calibration" />
          </div>
        </Panel>
      </div>

      <Panel title="Import Safety Note" action="Recommended workflow">
        <div className="importGuide">
          <p><strong>Current Mode:</strong> Preview only. No live database overwrite.</p>
          <p><strong>Next Step:</strong> After client confirms mapping, Apply Import can be enabled.</p>
          <p><strong>Status:</strong> {importMessage || "Upload an Excel file to generate preview."}</p>
        </div>
      </Panel>
    </section>
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


function isSiteActive(site) {
  const value = site?.is_active;
  if (value === undefined || value === null) return true;
  return value === true || value === 1 || value === "1";
}

function isRemoteSite(site) {
  const value = site?.is_remote;
  return value === true || value === 1 || value === "1";
}



function calibrationStatusFromExpiry(expiryDate) {
  if (!expiryDate) return { label: "No Expiry", className: "neutral", days: null };

  const today = new Date();
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return { label: "Invalid Date", className: "neutral", days: null };

  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (days < 0) return { label: "Due", className: "danger", days };
  if (days <= 10) return { label: "Critical", className: "warning", days };
  if (days <= 30) return { label: "Attention Required", className: "warning", days };
  return { label: "Valid", className: "success", days };
}



function PmChecklistPage({ assets, sites, auth }) {
  const checklistOptions = [
    "F HSE 14 – Monthly Visual Inspection of Portable Fire Extinguishers",
    "F HSE 16 – Weekly Vehicle Check List",
    "F HSE 18 – Forklift Truck Operator Pre-Use Checks",
    "F STR 04 – Equipment Damage and Repair Report",
    "F STR 05 – Preventive Maintenance – Electrical Grinder, Blower, Drilling Machine",
    "F STR 08 – Equipment Check List – Rig Site",
    "F STR 16-A – Equipment Inspection – PM Checklist",
    "F STR 16-B – Equipment Inspection – PM Checklist",
    "F STR 16-C – Equipment Inspection – PM Checklist",
    "F STR 17 – Generator Checklist",
    "F STR 18 – Shot Blasting Machine Checklist",
    "F STR 19 – Portable Air Compressor Daily Checklist",
    "F STR 20 – List of Service-Related Equipment",
    "F STR 21 – Monitoring of Shelf-Life Sensitive Items",
    "F STR 22 – Portable Diesel or Petrol Generator Checklist",
    "F STR 25 – High Pressure Water Jet Unit Checklist",
    "F QMS 11 – Calibration Status of Inspection, Monitoring and Test Equipment",
    "F RA 23 – Textile Item Maintenance Checklist",
    "F RA 24 – Metal Items and Helmet Maintenance Checklist",
    "F STR 26 – List of Critical Spares",
    "F STR 27 – Equipment Usage History",
    "F STR 29 – Preventive Maintenance, Inspection and Test Plan",
    "F STR 30 – MSDS Assessment",
  ];

  const emptyForm = {
    asset_id: "",
    checklist_type: "PM",
    checklist_name: "F STR 16-A – Equipment Inspection – PM Checklist",
    checklist_date: "",
    performed_by: "",
    pm_frequency: "Monthly",
    result: "Pass",
    next_due_date: "",
    attachment_ref: "",
    remarks: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [equipmentName, setEquipmentName] = useState("");

  const selectedAsset = assets.find((asset) => String(pickId(asset)) === String(form.asset_id));

  const categories = useMemo(() => Array.from(new Set(assets.map((asset) => asset?.category || "Uncategorized"))).sort(), [assets]);

  const equipmentNames = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((asset) => !category || (asset?.category || "Uncategorized") === category)
          .map((asset) => getAssetName(asset))
      )
    ).sort();
  }, [assets, category]);

  const equipmentNumbers = useMemo(() => {
    return assets.filter((asset) => {
      const categoryMatch = !category || (asset?.category || "Uncategorized") === category;
      const nameMatch = !equipmentName || getAssetName(asset) === equipmentName;
      return categoryMatch && nameMatch;
    });
  }, [assets, category, equipmentName]);

  async function loadRecords() {
    try {
      const response = await fetch(`${API_BASE}/api/checklist-records`, {
        headers: createAuthHeaders(auth?.token),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load PM records.");
      }
      setRecords(normalizeList(result, "checklist_records"));
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to load PM records.");
    }
  }

  useEffect(() => {
    loadRecords();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId("");
    setCategory("");
    setEquipmentName("");
    setMessage("");
  }

  function startEdit(record) {
    setEditingId(String(record.id));
    setCategory(record.category || "");
    setEquipmentName(record.equipment_name || "");
    setForm({
      asset_id: String(record.asset_id || ""),
      checklist_type: record.checklist_type || "PM",
      checklist_name: record.checklist_name || "F STR 16-A – Equipment Inspection – PM Checklist",
      checklist_date: record.checklist_date || "",
      performed_by: record.performed_by || "",
      pm_frequency: record.pm_frequency || "Monthly",
      result: record.result || "Pass",
      next_due_date: record.next_due_date || "",
      attachment_ref: record.attachment_ref || "",
      remarks: record.remarks || "",
    });
    setMessage("Editing selected PM record.");
  }

  async function saveRecord(e) {
    e.preventDefault();

    if (!form.asset_id || !form.checklist_type || !form.checklist_date) {
      setMessage("Equipment Number, Checklist Category and Inspection Date are required.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        editingId ? `${API_BASE}/api/checklist-records/${editingId}` : `${API_BASE}/api/checklist-records`,
        {
          method: editingId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify(form),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save PM checklist.");
      }

      setMessage(editingId ? "PM checklist updated successfully." : "PM checklist saved successfully.");
      resetForm();
      await loadRecords();
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to save PM checklist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">PM Access Module</p>
          <h3>PM Checklist</h3>
          <p>Separate PM module for inspection and preventive maintenance records. This module can be assigned to wider users.</p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip"><span>PM Records</span><strong>{records.length}</strong></div>
          <div className="summaryChip"><span>Assets</span><strong>{assets.length}</strong></div>
          <div className="summaryChip"><span>Sites</span><strong>{sites.length}</strong></div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title={editingId ? "Update PM Checklist" : "Add PM Checklist"} action="PM users access">
          <form className="formGrid" onSubmit={saveRecord}>
            <label>
              Category
              <select value={category} onChange={(e) => { setCategory(e.target.value); setEquipmentName(""); updateForm("asset_id", ""); }}>
                <option value="">Choose category</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Equipment Name
              <select value={equipmentName} onChange={(e) => { setEquipmentName(e.target.value); updateForm("asset_id", ""); }}>
                <option value="">Choose equipment name</option>
                {equipmentNames.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Equipment Number
              <select value={form.asset_id} onChange={(e) => updateForm("asset_id", e.target.value)}>
                <option value="">Choose equipment number</option>
                {equipmentNumbers.map((asset) => <option key={pickId(asset)} value={pickId(asset)}>{getAssetSerial(asset)}</option>)}
              </select>
            </label>

            <label>
              Site
              <input value={selectedAsset ? getCurrentSiteName(selectedAsset, sites) : ""} readOnly placeholder="Auto shown" />
            </label>

            <label>
              Checklist Category
              <select value={form.checklist_type} onChange={(e) => updateForm("checklist_type", e.target.value)}>
                <option value="PM">PM</option>
                <option value="Inspection">Inspection</option>
                <option value="NDT">NDT</option>
              </select>
            </label>

            <label>
              Checklist Name / Form
              <select value={form.checklist_name} onChange={(e) => updateForm("checklist_name", e.target.value)}>
                {checklistOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Inspection Date
              <input type="date" value={form.checklist_date} onChange={(e) => updateForm("checklist_date", e.target.value)} />
            </label>

            <label>
              Inspector Name
              <input value={form.performed_by} onChange={(e) => updateForm("performed_by", e.target.value)} placeholder="Inspector name" />
            </label>

            <label>
              PM Frequency
              <select value={form.pm_frequency} onChange={(e) => updateForm("pm_frequency", e.target.value)}>
                <option value="Monthly">Monthly</option>
                <option value="3 Months">3 Months</option>
                <option value="6 Months">6 Months</option>
                <option value="Yearly">Yearly</option>
                <option value="As Required">As Required</option>
              </select>
            </label>

            <label>
              Result
              <select value={form.result} onChange={(e) => updateForm("result", e.target.value)}>
                <option value="Pass">Pass</option>
                <option value="Fail">Fail</option>
                <option value="Observation">Observation</option>
                <option value="Pending">Pending</option>
              </select>
            </label>

            <label>
              Attachment Ref
              <input value={form.attachment_ref} onChange={(e) => updateForm("attachment_ref", e.target.value)} placeholder="PM report file/link reference" />
            </label>

            <label className="wide">
              Remarks
              <input value={form.remarks} onChange={(e) => updateForm("remarks", e.target.value)} placeholder="Remarks" />
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Update PM" : "Save PM"}</button>
              <button className="ghostButton" type="button" onClick={resetForm}>Clear</button>
            </div>

            {message && <div className="messageBox wide">{message}</div>}
          </form>
        </Panel>

        <Panel title="PM Checklist Records" action={`${records.length} record(s)`}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Number</th>
                  <th>Site</th>
                  <th>Checklist</th>
                  <th>Date</th>
                  <th>Frequency</th>
                  <th>Result</th>
                  <th>Attachment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.equipment_name || "-"}</strong></td>
                    <td>{record.serial_number || "-"}</td>
                    <td>{record.current_site_name || "-"}</td>
                    <td>{record.checklist_name || record.checklist_type || "-"}</td>
                    <td>{record.checklist_date || "-"}</td>
                    <td>{record.pm_frequency || "-"}</td>
                    <td><span className={`badge ${record.result === "Fail" ? "danger" : record.result === "Pending" ? "warning" : "success"}`}>{record.result || "-"}</span></td>
                    <td>{record.attachment_ref || "-"}</td>
                    <td><button className="ghostButton" type="button" onClick={() => startEdit(record)}>Edit</button></td>
                  </tr>
                ))}
                {!records.length && <tr><td colSpan="9"><Empty text="No PM checklist records found." /></td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function RepairHistoryPage({ assets, sites, auth }) {
  const emptyForm = {
    asset_id: "",
    site_id: "",
    repair_date: "",
    fault_description: "",
    action_taken: "",
    repaired_by: "",
    parts_used: "",
    status: "Open",
    attachment_ref: "",
    remarks: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [equipmentName, setEquipmentName] = useState("");

  const selectedAsset = assets.find((asset) => String(pickId(asset)) === String(form.asset_id));

  const categories = useMemo(() => Array.from(new Set(assets.map((asset) => asset?.category || "Uncategorized"))).sort(), [assets]);

  const equipmentNames = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((asset) => !category || (asset?.category || "Uncategorized") === category)
          .map((asset) => getAssetName(asset))
      )
    ).sort();
  }, [assets, category]);

  const equipmentNumbers = useMemo(() => {
    return assets.filter((asset) => {
      const categoryMatch = !category || (asset?.category || "Uncategorized") === category;
      const nameMatch = !equipmentName || getAssetName(asset) === equipmentName;
      return categoryMatch && nameMatch;
    });
  }, [assets, category, equipmentName]);

  async function loadRecords() {
    try {
      const response = await fetch(`${API_BASE}/api/asset-repairs`, {
        headers: createAuthHeaders(auth?.token),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load repair history.");
      }
      setRecords(normalizeList(result, "asset_repairs"));
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to load repair history.");
    }
  }

  useEffect(() => {
    loadRecords();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId("");
    setCategory("");
    setEquipmentName("");
    setMessage("");
  }

  function startEdit(record) {
    setEditingId(String(record.id));
    setCategory(record.category || "");
    setEquipmentName(record.equipment_name || "");
    setForm({
      asset_id: String(record.asset_id || ""),
      site_id: record.site_id ? String(record.site_id) : "",
      repair_date: record.repair_date || "",
      fault_description: record.fault_description || "",
      action_taken: record.action_taken || "",
      repaired_by: record.repaired_by || "",
      parts_used: record.parts_used || "",
      status: record.status || "Open",
      attachment_ref: record.attachment_ref || "",
      remarks: record.remarks || "",
    });
    setMessage("Editing selected repair history record.");
  }

  async function saveRecord(e) {
    e.preventDefault();

    if (!form.asset_id || !form.repair_date || !form.fault_description.trim()) {
      setMessage("Equipment Number, Repair Date and Fault / Issue are required.");
      return;
    }

    setSaving(true);
    setMessage("");

    const payload = {
      ...form,
      site_id: form.site_id || selectedAsset?.current_site_id || null,
    };

    try {
      const response = await fetch(
        editingId ? `${API_BASE}/api/asset-repairs/${editingId}` : `${API_BASE}/api/asset-repairs`,
        {
          method: editingId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save repair history.");
      }

      setMessage(editingId ? "Repair history updated successfully." : "Repair history saved successfully.");
      resetForm();
      await loadRecords();
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to save repair history.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Store Access Module</p>
          <h3>Asset Repair History</h3>
          <p>Separate repair module for store/admin users only. Repair, parts, and equipment maintenance history remain controlled.</p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip"><span>Repairs</span><strong>{records.length}</strong></div>
          <div className="summaryChip"><span>Assets</span><strong>{assets.length}</strong></div>
          <div className="summaryChip"><span>Sites</span><strong>{sites.length}</strong></div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title={editingId ? "Update Asset Repair History" : "Add Asset Repair History"} action="Store users access">
          <form className="formGrid" onSubmit={saveRecord}>
            <label>
              Category
              <select value={category} onChange={(e) => { setCategory(e.target.value); setEquipmentName(""); updateForm("asset_id", ""); }}>
                <option value="">Choose category</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Equipment Name
              <select value={equipmentName} onChange={(e) => { setEquipmentName(e.target.value); updateForm("asset_id", ""); }}>
                <option value="">Choose equipment name</option>
                {equipmentNames.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Equipment Number
              <select value={form.asset_id} onChange={(e) => updateForm("asset_id", e.target.value)}>
                <option value="">Choose equipment number</option>
                {equipmentNumbers.map((asset) => <option key={pickId(asset)} value={pickId(asset)}>{getAssetSerial(asset)}</option>)}
              </select>
            </label>

            <label>
              Site
              <select value={form.site_id || selectedAsset?.current_site_id || ""} onChange={(e) => updateForm("site_id", e.target.value)}>
                <option value="">Auto / choose site</option>
                {sites.filter(isSiteActive).map((site) => <option key={pickId(site)} value={pickId(site)}>{getSiteName(site)}</option>)}
              </select>
            </label>

            <label>
              Repair Date
              <input type="date" value={form.repair_date} onChange={(e) => updateForm("repair_date", e.target.value)} />
            </label>

            <label>
              Status
              <select value={form.status} onChange={(e) => updateForm("status", e.target.value)}>
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Pending Parts">Pending Parts</option>
                <option value="Completed">Completed</option>
                <option value="Closed">Closed</option>
              </select>
            </label>

            <label className="wide">
              Fault / Issue
              <input value={form.fault_description} onChange={(e) => updateForm("fault_description", e.target.value)} placeholder="Fault / issue description" />
            </label>

            <label>
              Action Taken
              <input value={form.action_taken} onChange={(e) => updateForm("action_taken", e.target.value)} placeholder="Action taken" />
            </label>

            <label>
              Repaired By
              <input value={form.repaired_by} onChange={(e) => updateForm("repaired_by", e.target.value)} placeholder="Technician / team" />
            </label>

            <label>
              Parts Used
              <input value={form.parts_used} onChange={(e) => updateForm("parts_used", e.target.value)} placeholder="Parts used" />
            </label>

            <label>
              Attachment Ref
              <input value={form.attachment_ref} onChange={(e) => updateForm("attachment_ref", e.target.value)} placeholder="Repair photo/file/link reference" />
            </label>

            <label className="wide">
              Remarks
              <input value={form.remarks} onChange={(e) => updateForm("remarks", e.target.value)} placeholder="Remarks" />
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Update Repair" : "Save Repair"}</button>
              <button className="ghostButton" type="button" onClick={resetForm}>Clear</button>
            </div>

            {message && <div className="messageBox wide">{message}</div>}
          </form>
        </Panel>

        <Panel title="Asset Repair History Records" action={`${records.length} record(s)`}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Number</th>
                  <th>Site</th>
                  <th>Repair Date</th>
                  <th>Fault / Issue</th>
                  <th>Repaired By</th>
                  <th>Status</th>
                  <th>Attachment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.equipment_name || "-"}</strong></td>
                    <td>{record.serial_number || "-"}</td>
                    <td>{record.site_name || "-"}</td>
                    <td>{record.repair_date || "-"}</td>
                    <td>{record.fault_description || "-"}</td>
                    <td>{record.repaired_by || "-"}</td>
                    <td><span className={`badge ${record.status === "Completed" || record.status === "Closed" ? "success" : record.status === "Pending Parts" ? "warning" : "neutral"}`}>{record.status || "-"}</span></td>
                    <td>{record.attachment_ref || "-"}</td>
                    <td><button className="ghostButton" type="button" onClick={() => startEdit(record)}>Edit</button></td>
                  </tr>
                ))}
                {!records.length && <tr><td colSpan="9"><Empty text="No repair history records found." /></td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function PmMaintenancePage({ assets, sites, auth }) {
  const emptyPmForm = {
    asset_id: "",
    checklist_type: "PM",
    checklist_date: "",
    performed_by: "",
    pm_frequency: "Monthly",
    result: "Valid",
    next_due_date: "",
    attachment_ref: "",
    remarks: "",
  };

  const emptyRepairForm = {
    asset_id: "",
    site_id: "",
    repair_date: "",
    fault_description: "",
    action_taken: "",
    repaired_by: "",
    parts_used: "",
    status: "Open",
    attachment_ref: "",
    remarks: "",
  };

  const [pmForm, setPmForm] = useState(emptyPmForm);
  const [repairForm, setRepairForm] = useState(emptyRepairForm);
  const [pmRecords, setPmRecords] = useState([]);
  const [repairRecords, setRepairRecords] = useState([]);
  const [editingPmId, setEditingPmId] = useState("");
  const [editingRepairId, setEditingRepairId] = useState("");
  const [savingPm, setSavingPm] = useState(false);
  const [savingRepair, setSavingRepair] = useState(false);
  const [pmMessage, setPmMessage] = useState("");
  const [repairMessage, setRepairMessage] = useState("");

  const [pmCategory, setPmCategory] = useState("");
  const [pmEquipmentName, setPmEquipmentName] = useState("");
  const [repairCategory, setRepairCategory] = useState("");
  const [repairEquipmentName, setRepairEquipmentName] = useState("");

  const selectedPmAsset = assets.find((asset) => String(pickId(asset)) === String(pmForm.asset_id));
  const selectedRepairAsset = assets.find((asset) => String(pickId(asset)) === String(repairForm.asset_id));

  const categories = useMemo(() => {
    return Array.from(new Set(assets.map((asset) => asset?.category || "Uncategorized"))).sort();
  }, [assets]);

  const pmEquipmentNames = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((asset) => !pmCategory || (asset?.category || "Uncategorized") === pmCategory)
          .map((asset) => getAssetName(asset))
      )
    ).sort();
  }, [assets, pmCategory]);

  const pmEquipmentNumbers = useMemo(() => {
    return assets.filter((asset) => {
      const categoryMatch = !pmCategory || (asset?.category || "Uncategorized") === pmCategory;
      const nameMatch = !pmEquipmentName || getAssetName(asset) === pmEquipmentName;
      return categoryMatch && nameMatch;
    });
  }, [assets, pmCategory, pmEquipmentName]);

  const repairEquipmentNames = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((asset) => !repairCategory || (asset?.category || "Uncategorized") === repairCategory)
          .map((asset) => getAssetName(asset))
      )
    ).sort();
  }, [assets, repairCategory]);

  const repairEquipmentNumbers = useMemo(() => {
    return assets.filter((asset) => {
      const categoryMatch = !repairCategory || (asset?.category || "Uncategorized") === repairCategory;
      const nameMatch = !repairEquipmentName || getAssetName(asset) === repairEquipmentName;
      return categoryMatch && nameMatch;
    });
  }, [assets, repairCategory, repairEquipmentName]);

  async function loadPmRecords() {
    try {
      const response = await fetch(`${API_BASE}/api/checklist-records`, {
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load PM records.");
      }

      setPmRecords(getCleanPmRecords(result));
    } catch (error) {
      console.error(error);
      setPmMessage(error.message || "Unable to load PM records.");
    }
  }

  async function loadRepairRecords() {
    try {
      const response = await fetch(`${API_BASE}/api/asset-repairs`, {
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load repair history.");
      }

      setRepairRecords(normalizeList(result, "asset_repairs"));
    } catch (error) {
      console.error(error);
      setRepairMessage(error.message || "Unable to load repair history.");
    }
  }

  useEffect(() => {
    loadPmRecords();
    loadRepairRecords();
  }, []);

  function updatePmForm(field, value) {
    setPmForm((current) => ({ ...current, [field]: value }));
  }

  function updateRepairForm(field, value) {
    setRepairForm((current) => ({ ...current, [field]: value }));
  }

  function resetPmForm() {
    setPmForm(emptyPmForm);
    setEditingPmId("");
    setPmCategory("");
    setPmEquipmentName("");
    setPmMessage("");
  }

  function resetRepairForm() {
    setRepairForm(emptyRepairForm);
    setEditingRepairId("");
    setRepairCategory("");
    setRepairEquipmentName("");
    setRepairMessage("");
  }

  function startPmEdit(record) {
    setEditingPmId(String(record.id));
    setPmCategory(record.category || "");
    setPmEquipmentName(record.equipment_name || "");
    setPmForm({
      asset_id: String(record.asset_id || ""),
      checklist_type: record.checklist_type || "PM",
      checklist_date: record.checklist_date || "",
      performed_by: record.performed_by || "",
      pm_frequency: record.pm_frequency || "Monthly",
      result: record.result || "Pass",
      next_due_date: record.next_due_date || "",
      attachment_ref: record.attachment_ref || "",
      remarks: record.remarks || "",
    });
    setPmMessage("Editing selected PM record.");
  }

  function startRepairEdit(record) {
    setEditingRepairId(String(record.id));
    setRepairCategory(record.category || "");
    setRepairEquipmentName(record.equipment_name || "");
    setRepairForm({
      asset_id: String(record.asset_id || ""),
      site_id: record.site_id ? String(record.site_id) : "",
      repair_date: record.repair_date || "",
      fault_description: record.fault_description || "",
      action_taken: record.action_taken || "",
      repaired_by: record.repaired_by || "",
      parts_used: record.parts_used || "",
      status: record.status || "Open",
      attachment_ref: record.attachment_ref || "",
      remarks: record.remarks || "",
    });
    setRepairMessage("Editing selected repair history record.");
  }

  async function savePmRecord(e) {
    e.preventDefault();

    if (!pmForm.asset_id || !pmForm.checklist_type || !pmForm.checklist_date) {
      setPmMessage("Equipment Number, Checklist Type and Inspection Date are required.");
      return;
    }

    setSavingPm(true);
    setPmMessage("");

    try {
      const response = await fetch(
        editingPmId ? `${API_BASE}/api/checklist-records/${editingPmId}` : `${API_BASE}/api/checklist-records`,
        {
          method: editingPmId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify(pmForm),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save PM checklist.");
      }

      setPmMessage(editingPmId ? "PM checklist updated successfully." : "PM checklist saved successfully.");
      setPmForm(emptyPmForm);
      setEditingPmId("");
      setPmCategory("");
      setPmEquipmentName("");
      await loadPmRecords();
    } catch (error) {
      console.error(error);
      setPmMessage(error.message || "Unable to save PM checklist.");
    } finally {
      setSavingPm(false);
    }
  }

  async function saveRepairRecord(e) {
    e.preventDefault();

    if (!repairForm.asset_id || !repairForm.repair_date || !repairForm.fault_description.trim()) {
      setRepairMessage("Equipment Number, Repair Date and Fault / Issue are required.");
      return;
    }

    setSavingRepair(true);
    setRepairMessage("");

    const payload = {
      ...repairForm,
      site_id: repairForm.site_id || selectedRepairAsset?.current_site_id || null,
    };

    try {
      const response = await fetch(
        editingRepairId ? `${API_BASE}/api/asset-repairs/${editingRepairId}` : `${API_BASE}/api/asset-repairs`,
        {
          method: editingRepairId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save repair history.");
      }

      setRepairMessage(editingRepairId ? "Repair history updated successfully." : "Repair history saved successfully.");
      setRepairForm(emptyRepairForm);
      setEditingRepairId("");
      setRepairCategory("");
      setRepairEquipmentName("");
      await loadRepairRecords();
    } catch (error) {
      console.error(error);
      setRepairMessage(error.message || "Unable to save repair history.");
    } finally {
      setSavingRepair(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Maintenance Control</p>
          <h3>PM / Checklist & Asset Repair History</h3>
          <p>
            Simplified PM records with attachment reference plus complete equipment-wise asset repair history.
          </p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip">
            <span>PM Records</span>
            <strong>{pmRecords.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Repairs</span>
            <strong>{repairRecords.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Assets</span>
            <strong>{assets.length}</strong>
          </div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title={editingPmId ? "Update PM Checklist" : "Add PM Checklist"} action="Simplified PM record">
          <form className="formGrid" onSubmit={savePmRecord}>
            <label>
              Category
              <select value={pmCategory} onChange={(e) => { setPmCategory(e.target.value); setPmEquipmentName(""); updatePmForm("asset_id", ""); }}>
                <option value="">Choose category</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>

            <label>
              Equipment Name
              <select value={pmEquipmentName} onChange={(e) => { setPmEquipmentName(e.target.value); updatePmForm("asset_id", ""); }}>
                <option value="">Choose equipment name</option>
                {pmEquipmentNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>

            <label>
              Equipment Number
              <select value={pmForm.asset_id} onChange={(e) => updatePmForm("asset_id", e.target.value)}>
                <option value="">Choose equipment number</option>
                {pmEquipmentNumbers.map((asset) => <option key={pickId(asset)} value={pickId(asset)}>{getAssetSerial(asset)}</option>)}
              </select>
            </label>

            <label>
              Site
              <input value={selectedPmAsset ? getCurrentSiteName(selectedPmAsset, sites) : ""} readOnly placeholder="Auto shown" />
            </label>

            <label>
              Checklist Category
              <select value={pmForm.checklist_type} onChange={(e) => updatePmForm("checklist_type", e.target.value)}>
                <option value="PM">PM</option>
                <option value="Inspection">Inspection</option>
                <option value="NDT">NDT</option>
              </select>
            </label>

            <label>
              Checklist Name / Form
              <select value={pmForm.checklist_name} onChange={(e) => updatePmForm("checklist_name", e.target.value)}>
                <option value="F HSE 14 – Monthly Visual Inspection of Portable Fire Extinguishers">F HSE 14 – Monthly Visual Inspection of Portable Fire Extinguishers</option>
                <option value="F HSE 16 – Weekly Vehicle Check List">F HSE 16 – Weekly Vehicle Check List</option>
                <option value="F HSE 18 – Forklift Truck Operator Pre-Use Checks">F HSE 18 – Forklift Truck Operator Pre-Use Checks</option>
                <option value="F STR 04 – Equipment Damage and Repair Report">F STR 04 – Equipment Damage and Repair Report</option>
                <option value="F STR 05 – Preventive Maintenance – Electrical Grinder, Blower, Drilling Machine">F STR 05 – Preventive Maintenance – Electrical Grinder, Blower, Drilling Machine</option>
                <option value="F STR 08 – Equipment Check List – Rig Site">F STR 08 – Equipment Check List – Rig Site</option>
                <option value="F STR 16-A – Equipment Inspection – PM Checklist">F STR 16-A – Equipment Inspection – PM Checklist</option>
                <option value="F STR 16-B – Equipment Inspection – PM Checklist">F STR 16-B – Equipment Inspection – PM Checklist</option>
                <option value="F STR 16-C – Equipment Inspection – PM Checklist">F STR 16-C – Equipment Inspection – PM Checklist</option>
                <option value="F STR 17 – Generator Checklist">F STR 17 – Generator Checklist</option>
                <option value="F STR 18 – Shot Blasting Machine Checklist">F STR 18 – Shot Blasting Machine Checklist</option>
                <option value="F STR 19 – Portable Air Compressor Daily Checklist">F STR 19 – Portable Air Compressor Daily Checklist</option>
                <option value="F STR 20 – List of Service-Related Equipment">F STR 20 – List of Service-Related Equipment</option>
                <option value="F STR 21 – Monitoring of Shelf-Life Sensitive Items">F STR 21 – Monitoring of Shelf-Life Sensitive Items</option>
                <option value="F STR 22 – Portable Diesel or Petrol Generator Checklist">F STR 22 – Portable Diesel or Petrol Generator Checklist</option>
                <option value="F STR 25 – High Pressure Water Jet Unit Checklist">F STR 25 – High Pressure Water Jet Unit Checklist</option>
                <option value="F QMS 11 – Calibration Status of Inspection, Monitoring and Test Equipment">F QMS 11 – Calibration Status of Inspection, Monitoring and Test Equipment</option>
                <option value="F RA 23 – Textile Item Maintenance Checklist">F RA 23 – Textile Item Maintenance Checklist</option>
                <option value="F RA 24 – Metal Items and Helmet Maintenance Checklist">F RA 24 – Metal Items and Helmet Maintenance Checklist</option>
                <option value="F STR 26 – List of Critical Spares">F STR 26 – List of Critical Spares</option>
                <option value="F STR 27 – Equipment Usage History">F STR 27 – Equipment Usage History</option>
                <option value="F STR 29 – Preventive Maintenance, Inspection and Test Plan">F STR 29 – Preventive Maintenance, Inspection and Test Plan</option>
                <option value="F STR 30 – MSDS Assessment">F STR 30 – MSDS Assessment</option>
              </select>
            </label>

            <label>
              Inspection Date
              <input type="date" value={pmForm.checklist_date} onChange={(e) => updatePmForm("checklist_date", e.target.value)} />
            </label>

            <label>
              Inspector Name
              <input value={pmForm.performed_by} onChange={(e) => updatePmForm("performed_by", e.target.value)} placeholder="Inspector name" />
            </label>

            <label>
              PM Frequency
              <select value={pmForm.pm_frequency} onChange={(e) => updatePmForm("pm_frequency", e.target.value)}>
                <option value="Monthly">Monthly</option>
                <option value="3 Months">3 Months</option>
                <option value="6 Months">6 Months</option>
                <option value="Yearly">Yearly</option>
                <option value="As Required">As Required</option>
              </select>
            </label>

            <label>
              Result
              <select value={pmForm.result} onChange={(e) => updatePmForm("result", e.target.value)}>
                <option value="Valid">Valid</option>
                <option value="Pass">Pass</option>
                <option value="Fail">Fail</option>
                <option value="Observation">Observation</option>
                <option value="Pending">Pending</option>
              </select>
            </label>

            <label>
              Attachment Ref
              <input value={pmForm.attachment_ref} onChange={(e) => updatePmForm("attachment_ref", e.target.value)} placeholder="Calibration certificate file name / SharePoint ref later" />
            </label>

            <label className="wide">
              Remarks
              <input value={pmForm.remarks} onChange={(e) => updatePmForm("remarks", e.target.value)} placeholder="Remarks" />
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={savingPm}>{savingPm ? "Saving..." : editingPmId ? "Update PM" : "Save PM"}</button>
              <button className="ghostButton" type="button" onClick={resetPmForm}>Clear</button>
            </div>

            {pmMessage && <div className="messageBox wide">{pmMessage}</div>}
          </form>
        </Panel>

        <Panel title={editingRepairId ? "Update Asset Repair History" : "Add Asset Repair History"} action="Equipment-wise maintenance">
          <form className="formGrid" onSubmit={saveRepairRecord}>
            <label>
              Category
              <select value={repairCategory} onChange={(e) => { setRepairCategory(e.target.value); setRepairEquipmentName(""); updateRepairForm("asset_id", ""); }}>
                <option value="">Choose category</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>

            <label>
              Equipment Name
              <select value={repairEquipmentName} onChange={(e) => { setRepairEquipmentName(e.target.value); updateRepairForm("asset_id", ""); }}>
                <option value="">Choose equipment name</option>
                {repairEquipmentNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>

            <label>
              Equipment Number
              <select value={repairForm.asset_id} onChange={(e) => updateRepairForm("asset_id", e.target.value)}>
                <option value="">Choose equipment number</option>
                {repairEquipmentNumbers.map((asset) => <option key={pickId(asset)} value={pickId(asset)}>{getAssetSerial(asset)}</option>)}
              </select>
            </label>

            <label>
              Site
              <select value={repairForm.site_id || selectedRepairAsset?.current_site_id || ""} onChange={(e) => updateRepairForm("site_id", e.target.value)}>
                <option value="">Auto / choose site</option>
                {sites.filter(isSiteActive).map((site) => <option key={pickId(site)} value={pickId(site)}>{getSiteName(site)}</option>)}
              </select>
            </label>

            <label>
              Repair Date
              <input type="date" value={repairForm.repair_date} onChange={(e) => updateRepairForm("repair_date", e.target.value)} />
            </label>

            <label>
              Status
              <select value={repairForm.status} onChange={(e) => updateRepairForm("status", e.target.value)}>
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Pending Parts">Pending Parts</option>
                <option value="Completed">Completed</option>
                <option value="Closed">Closed</option>
              </select>
            </label>

            <label className="wide">
              Fault / Issue
              <input value={repairForm.fault_description} onChange={(e) => updateRepairForm("fault_description", e.target.value)} placeholder="Fault / issue description" />
            </label>

            <label>
              Action Taken
              <input value={repairForm.action_taken} onChange={(e) => updateRepairForm("action_taken", e.target.value)} placeholder="Action taken" />
            </label>

            <label>
              Repaired By
              <input value={repairForm.repaired_by} onChange={(e) => updateRepairForm("repaired_by", e.target.value)} placeholder="Technician / team" />
            </label>

            <label>
              Parts Used
              <input value={repairForm.parts_used} onChange={(e) => updateRepairForm("parts_used", e.target.value)} placeholder="Parts used" />
            </label>

            <label>
              Attachment Ref
              <input value={repairForm.attachment_ref} onChange={(e) => updateRepairForm("attachment_ref", e.target.value)} placeholder="Photo/file name later" />
            </label>

            <label className="wide">
              Remarks
              <input value={repairForm.remarks} onChange={(e) => updateRepairForm("remarks", e.target.value)} placeholder="Remarks" />
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={savingRepair}>{savingRepair ? "Saving..." : editingRepairId ? "Update Repair" : "Save Repair"}</button>
              <button className="ghostButton" type="button" onClick={resetRepairForm}>Clear</button>
            </div>

            {repairMessage && <div className="messageBox wide">{repairMessage}</div>}
          </form>
        </Panel>
      </div>

      <div className="twoColumn">
        <Panel title="PM Checklist Records" action={`${pmRecords.length} record(s)`}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Number</th>
                  <th>Site</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Frequency</th>
                  <th>Result</th>
                  <th>Attachment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pmRecords.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.equipment_name || "-"}</strong></td>
                    <td>{record.serial_number || "-"}</td>
                    <td>{record.current_site_name || "-"}</td>
                    <td>{record.checklist_name || record.checklist_type || "-"}</td>
                    <td>{record.checklist_date || "-"}</td>
                    <td>{record.pm_frequency || "-"}</td>
                    <td><span className={`badge ${record.result === "Fail" ? "danger" : record.result === "Pending" ? "warning" : "success"}`}>{record.result || "-"}</span></td>
                    <td>{record.attachment_ref || "-"}</td>
                    <td><button className="ghostButton" type="button" onClick={() => startPmEdit(record)}>Edit</button></td>
                  </tr>
                ))}
                {!pmRecords.length && (
                  <tr><td colSpan="9"><Empty text="No PM checklist records found." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Asset Repair History" action={`${repairRecords.length} record(s)`}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Number</th>
                  <th>Site</th>
                  <th>Repair Date</th>
                  <th>Fault / Issue</th>
                  <th>Repaired By</th>
                  <th>Status</th>
                  <th>Attachment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {repairRecords.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.equipment_name || "-"}</strong></td>
                    <td>{record.serial_number || "-"}</td>
                    <td>{record.site_name || "-"}</td>
                    <td>{record.repair_date || "-"}</td>
                    <td>{record.fault_description || "-"}</td>
                    <td>{record.repaired_by || "-"}</td>
                    <td><span className={`badge ${record.status === "Completed" || record.status === "Closed" ? "success" : record.status === "Pending Parts" ? "warning" : "neutral"}`}>{record.status || "-"}</span></td>
                    <td>{record.attachment_ref || "-"}</td>
                    <td><button className="ghostButton" type="button" onClick={() => startRepairEdit(record)}>Edit</button></td>
                  </tr>
                ))}
                {!repairRecords.length && (
                  <tr><td colSpan="9"><Empty text="No repair history records found." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function CalibrationPage({ assets, sites, auth }) {
  const emptyForm = {
    asset_id: "",
    certificate_type: "Calibration Certificate",
    certificate_number: "",
    calibration_date: "",
    expiry_date: "",
    calibration_agency: "",
    result: "Valid",
    attachment_ref: "",
    remarks: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [records, setRecords] = useState([]);
  const [editingRecordId, setEditingRecordId] = useState("");
  const [savingRecord, setSavingRecord] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [message, setMessage] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [equipmentNameFilter, setEquipmentNameFilter] = useState("");

  const selectedAsset = assets.find((asset) => String(pickId(asset)) === String(form.asset_id));

  const categories = useMemo(() => {
    return Array.from(new Set(assets.map((asset) => asset?.category || "Uncategorized"))).sort();
  }, [assets]);

  const equipmentNames = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((asset) => !categoryFilter || (asset?.category || "Uncategorized") === categoryFilter)
          .map((asset) => getAssetName(asset))
      )
    ).sort();
  }, [assets, categoryFilter]);

  const equipmentNumbers = useMemo(() => {
    return assets.filter((asset) => {
      const categoryMatch = !categoryFilter || (asset?.category || "Uncategorized") === categoryFilter;
      const nameMatch = !equipmentNameFilter || getAssetName(asset) === equipmentNameFilter;
      return categoryMatch && nameMatch;
    });
  }, [assets, categoryFilter, equipmentNameFilter]);

  async function loadCalibrationRecords() {
    setLoadingRecords(true);

    try {
      const response = await fetch(`${API_BASE}/api/calibration-records`, {
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to load calibration records.");
      }

      setRecords(getCurrentCalibrationRecords(normalizeList(result, "calibration_records")));
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to load calibration records.");
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    loadCalibrationRecords();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingRecordId("");
    setCategoryFilter("");
    setEquipmentNameFilter("");
    setMessage("");
  }

  function startEdit(record) {
    setEditingRecordId(String(record.id));
    setForm({
      asset_id: String(record.asset_id || ""),
      certificate_type: record.certificate_type || "Calibration Certificate",
      certificate_number: record.certificate_number || "",
      calibration_date: record.calibration_date || "",
      expiry_date: record.expiry_date || "",
      calibration_agency: record.calibration_agency || "",
      result: record.result || "Pass",
      attachment_ref: record.attachment_ref || "",
      remarks: record.remarks || "",
    });
    setCategoryFilter(record.category || "");
    setEquipmentNameFilter(record.equipment_name || "");
    setMessage("Editing selected calibration record.");
  }

  async function saveCalibration(e) {
    e.preventDefault();

    if (!form.asset_id || !form.certificate_number.trim() || !form.expiry_date) {
      setMessage("Equipment Number, Certificate Number, and Expiry Date are required.");
      return;
    }

    setSavingRecord(true);
    setMessage("");

    const expiryStatus = calibrationStatusFromExpiry(form.expiry_date);

    try {
      const response = await fetch(
        editingRecordId ? `${API_BASE}/api/calibration-records/${editingRecordId}` : `${API_BASE}/api/calibration-records`,
        {
          method: editingRecordId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify({
            asset_id: form.asset_id,
            certificate_type: form.certificate_type,
            certificate_number: form.certificate_number.trim(),
            calibration_date: form.calibration_date || null,
            expiry_date: form.expiry_date,
            calibration_agency: form.calibration_agency.trim(),
            result: form.result,
            status: expiryStatus.label,
            attachment_ref: form.attachment_ref.trim(),
            remarks: form.remarks.trim(),
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save calibration record.");
      }

      setMessage(editingRecordId ? "Calibration record updated successfully." : "Calibration record saved successfully.");
      setForm(emptyForm);
      setEditingRecordId("");
      setCategoryFilter("");
      setEquipmentNameFilter("");
      await loadCalibrationRecords();
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to save calibration record.");
    } finally {
      setSavingRecord(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Certificate Control</p>
          <h3>Calibration Control</h3>
          <p>
            Record calibration certificates with expiry status, agency, result, attachment reference, and equipment-wise history.
          </p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip">
            <span>Records</span>
            <strong>{records.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Critical</span>
            <strong>{records.filter((record) => calibrationStatusFromExpiry(record.expiry_date).label === "Critical").length}</strong>
          </div>
          <div className="summaryChip">
            <span>Due</span>
            <strong>{records.filter((record) => calibrationStatusFromExpiry(record.expiry_date).label === "Due").length}</strong>
          </div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title={editingRecordId ? "Update Calibration Record" : "Add Calibration Record"} action="Certificate workflow">
          <form className="formGrid" onSubmit={saveCalibration}>
            <label>
              Category
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setEquipmentNameFilter("");
                  updateForm("asset_id", "");
                }}
              >
                <option value="">Choose category</option>
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>

            <label>
              Equipment Name
              <select
                value={equipmentNameFilter}
                onChange={(e) => {
                  setEquipmentNameFilter(e.target.value);
                  updateForm("asset_id", "");
                }}
              >
                <option value="">Choose equipment name</option>
                {equipmentNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            <label>
              Equipment Number
              <select value={form.asset_id} onChange={(e) => updateForm("asset_id", e.target.value)}>
                <option value="">Choose equipment number</option>
                {equipmentNumbers.map((asset) => (
                  <option key={pickId(asset)} value={pickId(asset)}>
                    {getAssetSerial(asset)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Site
              <input value={selectedAsset ? getCurrentSiteName(selectedAsset, sites) : ""} readOnly placeholder="Auto shown after equipment number selection" />
            </label>

            <label>
              Certificate Type
              <select value={form.certificate_type} onChange={(e) => updateForm("certificate_type", e.target.value)}>
                <option value="Calibration Certificate">Calibration Certificate</option>
                <option value="Master OEM Certificate">Master OEM Certificate</option>
                <option value="Third Party Calibration Certificate">Third Party Calibration Certificate</option>
                <option value="Internal Verification Record">Internal Verification Record</option>
              </select>
            </label>

            <label>
              Certificate Number
              <input value={form.certificate_number} onChange={(e) => updateForm("certificate_number", e.target.value)} placeholder="Certificate number" />
            </label>

            <label>
              Calibration Date
              <input type="date" value={form.calibration_date} onChange={(e) => updateForm("calibration_date", e.target.value)} />
            </label>

            <label>
              Expiry Date
              <input type="date" value={form.expiry_date} onChange={(e) => updateForm("expiry_date", e.target.value)} />
            </label>

            <label>
              Calibration Agency
              <input value={form.calibration_agency} onChange={(e) => updateForm("calibration_agency", e.target.value)} placeholder="Agency / lab name" />
            </label>

            <label>
              Result
              <select value={form.result} onChange={(e) => updateForm("result", e.target.value)}>
                <option value="Valid">Valid</option>
                <option value="Pass">Pass</option>
                <option value="Fail">Fail</option>
                <option value="Conditional Pass">Conditional Pass</option>
                <option value="Pending">Pending</option>
              </select>
            </label>

            <label>
              Calibration Certificate Attachment
              <input value={form.attachment_ref} onChange={(e) => updateForm("attachment_ref", e.target.value)} placeholder="Calibration certificate file name / SharePoint ref later" />
            </label>

            <label>
              Remarks
              <input value={form.remarks} onChange={(e) => updateForm("remarks", e.target.value)} placeholder="Remarks" />
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={savingRecord}>
                {savingRecord ? "Saving..." : editingRecordId ? "Update Calibration" : "Save Calibration"}
              </button>
              <button className="ghostButton" type="button" onClick={resetForm}>
                Clear
              </button>
            </div>

            {message && <div className="messageBox wide">{message}</div>}
          </form>
        </Panel>

        <Panel title="Calibration Items Sheet" action={loadingRecords ? "Loading..." : `${records.length} record(s)`}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Number</th>
                  <th>Site</th>
                  <th>Certificate No.</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>Attachment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const expiryStatus = calibrationStatusFromExpiry(record.expiry_date);
                  return (
                    <tr key={record.id}>
                      <td><strong>{record.equipment_name || "-"}</strong></td>
                      <td>{record.serial_number || "-"}</td>
                      <td>{record.current_site_name || "-"}</td>
                      <td>{record.certificate_number || "-"}</td>
                      <td>{record.expiry_date || "-"}</td>
                      <td><span className={`badge ${expiryStatus.className}`}>{expiryStatus.label}</span></td>
                      <td>{record.attachment_ref || "-"}</td>
                      <td>
                        <button className="ghostButton" type="button" onClick={() => startEdit(record)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!records.length && (
                  <tr>
                    <td colSpan="8">
                      <Empty text="No calibration records found." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function AssetMasterPage({ assets, allAssets, sites, auth, query, setQuery, loadData }) {
  const emptyForm = {
    equipment_name: "",
    serial_number: "",
    category: "",
    manufacturer: "",
    model: "",
    current_site_id: "",
    status: "Active",
    remarks: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [editingAssetId, setEditingAssetId] = useState("");
  const [savingAsset, setSavingAsset] = useState(false);
  const [assetMessage, setAssetMessage] = useState("");
  const canManageAssets = normalizeUserRole(auth?.user?.role) === "Admin";

  function updateAssetForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetAssetForm() {
    setForm(emptyForm);
    setEditingAssetId("");
    setAssetMessage("");
  }

  function startAssetEdit(asset) {
    setEditingAssetId(String(pickId(asset)));
    setForm({
      equipment_name: asset?.equipment_name || "",
      serial_number: asset?.serial_number || "",
      category: asset?.category || "",
      manufacturer: asset?.manufacturer || "",
      model: asset?.model || "",
      current_site_id: asset?.current_site_id ? String(asset.current_site_id) : "",
      status: asset?.status || "Active",
      remarks: asset?.remarks || "",
    });
    setAssetMessage("Editing selected asset.");
  }

  async function saveAsset(e) {
    e.preventDefault();

    if (!canManageAssets) {
      setAssetMessage("Only Admin can add or update asset master records.");
      return;
    }

    if (!form.equipment_name.trim() || !form.serial_number.trim()) {
      setAssetMessage("Equipment Name and Equipment Number are required.");
      return;
    }

    setSavingAsset(true);
    setAssetMessage("");

    try {
      const response = await fetch(
        editingAssetId ? `${API_BASE}/api/assets/${editingAssetId}` : `${API_BASE}/api/assets`,
        {
          method: editingAssetId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify({
            equipment_name: form.equipment_name.trim(),
            serial_number: form.serial_number.trim(),
            category: form.category.trim(),
            manufacturer: form.manufacturer.trim(),
            model: form.model.trim(),
            current_site_id: form.current_site_id || null,
            status: form.status,
            remarks: form.remarks.trim(),
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save asset.");
      }

      setAssetMessage(editingAssetId ? "Asset updated successfully." : "Asset added successfully.");
      setForm(emptyForm);
      setEditingAssetId("");
      await loadData();
    } catch (error) {
      console.error(error);
      setAssetMessage(error.message || "Unable to save asset.");
    } finally {
      setSavingAsset(false);
    }
  }

  async function toggleAssetStatus(asset) {
    const assetId = pickId(asset);
    const currentStatus = String(asset?.status || "Active").toLowerCase();
    const isInactive = currentStatus === "inactive" || currentStatus === "retired";
    const nextStatus = isInactive ? "Active" : "Inactive";

    const confirmed = window.confirm(
      nextStatus === "Inactive"
        ? "Deactivate this asset? History will remain safe."
        : "Reactivate this asset?"
    );

    if (!confirmed) return;

    setSavingAsset(true);
    setAssetMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/assets/${assetId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders(auth?.token),
        },
        body: JSON.stringify({
          equipment_name: asset?.equipment_name || asset?.asset_name || asset?.name || "",
          serial_number: asset?.serial_number || asset?.identification_number || asset?.equipment_no || asset?.tag_number || "",
          category: asset?.category || "",
          manufacturer: asset?.manufacturer || "",
          model: asset?.model || "",
          current_site_id: asset?.current_site_id || asset?.site_id || null,
          status: nextStatus,
          remarks: asset?.remarks || "",
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to update asset status.");
      }

      setAssetMessage(`Asset ${nextStatus === "Inactive" ? "deactivated" : "reactivated"} successfully.`);
      await loadData();
    } catch (error) {
      console.error(error);
      setAssetMessage(error.message || "Unable to update asset status.");
    } finally {
      setSavingAsset(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Equipment Control</p>
          <h3>Asset Master</h3>
          <p>
            Add, edit, and update equipment master records. Asset Code is removed; Equipment Number is the main identifier.
          </p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip">
            <span>Total</span>
            <strong>{allAssets.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Shown</span>
            <strong>{assets.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Sites</span>
            <strong>{sites.filter(isSiteActive).length}</strong>
          </div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title={editingAssetId ? "Edit Equipment" : "Add New Equipment"} action="Editable asset master">
          <form className="formGrid" onSubmit={saveAsset}>
            <label>
              Equipment Name
              <input value={form.equipment_name} onChange={(e) => updateAssetForm("equipment_name", e.target.value)} placeholder="e.g. Pressure Gauge" />
            </label>

            <label>
              Equipment Number / Serial
              <input value={form.serial_number} onChange={(e) => updateAssetForm("serial_number", e.target.value)} placeholder="e.g. EQ-1001" />
            </label>

            <label>
              Category
              <input value={form.category} onChange={(e) => updateAssetForm("category", e.target.value)} placeholder="e.g. Calibration / Lifting / PM" />
            </label>

            <label>
              Manufacturer
              <input value={form.manufacturer} onChange={(e) => updateAssetForm("manufacturer", e.target.value)} placeholder="Manufacturer" />
            </label>

            <label>
              Model
              <input value={form.model} onChange={(e) => updateAssetForm("model", e.target.value)} placeholder="Model" />
            </label>

            <label>
              Current Site
              <select value={form.current_site_id} onChange={(e) => updateAssetForm("current_site_id", e.target.value)}>
                <option value="">Select site</option>
                {sites.filter(isSiteActive).map((site) => (
                  <option key={pickId(site)} value={pickId(site)}>
                    {getSiteName(site)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Status
              <select value={form.status} onChange={(e) => updateAssetForm("status", e.target.value)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Under Maintenance">Under Maintenance</option>
                <option value="Calibration Due">Calibration Due</option>
                <option value="Damaged">Damaged</option>
                <option value="Retired">Retired</option>
              </select>
            </label>

            <label>
              Remarks
              <input value={form.remarks} onChange={(e) => updateAssetForm("remarks", e.target.value)} placeholder="Remarks" />
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={savingAsset || !canManageAssets}>
                {savingAsset ? "Saving..." : editingAssetId ? "Update Equipment" : "Add Equipment"}
              </button>
              <button className="ghostButton" type="button" onClick={resetAssetForm}>
                Clear
              </button>
            </div>

            {!canManageAssets && <div className="messageBox wide">Read-only access: only Admin can add, edit, update, deactivate, or reactivate assets.</div>}
            {assetMessage && <div className="messageBox wide">{assetMessage}</div>}
          </form>
        </Panel>

        <Panel title="Asset Master Register" action={`${assets.length} asset(s)`}>
          <input
            className="searchInput"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter asset master..."
          />

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Equipment No.</th>
                  <th>Category</th>
                  <th>Current Site</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={pickId(asset)}>
                    <td>
                      <strong>{getAssetName(asset)}</strong>
                      {canManageAssets && (
                        <div className="inlineActionRow">
                          <button className="miniActionButton" type="button" onClick={() => startAssetEdit(asset)}>Edit</button>
                          <button className="miniActionButton danger" type="button" onClick={() => toggleAssetStatus(asset)}>
                            {String(asset?.status || "Active").toLowerCase() === "inactive" || String(asset?.status || "").toLowerCase() === "retired" ? "Reactivate" : "Deactivate"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>{getAssetSerial(asset)}</td>
                    <td>{asset?.category || "-"}</td>
                    <td>{getCurrentSiteName(asset, sites)}</td>
                    <td><span className="badge success">{asset?.status || "Active"}</span></td>
                    <td>
                      <button className="ghostButton" type="button" onClick={() => startAssetEdit(asset)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}

                {!assets.length && (
                  <tr>
                    <td colSpan="6">
                      <Empty text="No assets found." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function SiteMasterPage({ sites, auth, loadData }) {
  const emptyForm = {
    site_code: "",
    site_name: "",
    site_type: "Operational Site",
    city: "",
    country: "United Arab Emirates",
    is_remote: "0",
  };

  const [form, setForm] = useState(emptyForm);
  const [editingSiteId, setEditingSiteId] = useState("");
  const [savingSite, setSavingSite] = useState(false);
  const [siteMessage, setSiteMessage] = useState("");
  const canManageSites = normalizeUserRole(auth?.user?.role) === "Admin";

  const activeSites = sites.filter(isSiteActive);
  const inactiveSites = sites.filter((site) => !isSiteActive(site));

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingSiteId("");
    setSiteMessage("");
  }

  function startEdit(site) {
    setEditingSiteId(String(pickId(site)));
    setForm({
      site_code: site?.site_code || "",
      site_name: site?.site_name || "",
      site_type: site?.site_type || "Operational Site",
      city: site?.city || "",
      country: site?.country || "United Arab Emirates",
      is_remote: isRemoteSite(site) ? "1" : "0",
    });
    setSiteMessage("Editing selected site.");
  }

  async function saveSite(e) {
    e.preventDefault();

    if (!form.site_code.trim() || !form.site_name.trim()) {
      setSiteMessage("Site Code and Site Name are required.");
      return;
    }

    setSavingSite(true);
    setSiteMessage("");

    try {
      const response = await fetch(
        editingSiteId ? `${API_BASE}/api/sites/${editingSiteId}` : `${API_BASE}/api/sites`,
        {
          method: editingSiteId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...createAuthHeaders(auth?.token),
          },
          body: JSON.stringify({
            ...form,
            site_code: form.site_code.trim(),
            site_name: form.site_name.trim(),
            site_type: form.site_type.trim(),
            city: form.city.trim(),
            country: form.country.trim(),
            is_remote: Number(form.is_remote),
            is_active: 1,
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to save site.");
      }

      setSiteMessage(editingSiteId ? "Site updated successfully." : "Site added successfully.");
      setForm(emptyForm);
      setEditingSiteId("");
      await loadData();
    } catch (error) {
      console.error(error);
      setSiteMessage(error.message || "Unable to save site.");
    } finally {
      setSavingSite(false);
    }
  }

  async function toggleSite(site) {
    if (!canManageSites) {
      setSiteMessage("Only Admin can deactivate or reactivate site records.");
      return;
    }

    const siteId = pickId(site);
    const active = isSiteActive(site);
    const action = active ? "deactivate" : "activate";

    if (!window.confirm(`Are you sure you want to ${action} this site?`)) {
      return;
    }

    setSiteMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/sites/${siteId}`, {
        method: active ? "DELETE" : "PATCH",
        headers: createAuthHeaders(auth?.token),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to update site status.");
      }

      setSiteMessage(active ? "Site deactivated successfully." : "Site activated successfully.");
      await loadData();
    } catch (error) {
      console.error(error);
      setSiteMessage(error.message || "Unable to update site status.");
    }
  }

  async function toggleSiteStatus(site) {
    const siteId = pickId(site);
    const nextActive = isSiteActive(site) ? 0 : 1;

    const confirmed = window.confirm(
      nextActive === 0
        ? "Deactivate this site? Assets and history will remain safe."
        : "Reactivate this site?"
    );

    if (!confirmed) return;

    setSavingSite(true);
    setSiteMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/sites/${siteId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders(auth?.token),
        },
        body: JSON.stringify({
          site_code: site?.site_code || "",
          site_name: site?.site_name || site?.name || "",
          site_type: site?.site_type || "Operational Site",
          city: site?.city || "",
          country: site?.country || "United Arab Emirates",
          is_remote: site?.is_remote ? 1 : 0,
          is_active: nextActive,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || result.error || "Unable to update site status.");
      }

      setSiteMessage(`Site ${nextActive === 0 ? "deactivated" : "reactivated"} successfully.`);
      await loadData();
    } catch (error) {
      console.error(error);
      setSiteMessage(error.message || "Unable to update site status.");
    } finally {
      setSavingSite(false);
    }
  }

  return (
    <section className="pageGrid">
      <div className="dashboardIntro">
        <div>
          <p className="eyebrow">Location Control</p>
          <h3>Site Master</h3>
          <p>
            Add, edit, activate, and deactivate operational sites used in Asset Master and Movement tracking.
          </p>
        </div>
        <div className="summaryChips">
          <div className="summaryChip">
            <span>Total</span>
            <strong>{sites.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Active</span>
            <strong>{activeSites.length}</strong>
          </div>
          <div className="summaryChip">
            <span>Inactive</span>
            <strong>{inactiveSites.length}</strong>
          </div>
        </div>
      </div>

      <div className="twoColumn">
        <Panel title={editingSiteId ? "Edit Site" : "Add New Site"} action="Editable master">
          <form className="formGrid" onSubmit={saveSite}>
            <label>
              Site Code
              <input value={form.site_code} onChange={(e) => updateForm("site_code", e.target.value)} placeholder="e.g. SDC" />
            </label>

            <label>
              Site Name
              <input value={form.site_name} onChange={(e) => updateForm("site_name", e.target.value)} placeholder="e.g. Main Warehouse" />
            </label>

            <label>
              Site Type
              <select value={form.site_type} onChange={(e) => updateForm("site_type", e.target.value)}>
                <option value="Operational Site">Operational Site</option>
                <option value="Client Site">Client Site</option>
                <option value="Warehouse">Warehouse</option>
                <option value="Yard">Yard</option>
                <option value="Rig Site">Rig Site</option>
                <option value="Workshop">Workshop</option>
                <option value="Other">Other</option>
              </select>
            </label>

            <label>
              City
              <input value={form.city} onChange={(e) => updateForm("city", e.target.value)} placeholder="City" />
            </label>

            <label>
              Country
              <input value={form.country} onChange={(e) => updateForm("country", e.target.value)} placeholder="Country" />
            </label>

            <label>
              Remote / Normal
              <select value={form.is_remote} onChange={(e) => updateForm("is_remote", e.target.value)}>
                <option value="0">Normal Site</option>
                <option value="1">Remote Site</option>
              </select>
            </label>

            <div className="v2HeroActions wide">
              <button className="primaryButton" type="submit" disabled={savingSite || !canManageSites}>
                {savingSite ? "Saving..." : editingSiteId ? "Update Site" : "Add Site"}
              </button>
              <button className="ghostButton" type="button" onClick={resetForm}>
                Clear
              </button>
            </div>

            {!canManageSites && <div className="messageBox wide">Read-only access: only Admin can add, edit, update, deactivate, or reactivate sites.</div>}
            {siteMessage && <div className="messageBox wide">{siteMessage}</div>}
          </form>
        </Panel>

        <Panel title="Site Register" action={`${sites.length} site(s)`}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Site Code</th>
                  <th>Site Name</th>
                  <th>Type</th>
                  <th>City</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const active = isSiteActive(site);
                  return (
                    <tr key={pickId(site)}>
                      <td><strong>{site.site_code || "-"}</strong></td>
                      <td>{getSiteName(site)}</td>
                      <td>{site.site_type || "-"}</td>
                      <td>{site.city || "-"}</td>
                      <td>{isRemoteSite(site) ? "Remote" : "Normal"}</td>
                      <td>
                        <span className={`badge ${active ? "success" : "neutral"}`}>
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="v2HeroActions">
                          <button className="ghostButton" type="button" onClick={() => startEdit(site)}>
                            Edit
                          </button>
                          <button className="ghostButton" type="button" onClick={() => toggleSite(site)}>
                            {active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!sites.length && (
                  <tr>
                    <td colSpan="7">
                      <Empty text="No sites found." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
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




































