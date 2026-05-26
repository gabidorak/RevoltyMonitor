import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { ok, unauthorized, notFound, serverError } from "@/lib/api-response";

type Params = { params: Promise<{ deviceId: string }> };

// Explicit output shape — both code paths produce this
interface SnapshotRow {
  id: bigint;
  timestamp: Date;
  voltage: number;
  current: number;
  power: number;
  temperature: number | null;
  socBms: number;
  socEstimated: number;
  sohBms: number;
  sohEstimated: number;
  capacity: number | null;
  installedCapacity: number | null;
  consumedAmphours: number | null;
  minCellVoltage: number | null;
  maxCellVoltage: number | null;
  cellVoltageDelta: number | null;
  minCellVoltageId: string | null;
  maxCellVoltageId: string | null;
  minCellTemperature: number | null;
  maxCellTemperature: number | null;
  tempDelta: number | null;
  minTempCellId: string | null;
  maxTempCellId: string | null;
  modulesOnline: number | null;
  modulesOffline: number | null;
  chargedEnergy: number | null;
  dischargedEnergy: number | null;
  socBmsDelta: number | null;
  inDeadZone: boolean | null;
  restTimer: number | null;
  anchorSoc: number | null;
  anchorAh: number | null;
  lastSohSample: number | null;
  alarmLowVoltage: boolean;
  alarmHighVoltage: boolean;
  alarmLowSoc: boolean;
  alarmCellImbalance: boolean;
  alarmHighTemperature: boolean;
  alarmLowTemperature: boolean;
  alarmHighCellVoltage: boolean;
  alarmInternalFailure: boolean;
  alarmChargeBlocked: boolean;
  alarmDischargeBlocked: boolean;
}

const SNAPSHOT_SELECT = {
  id: true,
  timestamp: true,
  voltage: true,
  current: true,
  power: true,
  temperature: true,
  socBms: true,
  socEstimated: true,
  sohBms: true,
  sohEstimated: true,
  capacity: true,
  installedCapacity: true,
  consumedAmphours: true,
  minCellVoltage: true,
  maxCellVoltage: true,
  cellVoltageDelta: true,
  minCellVoltageId: true,
  maxCellVoltageId: true,
  minCellTemperature: true,
  maxCellTemperature: true,
  tempDelta: true,
  minTempCellId: true,
  maxTempCellId: true,
  modulesOnline: true,
  modulesOffline: true,
  chargedEnergy: true,
  dischargedEnergy: true,
  socBmsDelta: true,
  inDeadZone: true,
  restTimer: true,
  anchorSoc: true,
  anchorAh: true,
  lastSohSample: true,
  alarmLowVoltage: true,
  alarmHighVoltage: true,
  alarmLowSoc: true,
  alarmCellImbalance: true,
  alarmHighTemperature: true,
  alarmLowTemperature: true,
  alarmHighCellVoltage: true,
  alarmInternalFailure: true,
  alarmChargeBlocked: true,
  alarmDischargeBlocked: true,
} as const;

/**
 * GET /api/v1/data/:deviceId
 *
 * Query params:
 *  - from:       ISO date string (default: 24h ago)
 *  - to:         ISO date string (default: now)
 *  - limit:      max points to return (default: 500, max: 5000)
 *  - downsample: if "true", use SQL-level row sampling to stay within `limit`
 *                points without pulling the full dataset into JS first.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const { deviceId } = await params;

  // Check device exists
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, name: true },
  });
  if (!device) return notFound("Device not found");

  try {
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const from = searchParams.get("from")
      ? new Date(searchParams.get("from")!)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
    const rawLimit = parseInt(searchParams.get("limit") || "500");
    const limit = Math.min(Math.max(1, rawLimit), 5000);
    const downsample = searchParams.get("downsample") === "true";

    let data: SnapshotRow[];
    let totalCount: number;

    if (downsample) {
      // ── SQL-level downsampling ──────────────────────────────────────────
      // Count first using the covering index (cheap), then pick every Nth row
      // in SQL so we never pull the full dataset into JS.
      const countResult = await prisma.batterySnapshot.count({
        where: { deviceId, timestamp: { gte: from, lte: to } },
      });
      totalCount = countResult;

      if (totalCount === 0) {
        data = [];
      } else {
        const step = Math.max(1, Math.floor(totalCount / limit));

        if (step === 1) {
          // Already within limit — plain Prisma query
          data = (await prisma.batterySnapshot.findMany({
            where: { deviceId, timestamp: { gte: from, lte: to } },
            orderBy: { timestamp: "asc" },
            take: limit,
            select: SNAPSHOT_SELECT,
          })) as unknown as SnapshotRow[];
        } else {
          // CTE with ROW_NUMBER — pick every Nth row entirely in PostgreSQL
          data = await prisma.$queryRaw<SnapshotRow[]>`
            WITH numbered AS (
              SELECT *,
                     ROW_NUMBER() OVER (ORDER BY timestamp ASC) AS rn
              FROM   "BatterySnapshot"
              WHERE  "deviceId" = ${deviceId}
                AND  timestamp >= ${from}
                AND  timestamp <= ${to}
            )
            SELECT
              id, timestamp, voltage, current, power, temperature,
              "socBms", "socEstimated", "sohBms", "sohEstimated",
              capacity, "installedCapacity", "consumedAmphours",
              "minCellVoltage", "maxCellVoltage", "cellVoltageDelta",
              "minCellVoltageId", "maxCellVoltageId",
              "minCellTemperature", "maxCellTemperature", "tempDelta",
              "minTempCellId", "maxTempCellId",
              "modulesOnline", "modulesOffline",
              "chargedEnergy", "dischargedEnergy",
              "socBmsDelta", "inDeadZone", "restTimer",
              "anchorSoc", "anchorAh", "lastSohSample",
              "alarmLowVoltage", "alarmHighVoltage", "alarmLowSoc",
              "alarmCellImbalance", "alarmHighTemperature", "alarmLowTemperature",
              "alarmHighCellVoltage", "alarmInternalFailure",
              "alarmChargeBlocked", "alarmDischargeBlocked"
            FROM numbered
            WHERE (rn - 1) % ${step} = 0
            LIMIT  ${limit}
          `;
        }
      }
    } else {
      // ── Normal fetch with hard limit ────────────────────────────────────
      data = (await prisma.batterySnapshot.findMany({
        where: { deviceId, timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: "asc" },
        take: limit,
        select: SNAPSHOT_SELECT,
      })) as unknown as SnapshotRow[];
      totalCount = data.length; // exact only up to `limit`; fine for this path
    }

    // Serialize BigInt ids
    const serialized = data.map((s) => ({ ...s, id: s.id.toString() }));

    return ok({
      deviceId,
      deviceName: device.name,
      from: from.toISOString(),
      to: to.toISOString(),
      count: serialized.length,
      totalCount,
      data: serialized,
    });
  } catch (e) {
    console.error("Data fetch error:", e);
    return serverError();
  }
}
