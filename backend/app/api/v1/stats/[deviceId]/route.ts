import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { ok, unauthorized, notFound, serverError } from "@/lib/api-response";
import { statsCache, STATS_TTL_MS } from "@/lib/stats-cache";

type Params = { params: Promise<{ deviceId: string }> };

// ── Raw query result types ───────────────────────────────────────────────────

interface AggregateRow {
  avg_voltage: number | null;
  min_voltage: number | null;
  max_voltage: number | null;
  avg_current: number | null;
  min_current: number | null;
  max_current: number | null;
  avg_temp: number | null;
  min_temp: number | null;
  max_temp: number | null;
  avg_soh: number | null;
  min_soh: number | null;
  max_soh: number | null;
  latest_soh: number | null;
  avg_delta: number | null;
  max_delta: number | null;
  p95_delta: number | null;
  total_count: string; // BigInt comes back as string from pg
}

interface CellFreqRow {
  cell_id: string;
  cnt: string; // BigInt
}

interface SocZoneRow {
  zone_min: number;
  cnt: string; // BigInt
  avg_delta: number | null;
  max_delta: number | null;
  avg_temp: number | null;
  avg_power: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number | null): number | null {
  return n != null ? Math.round(n * 100) / 100 : null;
}

function round3(n: number | null): number | null {
  return n != null ? Math.round(n * 1000) / 1000 : null;
}

function round1(n: number | null): number | null {
  return n != null ? Math.round(n * 10) / 10 : null;
}

