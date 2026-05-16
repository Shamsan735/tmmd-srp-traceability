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

function isAuthorized(request: Request, env: Env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  return Boolean(env.AUTH_TOKEN && token === env.AUTH_TOKEN);
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

      if (body.username === env.AUTH_USERNAME && body.password === env.AUTH_PASSWORD) {
        return json({
          success: true,
          message: "Login successful",
          token: env.AUTH_TOKEN,
          user: {
            name: "System Admin",
            role: "Administrator",
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          checklist_date,
          result,
          performed_by,
          next_due_date,
          pm_frequency,
          attachment_ref,
          remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.asset_id,
        body.checklist_type,
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












