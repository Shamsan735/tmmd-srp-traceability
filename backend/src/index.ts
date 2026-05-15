export interface Env {
  DB: D1Database;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    if (path === "/api/sites" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, site_code, site_name, site_type, city, country, is_remote, is_active FROM sites ORDER BY site_name"
      ).all();

      return json({ success: true, data: results });
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