/**
 * GET /api/v1/stats/:deviceId
 *
 * Returns aggregated stats computed entirely in PostgreSQL:
 * - Latest snapshot (always live)
 * - Cell imbalance stats (which cell IDs appear most often as min/max)
 * - Stats by SOC zone (0-10, 10-20, ..., 90-100)
 * - Global aggregates (avg/min/max voltage, current, temp, SOH, cell delta, P95 delta)
 *
 * Heavy aggregates are cached for STATS_TTL_MS (5 min) to avoid re-scanning
 * hundreds of thousands of rows on every 30-second dashboard poll.
 *
 * Query params:
 *  - from: ISO date string (default: 30 days ago)
 *  - to:   ISO date string (default: now)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const { deviceId } = await params;

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      name: true,
      serial: true,
      location: true,
      isActive: true,
      lastSeenAt: true,
    },
  });
  if (!device) return notFound("Device not found");

  try {
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const from = searchParams.get("from")
      ? new Date(searchParams.get("from")!)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

    // ── Latest snapshot — always live (cheap indexed lookup) ──────────────
    const latest = await prisma.batterySnapshot.findFirst({
      where: { deviceId },
      orderBy: { timestamp: "desc" },
    });

    // ── Cache key for heavy aggregates ────────────────────────────────────
    // Round "to" to the nearest 5-min bucket so the key is stable during a
    // polling session even though `now` drifts slightly each request.
    const toRounded = new Date(
      Math.floor(to.getTime() / STATS_TTL_MS) * STATS_TTL_MS
    );
    const cacheKey = `stats:${deviceId}:${from.toISOString()}:${toRounded.toISOString()}`;

    type HeavyAggregates = {
      totalCount: number;
      cellImbalance: {
        mostFrequentMin: { cellId: string; count: number; pct: number }[];
        mostFrequentMax: { cellId: string; count: number; pct: number }[];
        avgDeltaV: number | null;
        maxDeltaV: number | null;
        p95DeltaV: number | null;
        sampleCount: number;
      } | null;
      socZoneStats: {
        label: string;
        min: number;
        max: number;
        count: number;
        avgDelta: number | null;
        maxDelta: number | null;
        avgTemp: number | null;
        avgPower: number | null;
      }[];
      aggregates: {
        voltage: { avg: number | null; min: number | null; max: number | null };
        current: { avg: number | null; min: number | null; max: number | null };
        temperature: {
          avg: number | null;
          min: number | null;
          max: number | null;
        };
        sohEstimated: {
          avg: number | null;
          min: number | null;
          max: number | null;
          latest: number | null;
        };
        cellDelta: {
          avg: number | null;
          max: number | null;
          p95: number | null;
        };
      } | null;
    };

    // ── Try cache first ───────────────────────────────────────────────────
    let heavy = statsCache.get<HeavyAggregates>(cacheKey);

    if (!heavy) {
      // ── 1. Global aggregates + total count — single SQL pass ───────────
      const [aggRow] = await prisma.$queryRaw<AggregateRow[]>`
        SELECT
          COUNT(*)::text                                                      AS total_count,
          AVG(voltage)                                                        AS avg_voltage,
          MIN(voltage)                                                        AS min_voltage,
          MAX(voltage)                                                        AS max_voltage,
          AVG(current)                                                        AS avg_current,
          MIN(current)                                                        AS min_current,
          MAX(current)                                                        AS max_current,
          AVG(temperature)                                                    AS avg_temp,
          MIN(temperature)                                                    AS min_temp,
          MAX(temperature)                                                    AS max_temp,
          AVG("sohEstimated")                                                 AS avg_soh,
          MIN("sohEstimated")                                                 AS min_soh,
          MAX("sohEstimated")                                                 AS max_soh,
          (
            SELECT "sohEstimated"
            FROM   "BatterySnapshot"
            WHERE  "deviceId" = ${deviceId}
              AND  timestamp >= ${from}
              AND  timestamp <= ${to}
            ORDER  BY timestamp DESC
            LIMIT  1
          )                                                                   AS latest_soh,
          AVG("cellVoltageDelta")                                             AS avg_delta,
          MAX("cellVoltageDelta")                                             AS max_delta,
          PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY "cellVoltageDelta"
          )                                                                   AS p95_delta
        FROM "BatterySnapshot"
        WHERE "deviceId" = ${deviceId}
          AND timestamp >= ${from}
          AND timestamp <= ${to}
      `;

      const totalCount = parseInt(aggRow.total_count ?? "0", 10);

      if (totalCount === 0) {
        heavy = {
          totalCount: 0,
          cellImbalance: null,
          socZoneStats: [],
          aggregates: null,
        };
      } else {
        // ── 2. Cell imbalance — two GROUP BY queries ───────────────────
        const [minCells, maxCells] = await Promise.all([
          prisma.$queryRaw<CellFreqRow[]>`
            SELECT "minCellVoltageId" AS cell_id, COUNT(*)::text AS cnt
            FROM   "BatterySnapshot"
            WHERE  "deviceId" = ${deviceId}
              AND  timestamp >= ${from}
              AND  timestamp <= ${to}
              AND  "minCellVoltageId" IS NOT NULL
            GROUP  BY "minCellVoltageId"
            ORDER  BY cnt DESC
            LIMIT  5
          `,
          prisma.$queryRaw<CellFreqRow[]>`
            SELECT "maxCellVoltageId" AS cell_id, COUNT(*)::text AS cnt
            FROM   "BatterySnapshot"
            WHERE  "deviceId" = ${deviceId}
              AND  timestamp >= ${from}
              AND  timestamp <= ${to}
              AND  "maxCellVoltageId" IS NOT NULL
            GROUP  BY "maxCellVoltageId"
            ORDER  BY cnt DESC
            LIMIT  5
          `,
        ]);

        // ── 3. SOC zone stats — single GROUP BY with CASE buckets ──────
        const socZoneRows = await prisma.$queryRaw<SocZoneRow[]>`
          SELECT
            (FLOOR("socEstimated" / 10) * 10)::int          AS zone_min,
            COUNT(*)::text                                   AS cnt,
            AVG("cellVoltageDelta")                          AS avg_delta,
            MAX("cellVoltageDelta")                          AS max_delta,
            AVG(temperature)                                 AS avg_temp,
            AVG(power)                                       AS avg_power
          FROM "BatterySnapshot"
          WHERE "deviceId" = ${deviceId}
            AND timestamp >= ${from}
            AND timestamp <= ${to}
            AND "socEstimated" >= 0
            AND "socEstimated" < 100
          GROUP BY FLOOR("socEstimated" / 10) * 10
          ORDER BY zone_min
        `;

        // Build full zone list (0–90) filling gaps with zero counts
        const zoneMap = new Map(
          socZoneRows.map((r) => [r.zone_min, r])
        );
        const socZoneStats = Array.from({ length: 10 }, (_, i) => {
          const zMin = i * 10;
          const zMax = zMin + 10;
          const r = zoneMap.get(zMin);
          if (!r) {
            return {
              label: `${zMin}-${zMax}%`,
              min: zMin,
              max: zMax,
              count: 0,
              avgDelta: null,
              maxDelta: null,
              avgTemp: null,
              avgPower: null,
            };
          }
          return {
            label: `${zMin}-${zMax}%`,
            min: zMin,
            max: zMax,
            count: parseInt(r.cnt, 10),
            avgDelta: round3(r.avg_delta),
            maxDelta: round3(r.max_delta),
            avgTemp: round1(r.avg_temp),
            avgPower: round1(r.avg_power),
          };
        });

        // Build cell imbalance summary
        const deltaAvg = round3(aggRow.avg_delta);
        const deltaMax = round3(aggRow.max_delta);
        const deltaP95 = round3(aggRow.p95_delta);

        const totalMinWithId = minCells.reduce(
          (s, r) => s + parseInt(r.cnt, 10),
          0
        );
        const totalMaxWithId = maxCells.reduce(
          (s, r) => s + parseInt(r.cnt, 10),
          0
        );

        heavy = {
          totalCount,
          cellImbalance:
            deltaAvg != null || minCells.length > 0
              ? {
                  mostFrequentMin: minCells.map((r) => {
                    const count = parseInt(r.cnt, 10);
                    return {
                      cellId: r.cell_id,
                      count,
                      pct:
                        totalMinWithId > 0
                          ? Math.round((count / totalMinWithId) * 1000) / 10
                          : 0,
                    };
                  }),
                  mostFrequentMax: maxCells.map((r) => {
                    const count = parseInt(r.cnt, 10);
                    return {
                      cellId: r.cell_id,
                      count,
                      pct:
                        totalMaxWithId > 0
                          ? Math.round((count / totalMaxWithId) * 1000) / 10
                          : 0,
                    };
                  }),
                  avgDeltaV: deltaAvg,
                  maxDeltaV: deltaMax,
                  p95DeltaV: deltaP95,
                  sampleCount: totalCount,
                }
              : null,
          socZoneStats,
          aggregates: {
            voltage: {
              avg: round2(aggRow.avg_voltage),
              min: round2(aggRow.min_voltage),
              max: round2(aggRow.max_voltage),
            },
            current: {
              avg: round2(aggRow.avg_current),
              min: round2(aggRow.min_current),
              max: round2(aggRow.max_current),
            },
            temperature: {
              avg: round2(aggRow.avg_temp),
              min: round2(aggRow.min_temp),
              max: round2(aggRow.max_temp),
            },
            sohEstimated: {
              avg: round2(aggRow.avg_soh),
              min: round2(aggRow.min_soh),
              max: round2(aggRow.max_soh),
              latest: round2(aggRow.latest_soh),
            },
            cellDelta: {
              avg: deltaAvg,
              max: deltaMax,
              p95: deltaP95,
            },
          },
        };

        statsCache.set(cacheKey, heavy, STATS_TTL_MS);
      }
    }

    return ok({
      device,
      latest: latest ? { ...latest, id: latest.id.toString() } : null,
      period: { from: from.toISOString(), to: to.toISOString() },
      totalSnapshots: heavy.totalCount,
      cellImbalance: heavy.cellImbalance,
      socZoneStats: heavy.socZoneStats,
      aggregates: heavy.aggregates,
    });
  } catch (e) {
    console.error("Stats error:", e);
    return serverError();
  }
}
