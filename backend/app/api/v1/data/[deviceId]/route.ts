import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { ok, unauthorized, notFound, serverError } from "@/lib/api-response";

type Params = { params: Promise<{ deviceId: string }> };

/**
 * GET /api/v1/data/:deviceId
 *
 * Query params:
 *  - from: ISO date string (default: 24h ago)
 *  - to: ISO date string (default: now)
 *  - limit: max points to return (default: 1000, max: 5000)
 *  - downsample: if "true", return ~300 points using step sampling (default: false)
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
    const rawLimit = parseInt(searchParams.get("limit") || "1000");
    const limit = Math.min(Math.max(1, rawLimit), 5000);
    const downsample = searchParams.get("downsample") === "true";

    const snapshots = await prisma.batterySnapshot.findMany({
      where: {
        deviceId,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: "asc" },
      take: downsample ? undefined : limit,
      select: {
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
      },
    });

    // Downsample: keep every Nth point to fit within limit
    let data = snapshots;
    if (downsample && snapshots.length > limit) {
      const step = Math.ceil(snapshots.length / limit);
      data = snapshots.filter((_, i) => i % step === 0);
    }

    // Serialize BigInt ids
    const serialized = data.map((s) => ({ ...s, id: s.id.toString() }));

    return ok({
      deviceId,
      deviceName: device.name,
      from: from.toISOString(),
      to: to.toISOString(),
      count: serialized.length,
      totalCount: snapshots.length,
      data: serialized,
    });
  } catch (e) {
    console.error("Data fetch error:", e);
    return serverError();
  }
}
