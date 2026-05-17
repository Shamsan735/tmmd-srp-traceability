export interface Env {
  DB: D1Database;
  AUTH_USERNAME: string;
  AUTH_PASSWORD: string;
  AUTH_TOKEN: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function notFound() {
  return json({ success: false, message: "Route not found" }, 404);
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isAuthorized(request: Request, env: Env) {
  const token = getBearerToken(request);
  return Boolean(env.AUTH_TOKEN && (token === env.AUTH_TOKEN || token.startsWith(env.AUTH_TOKEN + ":")));
}

function normalizeAccessRole(role: string | null | undefined) {
  const value = String(role || "").trim().toLowerCase();

  if (value === "admin" || value === "administrator") return "Admin";
  if (value === "store" || value === "store user") return "Store";
  if (value === "operator") return "Operator";
  if (value === "viewer" || value === "viewer/auditor") return "Viewer";

  return "Viewer";
}

function getRoleFromRequest(request: Request, env: Env) {
  const token = getBearerToken(request);

  if (!env.AUTH_TOKEN || !token) return null;
  if (token === env.AUTH_TOKEN) return "Admin";

  if (token.startsWith(env.AUTH_TOKEN + ":")) {
    const parts = token.slice(env.AUTH_TOKEN.length + 1).split(":");
    return normalizeAccessRole(parts[parts.length - 1]);
  }

  return null;
}

function isRoleAccessAllowed(request: Request, env: Env) {
  const role = getRoleFromRequest(request, env);
  const method = request.method.toUpperCase();
  const path = new URL(request.url).pathname;

  if (!role) return false;
  if (role === "Admin") return true;

  const isRead = method === "GET";
  const isAssetList = path === "/api/assets";
  const isAssetSearch = path === "/api/assets/search";
  const isAssetHistory = /^\/api\/assets\/\d+\/history$/.test(path);
  const isSites = path === "/api/sites" || /^\/api\/sites\/\d+$/.test(path);
  const isMovements = path === "/api/movements";
  const isPm = path === "/api/checklist-records" || /^\/api\/checklist-records\/\d+$/.test(path);
  const isRepair = path === "/api/asset-repairs" || /^\/api\/asset-repairs\/\d+$/.test(path);

  if (role === "Viewer") {
    return isRead && (isAssetList || isAssetSearch || isAssetHistory || path === "/api/sites" || isPm);
  }

  if (role === "Operator") {
    if (isRead && (isAssetList || isAssetSearch || isAssetHistory || path === "/api/sites" || isPm)) return true;
    if (method === "POST" && isMovements) return true;
    if ((method === "POST" || method === "PUT") && isPm) return true;
    return false;
  }

  if (role === "Store") {
    if (isRead && (isAssetList || isAssetSearch || isAssetHistory || path === "/api/sites" || isPm || isRepair || isMovements)) return true;
    if (method === "POST" && isMovements) return true;
    if ((method === "POST" || method === "PUT") && isRepair) return true;
    return false;
  }

  return false;
}


function safeJsonParseArray(value: any, fallback: string[] = []) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSettingsRole(role: any) {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin" || value === "administrator") return "Admin";
  if (value === "store" || value === "store user") return "Store";
  if (value === "operator") return "Operator";
  if (value === "viewer" || value === "viewer/auditor") return "Viewer";
  return "Viewer";
}

function defaultTabsForRole(role: any) {
  const normalized = normalizeSettingsRole(role);
  if (normalized === "Admin") return ["dashboard","movement","traceability","assets","sites","calibration","pm","repair","reports","import","settings"];
  if (normalized === "Store") return ["dashboard","movement","traceability","sites","repair","reports"];
  if (normalized === "Operator") return ["dashboard","movement","traceability","pm"];
  return ["dashboard","traceability"];
}

function tokenUsername(token: string, env: Env) {
  if (!env.AUTH_TOKEN || !token) return null;
  if (token === env.AUTH_TOKEN) return "admin";
  if (token.startsWith(env.AUTH_TOKEN + ":")) {
    const parts = token.slice(env.AUTH_TOKEN.length + 1).split(":");
    if (parts.length >= 2) return parts[0] || null;
    return null;
  }
  return null;
}

function makeUserToken(env: Env, username: string, role: string) {
  return `${env.AUTH_TOKEN}:${username}:${normalizeSettingsRole(role)}`;
}

async function getUserAccountByToken(request: Request, env: Env) {
  const token = getBearerToken(request);
  const username = tokenUsername(token, env);

  if (!username) return null;

  try {
    const account: any = await env.DB.prepare(
      "SELECT username, display_name, role, allowed_tabs, is_active FROM user_accounts WHERE username = ? LIMIT 1"
    ).bind(username).first();

    if (account?.username && Number(account.is_active) === 1) {
      return {
        username: account.username,
        name: account.display_name,
        role: normalizeSettingsRole(account.role),
        allowed_tabs: safeJsonParseArray(account.allowed_tabs, defaultTabsForRole(account.role)),
      };
    }
  } catch {}

  if (username === "admin") {
    return {
      username: "admin",
      name: "System Admin",
      role: "Admin",
      allowed_tabs: defaultTabsForRole("Admin"),
    };
  }

  return null;
}

function normalizeImportText(value: any) {
  return String(value || "").trim();
}

function makeSiteCode(siteName: string) {
  const base = normalizeImportText(siteName)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return base || "SITE";
}

function normalizeImportDate(value: any) {
  const text = normalizeImportText(value);
  if (!text) return null;

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  return text;
}

async function getOrCreateImportSite(env: Env, siteNameRaw: any) {
  const siteName = normalizeImportText(siteNameRaw);

  if (!siteName) return null;

  const existingByName: any = await env.DB.prepare(
    "SELECT id FROM sites WHERE lower(site_name) = lower(?) LIMIT 1"
  ).bind(siteName).first();

  if (existingByName?.id) return existingByName.id;

  let siteCode = makeSiteCode(siteName);
  let finalCode = siteCode;
  let counter = 1;

  while (true) {
    const existingCode: any = await env.DB.prepare(
      "SELECT id FROM sites WHERE site_code = ? LIMIT 1"
    ).bind(finalCode).first();

    if (!existingCode) break;

    counter += 1;
    finalCode = `${siteCode}-${counter}`.slice(0, 30);
  }

  const result: any = await env.DB.prepare(
    `INSERT INTO sites (site_code, site_name, site_type, city, country, is_remote, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(finalCode, siteName, "Imported", null, "UAE", 0, 1).run();

  return result.meta?.last_row_id || null;
}

async function upsertImportAsset(env: Env, record: any, siteId: any) {
  const serial = normalizeImportText(record.serial);
  const equipmentName = normalizeImportText(record.equipment);
  const manufacturer = normalizeImportText(record.manufacturer);
  const model = normalizeImportText(record.model);
  const category = normalizeImportText(record.category);
  const status = normalizeImportText(record.asset_status || record.status) || "Active";
  const remarks = normalizeImportText(record.remarks);

  if (!serial || !equipmentName) return null;

  const existing: any = await env.DB.prepare(
    "SELECT id FROM assets WHERE serial_number = ? LIMIT 1"
  ).bind(serial).first();

  if (existing?.id) {
    await env.DB.prepare(
      `UPDATE assets
       SET equipment_name = ?,
           manufacturer = ?,
           model = ?,
           category = ?,
           current_site_id = ?,
           status = ?,
           remarks = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      equipmentName,
      manufacturer || null,
      model || null,
      category || null,
      siteId || null,
      status,
      remarks || null,
      existing.id
    ).run();

    return existing.id;
  }

  const result: any = await env.DB.prepare(
    `INSERT INTO assets (
      asset_code,
      equipment_name,
      serial_number,
      manufacturer,
      model,
      category,
      current_site_id,
      status,
      remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    null,
    equipmentName,
    serial,
    manufacturer || null,
    model || null,
    category || null,
    siteId || null,
    status,
    remarks || null
  ).run();

  return result.meta?.last_row_id || null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/") {
      return json({
        success: true,
        system: "TMMD & SRP Management and Traceability System API",
        status: "Backend Worker running",
      });
    }

    if (path === "/api/health") {
      return json({ success: true, status: "ok" });
    }

    if (path === "/api/auth/login" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body || !body.username || !body.password) {
        return json({
          success: false,
          message: "Username and password are required",
        }, 400);
      }

      try {
        const account: any = await env.DB.prepare(
          "SELECT username, password, display_name, role, allowed_tabs, is_active FROM user_accounts WHERE username = ? LIMIT 1"
        ).bind(String(body.username || "").trim()).first();

        if (account?.username && Number(account.is_active) === 1 && body.password === account.password) {
          const role = normalizeSettingsRole(account.role);
          return json({
            success: true,
            message: "Login successful",
            token: makeUserToken(env, account.username, role),
            user: {
              username: account.username,
              name: account.display_name,
              role,
              allowed_tabs: safeJsonParseArray(account.allowed_tabs, defaultTabsForRole(role)),
            },
          });
        }
      } catch {}

      const users = [
        { username: env.AUTH_USERNAME, password: env.AUTH_PASSWORD, name: "System Admin", role: "Admin", token: env.AUTH_TOKEN, allowed_tabs: defaultTabsForRole("Admin") },
        { username: "store", password: "Store@123", name: "Store User", role: "Store", token: makeUserToken(env, "store", "Store"), allowed_tabs: defaultTabsForRole("Store") },
        { username: "operator", password: "Operator@123", name: "Operator", role: "Operator", token: makeUserToken(env, "operator", "Operator"), allowed_tabs: defaultTabsForRole("Operator") },
        { username: "viewer", password: "Viewer@123", name: "Viewer", role: "Viewer", token: makeUserToken(env, "viewer", "Viewer"), allowed_tabs: defaultTabsForRole("Viewer") },
      ];

      const user = users.find((item) => body.username === item.username && body.password === item.password);

      if (user) {
        return json({
          success: true,
          message: "Login successful",
          token: user.token,
          user: {
            username: user.username,
            name: user.name,
            role: user.role,
            allowed_tabs: user.allowed_tabs,
          },
        });
      }

      return json({
        success: false,
        message: "Invalid username or password",
      }, 401);
    }

    if (!isAuthorized(request, env)) {
      return json({
        success: false,
        message: "Unauthorized. Please login first.",
      }, 401);
    }

    if (!isRoleAccessAllowed(request, env)) {
      return json({
        success: false,
        message: "Access denied for this role.",
      }, 403);
    }



    if (path === "/api/settings/users" && request.method === "GET") {
      const role = getRoleFromRequest(request, env);

      if (role !== "Admin") {
        return json({ success: false, message: "Only Admin can manage users." }, 403);
      }

      const { results } = await env.DB.prepare(
        "SELECT id, username, display_name, role, allowed_tabs, is_active, created_at, updated_at FROM user_accounts ORDER BY id"
      ).all();

      return json({
        success: true,
        users: (results || []).map((user: any) => ({
          ...user,
          allowed_tabs: safeJsonParseArray(user.allowed_tabs, defaultTabsForRole(user.role)),
        })),
      });
    }

    if (path === "/api/settings/users" && request.method === "PUT") {
      const role = getRoleFromRequest(request, env);

      if (role !== "Admin") {
        return json({ success: false, message: "Only Admin can manage users." }, 403);
      }

      const body: any = await readJson(request);
      const users: any[] = Array.isArray(body?.users) ? body.users : [];

      if (!users.length) {
        return json({ success: false, message: "No users received." }, 400);
      }

      let updated = 0;

      for (const item of users) {
        const username = normalizeImportText(item.username);
        const displayName = normalizeImportText(item.display_name || item.name);
        const userRole = normalizeSettingsRole(item.role);
        const allowedTabs = Array.isArray(item.allowed_tabs) && item.allowed_tabs.length ? item.allowed_tabs : defaultTabsForRole(userRole);
        const isActive = item.is_active === false || Number(item.is_active) === 0 ? 0 : 1;
        const password = normalizeImportText(item.password);

        if (!username || !displayName || !userRole) continue;

        const existing: any = await env.DB.prepare(
          "SELECT id, password FROM user_accounts WHERE username = ? LIMIT 1"
        ).bind(username).first();

        if (existing?.id) {
          await env.DB.prepare(
            `UPDATE user_accounts
             SET display_name = ?,
                 role = ?,
                 allowed_tabs = ?,
                 is_active = ?,
                 password = CASE WHEN ? <> '' THEN ? ELSE password END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE username = ?`
          ).bind(
            displayName,
            userRole,
            JSON.stringify(allowedTabs),
            isActive,
            password,
            password,
            username
          ).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO user_accounts (username, password, display_name, role, allowed_tabs, is_active)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            username,
            password || "Change@123",
            displayName,
            userRole,
            JSON.stringify(allowedTabs),
            isActive
          ).run();
        }

        updated += 1;
      }

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'UPDATE_USER_SETTINGS', 'user_accounts', ?, ?)`
      ).bind(null, null, JSON.stringify({ updated })).run();

      return json({
        success: true,
        message: "User settings updated successfully.",
        updated,
      });
    }

    if (path === "/api/import/excel" && request.method === "POST") {
      const role = getRoleFromRequest(request, env);

      if (role !== "Admin") {
        return json({
          success: false,
          message: "Only Admin can apply Excel import.",
        }, 403);
      }

      const body: any = await readJson(request);
      const importType = normalizeImportText(body?.type);
      const records: any[] = Array.isArray(body?.records) ? body.records : [];

      if (!["service", "calibration"].includes(importType)) {
        return json({ success: false, message: "Invalid import type." }, 400);
      }

      if (!records.length) {
        return json({ success: false, message: "No import records received." }, 400);
      }

      const summary = {
        received: records.length,
        skipped: 0,
        sitesCreatedOrMatched: 0,
        assetsCreatedOrUpdated: 0,
        pmRecordsCreated: 0,
        calibrationRecordsCreated: 0,
        calibrationPmRecordsCreated: 0,
        duplicatePmSkipped: 0,
        duplicateCalibrationSkipped: 0,
      };

      for (const record of records) {
        const serial = normalizeImportText(record.serial);
        const equipment = normalizeImportText(record.equipment);
        const location = normalizeImportText(record.location);

        if (!serial || !equipment || !location) {
          summary.skipped += 1;
          continue;
        }

        const siteId = await getOrCreateImportSite(env, location);
        if (siteId) summary.sitesCreatedOrMatched += 1;

        const assetId = await upsertImportAsset(env, record, siteId);
        if (!assetId) {
          summary.skipped += 1;
          continue;
        }

        summary.assetsCreatedOrUpdated += 1;

        if (importType === "service") {
          const pmDate = normalizeImportDate(record.pm_date) || new Date().toISOString().slice(0, 10);
          const resultText = normalizeImportText(record.status) || "Imported";

          const existingPm: any = await env.DB.prepare(
            "SELECT id FROM checklist_records WHERE asset_id = ? AND checklist_type = 'PM' AND checklist_name = ? AND checklist_date = ? LIMIT 1"
          ).bind(assetId, "Imported Service Related Products", pmDate).first();

          if (existingPm?.id) {
            summary.duplicatePmSkipped += 1;
          } else {
            await env.DB.prepare(
            `INSERT INTO checklist_records (
              asset_id,
              checklist_type,
              checklist_name,
              checklist_date,
              result,
              performed_by,
              next_due_date,
              pm_frequency,
              attachment_ref,
              remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            assetId,
            "PM",
            "Imported Service Related Products",
            pmDate,
            resultText,
            "Excel Import",
            null,
            null,
            normalizeImportText(record.file_name) || null,
            normalizeImportText(record.remarks) || null
          ).run();

          summary.pmRecordsCreated += 1;
          }
        }

        if (importType === "calibration") {
          const certNumber = normalizeImportText(record.certificate_number);
          const expiryDate = normalizeImportDate(record.expiry_date);

          const existingCalibration: any = await env.DB.prepare(
            "SELECT id FROM calibration_records WHERE asset_id = ? AND COALESCE(certificate_number, '') = COALESCE(?, '') AND COALESCE(expiry_date, '') = COALESCE(?, '') LIMIT 1"
          ).bind(assetId, certNumber || null, expiryDate).first();

          if (existingCalibration?.id) {
            summary.duplicateCalibrationSkipped += 1;
          } else {
            await env.DB.prepare(
            `INSERT INTO calibration_records (
              asset_id,
              certificate_type,
              certificate_number,
              calibration_date,
              expiry_date,
              calibration_agency,
              result,
              status,
              attachment_ref,
              remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            assetId,
            normalizeImportText(record.certificate_type) || "Calibration Certificate",
            certNumber || null,
            normalizeImportDate(record.calibration_date),
            expiryDate,
            normalizeImportText(record.calibration_agency) || null,
            normalizeImportText(record.status) || null,
            normalizeImportText(record.status) || null,
            normalizeImportText(record.file_name) || null,
            normalizeImportText(record.remarks) || location || null
          ).run();

          summary.calibrationRecordsCreated += 1;
          }

          const calibrationPmDate = normalizeImportDate(record.calibration_date) || new Date().toISOString().slice(0, 10);
          const calibrationPmName = "Imported Calibration Master PM / Inspection";

          const existingCalibrationPm: any = await env.DB.prepare(
            "SELECT id FROM checklist_records WHERE asset_id = ? AND checklist_type = 'PM' AND checklist_name = ? AND checklist_date = ? LIMIT 1"
          ).bind(assetId, calibrationPmName, calibrationPmDate).first();

          if (existingCalibrationPm?.id) {
            summary.duplicatePmSkipped += 1;
          } else {
            await env.DB.prepare(
              `INSERT INTO checklist_records (
                asset_id,
                checklist_type,
                checklist_name,
                checklist_date,
                result,
                performed_by,
                next_due_date,
                pm_frequency,
                attachment_ref,
                remarks
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              assetId,
              "PM",
              calibrationPmName,
              calibrationPmDate,
              normalizeImportText(record.status) || "Imported",
              "Excel Import",
              normalizeImportDate(record.expiry_date),
              null,
              normalizeImportText(record.file_name) || null,
              normalizeImportText(record.remarks) || location || null
            ).run();

            summary.calibrationPmRecordsCreated += 1;
          }
        }
      }

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'APPLY_EXCEL_IMPORT', 'excel_import', ?, ?)`
      ).bind(null, null, JSON.stringify({ importType, summary })).run();

      return json({
        success: true,
        message: "Excel import applied successfully.",
        summary,
      });
    }

    if (path === "/api/sites" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, site_code, site_name, site_type, city, country, is_remote, is_active FROM sites ORDER BY is_active DESC, site_name"
      ).all();

      return json({ success: true, data: results });
    }

    if (path === "/api/sites" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body || !body.site_code || !body.site_name) {
        return json({
          success: false,
          message: "site_code and site_name are required",
        }, 400);
      }

      const result: any = await env.DB.prepare(
        `INSERT INTO sites (
          site_code,
          site_name,
          site_type,
          city,
          country,
          is_remote,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        String(body.site_code).trim(),
        String(body.site_name).trim(),
        body.site_type || null,
        body.city || null,
        body.country || null,
        body.is_remote ? 1 : 0,
        body.is_active === 0 ? 0 : 1
      ).run();

      return json({
        success: true,
        message: "Site added successfully",
        data: { id: result.meta?.last_row_id },
      });
    }

    const siteMatch = path.match(/^\/api\/sites\/(\d+)$/);

    if (siteMatch && request.method === "PUT") {
      const siteId = Number(siteMatch[1]);
      const body: any = await readJson(request);

      if (!body || !body.site_code || !body.site_name) {
        return json({
          success: false,
          message: "site_code and site_name are required",
        }, 400);
      }

      await env.DB.prepare(
        `UPDATE sites
         SET site_code = ?,
             site_name = ?,
             site_type = ?,
             city = ?,
             country = ?,
             is_remote = ?,
             is_active = ?
         WHERE id = ?`
      ).bind(
        String(body.site_code).trim(),
        String(body.site_name).trim(),
        body.site_type || null,
        body.city || null,
        body.country || null,
        body.is_remote ? 1 : 0,
        body.is_active === 0 ? 0 : 1,
        siteId
      ).run();

      return json({
        success: true,
        message: "Site updated successfully",
      });
    }

    if (siteMatch && (request.method === "PATCH" || request.method === "DELETE")) {
      const siteId = Number(siteMatch[1]);
      const body: any = request.method === "PATCH" ? await readJson(request) : {};

      const isActive = body?.is_active === 1 || body?.is_active === true ? 1 : 0;

      await env.DB.prepare(
        "UPDATE sites SET is_active = ? WHERE id = ?"
      ).bind(isActive, siteId).run();

      return json({
        success: true,
        message: isActive ? "Site activated successfully" : "Site deactivated successfully",
      });
    }

    const fixedHistoryMatch = path.match(/^\/api\/assets\/(\d+)\/history$/);

    if (fixedHistoryMatch && request.method === "GET") {
      const assetId = Number(fixedHistoryMatch[1]);

      const asset = await env.DB.prepare(
        `SELECT 
          a.*,
          s.site_name AS current_site_name
        FROM assets a
        LEFT JOIN sites s ON a.current_site_id = s.id
        WHERE a.id = ?`
      ).bind(assetId).first();

      const { results } = await env.DB.prepare(
        `SELECT 
          m.*,
          fs.site_name AS from_site_name,
          fs.site_name AS from_site,
          ts.site_name AS to_site_name,
          ts.site_name AS to_site
        FROM movements m
        LEFT JOIN sites fs ON m.from_site_id = fs.id
        LEFT JOIN sites ts ON m.to_site_id = ts.id
        WHERE m.asset_id = ?
        ORDER BY datetime(m.movement_datetime) DESC, m.id DESC`
      ).bind(assetId).all();

      return json({
        success: true,
        data: {
          asset,
          movements: results,
        },
      });
    }
    if (path === "/api/assets" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT 
          a.id,
          a.asset_code,
          a.equipment_name,
          a.serial_number,
          a.manufacturer,
          a.model,
          a.category,
          a.days_until_expiry,
          a.status,
          a.remarks,
          a.current_site_id,
          s.site_name AS current_location,
          s.site_code AS current_site_code
        FROM assets a
        LEFT JOIN sites s ON a.current_site_id = s.id
        ORDER BY a.equipment_name`
      ).all();

      return json({ success: true, data: results });
    }


    if (path === "/api/assets" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body || !body.equipment_name || !body.serial_number) {
        return json({
          success: false,
          message: "Equipment Name and Equipment Number are required",
        }, 400);
      }

      const duplicate: any = await env.DB.prepare(
        "SELECT id FROM assets WHERE serial_number = ?"
      ).bind(String(body.serial_number).trim()).first();

      if (duplicate) {
        return json({
          success: false,
          message: "Equipment Number already exists",
        }, 409);
      }

      const result: any = await env.DB.prepare(
        `INSERT INTO assets (
          asset_code,
          equipment_name,
          serial_number,
          manufacturer,
          model,
          category,
          current_site_id,
          status,
          remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        null,
        String(body.equipment_name).trim(),
        String(body.serial_number).trim(),
        body.manufacturer || null,
        body.model || null,
        body.category || null,
        body.current_site_id || null,
        body.status || "Active",
        body.remarks || null
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'CREATE_ASSET_MASTER', 'assets', ?, ?)`
      ).bind(
        body.created_by_user_id || null,
        result.meta?.last_row_id || null,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        id: result.meta?.last_row_id,
        message: "Asset added successfully",
      });
    }

    const assetMasterMatch = path.match(/^\/api\/assets\/(\d+)$/);

    if (assetMasterMatch && request.method === "PUT") {
      const assetId = Number(assetMasterMatch[1]);
      const body: any = await readJson(request);

      if (!body || !body.equipment_name || !body.serial_number) {
        return json({
          success: false,
          message: "Equipment Name and Equipment Number are required",
        }, 400);
      }

      const existing: any = await env.DB.prepare(
        "SELECT id FROM assets WHERE id = ?"
      ).bind(assetId).first();

      if (!existing) {
        return json({ success: false, message: "Asset not found" }, 404);
      }

      const duplicate: any = await env.DB.prepare(
        "SELECT id FROM assets WHERE serial_number = ? AND id <> ?"
      ).bind(String(body.serial_number).trim(), assetId).first();

      if (duplicate) {
        return json({
          success: false,
          message: "Equipment Number already exists on another asset",
        }, 409);
      }

      await env.DB.prepare(
        `UPDATE assets
         SET asset_code = NULL,
             equipment_name = ?,
             serial_number = ?,
             manufacturer = ?,
             model = ?,
             category = ?,
             current_site_id = ?,
             status = ?,
             remarks = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(
        String(body.equipment_name).trim(),
        String(body.serial_number).trim(),
        body.manufacturer || null,
        body.model || null,
        body.category || null,
        body.current_site_id || null,
        body.status || "Active",
        body.remarks || null,
        assetId
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'UPDATE_ASSET_MASTER', 'assets', ?, ?)`
      ).bind(
        body.updated_by_user_id || null,
        assetId,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        message: "Asset updated successfully",
      });
    }

    if (path === "/api/assets/search" && request.method === "GET") {
      const q = url.searchParams.get("q") || "";

      if (!q.trim()) {
        return json({ success: false, message: "Search value is required" }, 400);
      }

      const { results } = await env.DB.prepare(
        `SELECT 
          a.id,
          a.asset_code,
          a.equipment_name,
          a.serial_number,
          a.manufacturer,
          a.model,
          a.category,
          a.days_until_expiry,
          a.status,
          a.remarks,
          a.current_site_id,
          s.site_name AS current_location,
          s.site_code AS current_site_code
        FROM assets a
        LEFT JOIN sites s ON a.current_site_id = s.id
        WHERE a.serial_number LIKE ? 
           OR a.asset_code LIKE ?
           OR a.equipment_name LIKE ?
        ORDER BY a.equipment_name`
      )
        .bind(`%${q}%`, `%${q}%`, `%${q}%`)
        .all();

      return json({ success: true, data: results });
    }



    if (path === "/api/calibration-records" && request.method === "GET") {
      const assetId = url.searchParams.get("asset_id");

      const filters: string[] = [];
      const binds: any[] = [];

      if (assetId) {
        filters.push("c.asset_id = ?");
        binds.push(assetId);
      }

      const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const { results } = await env.DB.prepare(
        `SELECT
          c.id,
          c.asset_id,
          c.certificate_type,
          c.certificate_number,
          c.calibration_date,
          c.expiry_date,
          c.calibration_agency,
          c.result,
          c.status,
          c.attachment_ref,
          c.attachment_id,
          c.remarks,
          c.created_at,
          a.equipment_name,
          a.serial_number,
          a.category,
          a.current_site_id,
          s.site_name AS current_site_name,
          s.site_code AS current_site_code
        FROM calibration_records c
        LEFT JOIN assets a ON c.asset_id = a.id
        LEFT JOIN sites s ON a.current_site_id = s.id
        ${whereSql}
        ORDER BY date(c.expiry_date) ASC, c.id DESC
        LIMIT 500`
      ).bind(...binds).all();

      return json({ success: true, data: results });
    }

    if (path === "/api/calibration-records" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body || !body.asset_id || !body.certificate_number || !body.expiry_date) {
        return json({
          success: false,
          message: "Equipment, Certificate Number and Expiry Date are required",
        }, 400);
      }

      const asset: any = await env.DB.prepare(
        "SELECT id FROM assets WHERE id = ?"
      ).bind(body.asset_id).first();

      if (!asset) {
        return json({ success: false, message: "Asset not found" }, 404);
      }

      const result: any = await env.DB.prepare(
        `INSERT INTO calibration_records (
          asset_id,
          certificate_type,
          certificate_number,
          calibration_date,
          expiry_date,
          calibration_agency,
          result,
          status,
          attachment_ref,
          remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.asset_id,
        body.certificate_type || null,
        body.certificate_number || null,
        body.calibration_date || null,
        body.expiry_date || null,
        body.calibration_agency || null,
        body.result || null,
        body.status || null,
        body.attachment_ref || null,
        body.remarks || null
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'CREATE_CALIBRATION_RECORD', 'calibration_records', ?, ?)`
      ).bind(
        body.created_by_user_id || null,
        result.meta?.last_row_id || null,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        id: result.meta?.last_row_id,
        message: "Calibration record saved successfully",
      });
    }

    const calibrationMatch = path.match(/^\/api\/calibration-records\/(\d+)$/);

    if (calibrationMatch && request.method === "PUT") {
      const calibrationId = Number(calibrationMatch[1]);
      const body: any = await readJson(request);

      if (!body || !body.asset_id || !body.certificate_number || !body.expiry_date) {
        return json({
          success: false,
          message: "Equipment, Certificate Number and Expiry Date are required",
        }, 400);
      }

      const existing: any = await env.DB.prepare(
        "SELECT id FROM calibration_records WHERE id = ?"
      ).bind(calibrationId).first();

      if (!existing) {
        return json({ success: false, message: "Calibration record not found" }, 404);
      }

      await env.DB.prepare(
        `UPDATE calibration_records
         SET asset_id = ?,
             certificate_type = ?,
             certificate_number = ?,
             calibration_date = ?,
             expiry_date = ?,
             calibration_agency = ?,
             result = ?,
             status = ?,
             attachment_ref = ?,
             remarks = ?
         WHERE id = ?`
      ).bind(
        body.asset_id,
        body.certificate_type || null,
        body.certificate_number || null,
        body.calibration_date || null,
        body.expiry_date || null,
        body.calibration_agency || null,
        body.result || null,
        body.status || null,
        body.attachment_ref || null,
        body.remarks || null,
        calibrationId
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'UPDATE_CALIBRATION_RECORD', 'calibration_records', ?, ?)`
      ).bind(
        body.updated_by_user_id || null,
        calibrationId,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        message: "Calibration record updated successfully",
      });
    }


    if (path === "/api/checklist-records" && request.method === "GET") {
      const assetId = url.searchParams.get("asset_id");

      const filters: string[] = [];
      const binds: any[] = [];

      if (assetId) {
        filters.push("cr.asset_id = ?");
        binds.push(assetId);
      }

      const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const { results } = await env.DB.prepare(
        `SELECT
          cr.id,
          cr.asset_id,
          cr.checklist_type,
          cr.checklist_name,
          cr.checklist_date,
          cr.result,
          cr.performed_by,
          cr.next_due_date,
          cr.pm_frequency,
          cr.attachment_ref,
          cr.attachment_id,
          cr.remarks,
          cr.created_at,
          a.equipment_name,
          a.serial_number,
          a.category,
          a.current_site_id,
          s.site_name AS current_site_name,
          s.site_code AS current_site_code
        FROM checklist_records cr
        LEFT JOIN assets a ON cr.asset_id = a.id
        LEFT JOIN sites s ON a.current_site_id = s.id
        ${whereSql}
        ORDER BY date(cr.checklist_date) DESC, cr.id DESC
        LIMIT 500`
      ).bind(...binds).all();

      return json({ success: true, data: results });
    }

    if (path === "/api/checklist-records" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body || !body.asset_id || !body.checklist_type || !body.checklist_date) {
        return json({
          success: false,
          message: "Equipment, Checklist Type and Inspection Date are required",
        }, 400);
      }

      const asset: any = await env.DB.prepare(
        "SELECT id FROM assets WHERE id = ?"
      ).bind(body.asset_id).first();

      if (!asset) {
        return json({ success: false, message: "Asset not found" }, 404);
      }

      const result: any = await env.DB.prepare(
        `INSERT INTO checklist_records (
          asset_id,
          checklist_type,
          checklist_name,
          checklist_date,
          result,
          performed_by,
          next_due_date,
          pm_frequency,
          attachment_ref,
          remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.asset_id,
        body.checklist_type,
        body.checklist_name || null,
        body.checklist_date,
        body.result || null,
        body.performed_by || null,
        body.next_due_date || null,
        body.pm_frequency || null,
        body.attachment_ref || null,
        body.remarks || null
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'CREATE_PM_CHECKLIST', 'checklist_records', ?, ?)`
      ).bind(
        body.created_by_user_id || null,
        result.meta?.last_row_id || null,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        id: result.meta?.last_row_id,
        message: "PM checklist record saved successfully",
      });
    }

    const checklistMatch = path.match(/^\/api\/checklist-records\/(\d+)$/);

    if (checklistMatch && request.method === "PUT") {
      const checklistId = Number(checklistMatch[1]);
      const body: any = await readJson(request);

      if (!body || !body.asset_id || !body.checklist_type || !body.checklist_date) {
        return json({
          success: false,
          message: "Equipment, Checklist Type and Inspection Date are required",
        }, 400);
      }

      const existing: any = await env.DB.prepare(
        "SELECT id FROM checklist_records WHERE id = ?"
      ).bind(checklistId).first();

      if (!existing) {
        return json({ success: false, message: "PM checklist record not found" }, 404);
      }

      await env.DB.prepare(
        `UPDATE checklist_records
         SET asset_id = ?,
             checklist_type = ?,
             checklist_name = ?,
             checklist_date = ?,
             result = ?,
             performed_by = ?,
             next_due_date = ?,
             pm_frequency = ?,
             attachment_ref = ?,
             remarks = ?
         WHERE id = ?`
      ).bind(
        body.asset_id,
        body.checklist_type,
        body.checklist_name || null,
        body.checklist_date,
        body.result || null,
        body.performed_by || null,
        body.next_due_date || null,
        body.pm_frequency || null,
        body.attachment_ref || null,
        body.remarks || null,
        checklistId
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'UPDATE_PM_CHECKLIST', 'checklist_records', ?, ?)`
      ).bind(
        body.updated_by_user_id || null,
        checklistId,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        message: "PM checklist record updated successfully",
      });
    }

    if (path === "/api/asset-repairs" && request.method === "GET") {
      const assetId = url.searchParams.get("asset_id");
      const status = url.searchParams.get("status");

      const filters: string[] = [];
      const binds: any[] = [];

      if (assetId) {
        filters.push("r.asset_id = ?");
        binds.push(assetId);
      }

      if (status) {
        filters.push("r.status = ?");
        binds.push(status);
      }

      const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const { results } = await env.DB.prepare(
        `SELECT
          r.id,
          r.asset_id,
          r.site_id,
          r.repair_date,
          r.fault_description,
          r.action_taken,
          r.repaired_by,
          r.parts_used,
          r.status,
          r.remarks,
          r.attachment_id,
          r.created_at,
          r.updated_at,
          a.equipment_name,
          a.serial_number,
          a.asset_code,
          s.site_name,
          s.site_code
        FROM asset_repair_history r
        LEFT JOIN assets a ON r.asset_id = a.id
        LEFT JOIN sites s ON r.site_id = s.id
        ${whereSql}
        ORDER BY datetime(r.repair_date) DESC, r.id DESC
        LIMIT 500`
      ).bind(...binds).all();

      return json({ success: true, data: results });
    }

    if (path === "/api/asset-repairs" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body.asset_id || !body.repair_date || !body.fault_description) {
        return json(
          { success: false, error: "asset_id, repair_date and fault_description are required" },
          400
        );
      }

      const asset: any = await env.DB.prepare(
        "SELECT id, current_site_id FROM assets WHERE id = ?"
      ).bind(body.asset_id).first();

      if (!asset) {
        return json({ success: false, error: "Asset not found" }, 404);
      }

      const siteId = body.site_id || asset.current_site_id || null;

      const result: any = await env.DB.prepare(
        `INSERT INTO asset_repair_history (
          asset_id,
          site_id,
          repair_date,
          fault_description,
          action_taken,
          repaired_by,
          parts_used,
          status,
          remarks,
          attachment_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.asset_id,
        siteId,
        body.repair_date,
        body.fault_description,
        body.action_taken || null,
        body.repaired_by || null,
        body.parts_used || null,
        body.status || "Open",
        body.remarks || null,
        body.attachment_id || null
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
         VALUES (?, 'CREATE_REPAIR_HISTORY', 'asset_repair_history', ?, ?)`
      ).bind(
        body.created_by_user_id || null,
        result.meta?.last_row_id || null,
        JSON.stringify(body)
      ).run();

      return json({
        success: true,
        id: result.meta?.last_row_id,
        message: "Asset repair history saved successfully",
      });
    }

    const repairMatch = path.match(/^\/api\/asset-repairs\/(\d+)$/);

    if (repairMatch && request.method === "PUT") {
      const repairId = Number(repairMatch[1]);
      const body: any = await readJson(request);

      await env.DB.prepare(
        `UPDATE asset_repair_history
         SET repair_date = ?,
             fault_description = ?,
             action_taken = ?,
             repaired_by = ?,
             parts_used = ?,
             status = ?,
             remarks = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(
        body.repair_date,
        body.fault_description,
        body.action_taken || null,
        body.repaired_by || null,
        body.parts_used || null,
        body.status || "Open",
        body.remarks || null,
        repairId
      ).run();

      return json({ success: true, message: "Asset repair history updated successfully" });
    }

    const assetRepairHistoryMatch = path.match(/^\/api\/assets\/(\d+)\/repairs$/);

    if (assetRepairHistoryMatch && request.method === "GET") {
      const assetId = Number(assetRepairHistoryMatch[1]);

      const asset: any = await env.DB.prepare(
        `SELECT
          a.id,
          a.asset_code,
          a.equipment_name,
          a.serial_number,
          a.current_site_id,
          s.site_name AS current_site_name
        FROM assets a
        LEFT JOIN sites s ON a.current_site_id = s.id
        WHERE a.id = ?`
      ).bind(assetId).first();

      if (!asset) {
        return json({ success: false, error: "Asset not found" }, 404);
      }

      const { results } = await env.DB.prepare(
        `SELECT
          r.id,
          r.asset_id,
          r.site_id,
          r.repair_date,
          r.fault_description,
          r.action_taken,
          r.repaired_by,
          r.parts_used,
          r.status,
          r.remarks,
          r.attachment_id,
          r.created_at,
          r.updated_at,
          s.site_name,
          s.site_code
        FROM asset_repair_history r
        LEFT JOIN sites s ON r.site_id = s.id
        WHERE r.asset_id = ?
        ORDER BY datetime(r.repair_date) DESC, r.id DESC`
      ).bind(assetId).all();

      return json({
        success: true,
        data: {
          asset,
          repairs: results,
        },
      });
    }

    if (path === "/api/movements" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT 
          m.id,
          m.asset_id,
          m.from_site_id,
          m.to_site_id,
          m.movement_datetime,
          m.movement_type,
          m.remarks,
          m.handed_over_by,
          m.received_by,
          m.created_at,
          a.equipment_name,
          a.serial_number,
          a.category,
          fs.site_name AS from_site_name,
          ts.site_name AS to_site_name,
          cs.site_name AS current_site_name
        FROM movements m
        LEFT JOIN assets a ON m.asset_id = a.id
        LEFT JOIN sites fs ON m.from_site_id = fs.id
        LEFT JOIN sites ts ON m.to_site_id = ts.id
        LEFT JOIN sites cs ON a.current_site_id = cs.id
        ORDER BY datetime(m.movement_datetime) DESC, m.id DESC
        LIMIT 500`
      ).all();

      return json({ success: true, data: results });
    }
    if (path === "/api/movements" && request.method === "POST") {
      const body: any = await readJson(request);

      if (!body || !body.asset_id || !body.to_site_id || !body.movement_datetime || !body.movement_type) {
        return json({
          success: false,
          message: "asset_id, to_site_id, movement_datetime, and movement_type are required",
        }, 400);
      }

      const asset: any = await env.DB.prepare(
        "SELECT id, current_site_id FROM assets WHERE id = ?"
      )
        .bind(body.asset_id)
        .first();

      if (!asset) {
        return json({ success: false, message: "Asset not found" }, 404);
      }

      const fromSiteId = body.from_site_id || asset.current_site_id || null;

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO movements (
            asset_id,
            from_site_id,
            to_site_id,
            movement_datetime,
            movement_type,
            remarks,
            handed_over_by,
            received_by,
            updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          body.asset_id,
          fromSiteId,
          body.to_site_id,
          body.movement_datetime,
          body.movement_type,
          body.remarks || null,
          body.handed_over_by || null,
          body.received_by || null,
          body.updated_by_user_id || null
        ),
        env.DB.prepare(
          "UPDATE assets SET current_site_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(body.to_site_id, body.asset_id),
        env.DB.prepare(
          `INSERT INTO audit_logs (user_id, action, module, record_id, new_value)
           VALUES (?, 'CREATE_MOVEMENT', 'movements', ?, ?)`
        ).bind(
          body.updated_by_user_id || null,
          body.asset_id,
          JSON.stringify(body)
        ),
      ]);

      return json({
        success: true,
        message: "Movement saved and current location updated",
      });
    }

    const historyMatch = path.match(/^\/api\/assets\/(\d+)\/history$/);

    if (historyMatch && request.method === "GET") {
      const assetId = Number(historyMatch[1]);

      const asset: any = await env.DB.prepare(
        `SELECT 
          a.id,
          a.asset_code,
          a.equipment_name,
          a.serial_number,
          a.manufacturer,
          a.model,
          a.category,
          a.days_until_expiry,
          a.status,
          a.current_site_id,
          s.site_name AS current_location,
          s.site_code AS current_site_code
        FROM assets a
        LEFT JOIN sites s ON a.current_site_id = s.id
        WHERE a.id = ?`
      )
        .bind(assetId)
        .first();

      if (!asset) {
        return json({ success: false, message: "Asset not found" }, 404);
      }

      const { results } = await env.DB.prepare(
        `SELECT 
          m.id,
          m.asset_id,
          m.movement_datetime,
          m.movement_type,
          m.remarks,
          m.handed_over_by,
          m.received_by,
          m.created_at,
          fs.site_name AS from_site,
          fs.site_code AS from_site_code,
          ts.site_name AS to_site,
          ts.site_code AS to_site_code,
          u.name AS updated_by
        FROM movements m
        LEFT JOIN sites fs ON m.from_site_id = fs.id
        LEFT JOIN sites ts ON m.to_site_id = ts.id
        LEFT JOIN users u ON m.updated_by_user_id = u.id
        WHERE m.asset_id = ?
        ORDER BY m.movement_datetime ASC`
      )
        .bind(assetId)
        .all();

      const movements = results.map((row: any, index: number) => {
        const nextRow: any = results[index + 1];
        const start = new Date(row.movement_datetime).getTime();
        const end = nextRow ? new Date(nextRow.movement_datetime).getTime() : Date.now();
        const diffHours = Math.max(0, Math.round((end - start) / (1000 * 60 * 60)));

        return {
          ...row,
          stayed_hours_at_to_site: diffHours,
          stayed_days_at_to_site: Math.round((diffHours / 24) * 10) / 10,
        };
      });

      return json({
        success: true,
        data: {
          asset,
          movements,
        },
      });
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

















