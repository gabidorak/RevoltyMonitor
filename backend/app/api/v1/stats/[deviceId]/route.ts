import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { ok, unauthorized, notFound, serverError } from "@/lib/api-response";

type Params = { params: Promise<{ deviceId: string }> };

/**
 * GET /api/v1/stats/:deviceId
 *
 * Returns aggregated stats:
 * - Latest snapshot
 * - Cell imbalance stats (which cell IDs appear most often as min/max)
 * - Stats by SOC zone (0-10, 10-20, ..., 90-100)
 * - SOH trend (last N anchor points from lastSohSample)
 * - Time series summaries (avg/min/max cell delta, temp, etc.)
 *
 * Query params:
 *  - from: ISO date string (default: 30 days ago)
 *  - to: ISO date string (default: now)
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

    // ── Latest snapshot ──────────────────────────────────────────────────
    const latest = await prisma.batterySnapshot.findFirst({
      where: { deviceId },
      orderBy: { timestamp: "desc" },
    });

    // ── Total count in range ───────────────────────────────────────────
    const totalCount = await prisma.batterySnapshot.count({
      where: { deviceId, timestamp: { gte: from, lte: to } },
    });

    if (totalCount === 0) {
      return ok({
        device,
        latest: latest
          ? { ...latest, id: latest.id.toString() }
          : null,
        period: { from: from.toISOString(), to: to.toISOString() },
        totalSnapshots: 0,
        cellImbalance: null,
        socZoneStats: [],
        aggregates: null,
      });
    }

    // ── Fetch all snapshots in range (for analysis) ────────────────────
    // Use raw query for efficiency with large datasets
    const snapshots = await prisma.batterySnapshot.findMany({
      where: {
        deviceId,
        timestamp: { gte: from, lte: to },
      },
      select: {
        socEstimated: true,
        cellVoltageDelta: true,
        minCellVoltage: true,
        maxCellVoltage: true,
        minCellVoltageId: true,
        maxCellVoltageId: true,
        minCellTemperature: true,
        maxCellTemperature: true,
        tempDelta: true,
        minTempCellId: true,
        maxTempCellId: true,
        sohEstimated: true,
        lastSohSample: true,
        voltage: true,
        current: true,
        power: true,
        temperature: true,
      },
      orderBy: { timestamp: "asc" },
    });

    // ── Cell imbalance: rank cell IDs by frequency as min/max ──────────
    const minVoltCellCount: Record<string, number> = {};
    const maxVoltCellCount: Record<string, number> = {};

    for (const s of snapshots) {
      if (s.minCellVoltageId) {
        minVoltCellCount[s.minCellVoltageId] =
          (minVoltCellCount[s.minCellVoltageId] || 0) + 1;
      }
      if (s.maxCellVoltageId) {
        maxVoltCellCount[s.maxCellVoltageId] =
          (maxVoltCellCount[s.maxCellVoltageId] || 0) + 1;
      }
    }

    const sortedMinCells = Object.entries(minVoltCellCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cellId, count]) => ({
        cellId,
        count,
        pct: Math.round((count / snapshots.length) * 1000) / 10,
      }));

    const sortedMaxCells = Object.entries(maxVoltCellCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cellId, count]) => ({
        cellId,
        count,
        pct: Math.round((count / snapshots.length) * 1000) / 10,
      }));

    // Cell delta stats
    const deltas = snapshots
      .map((s) => s.cellVoltageDelta)
      .filter((d): d is number => d !== null);
    const avgDelta =
      deltas.length > 0
        ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 1000) / 1000
        : null;
    const maxDelta = deltas.length > 0 ? Math.max(...deltas) : null;
    const p95Delta =
      deltas.length > 0
        ? (() => {
            const sorted = [...deltas].sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length * 0.95)];
          })()
        : null;

    // ── Stats by SOC zone (10% bands) ────────────────────────────────────
    const zones: {
      label: string;
      min: number;
      max: number;
      count: number;
      avgDelta: number | null;
      maxDelta: number | null;
      avgTemp: number | null;
      avgPower: number | null;
    }[] = [];

    for (let z = 0; z < 10; z++) {
      const zMin = z * 10;
      const zMax = zMin + 10;
      const zSnaps = snapshots.filter(
        (s) => s.socEstimated >= zMin && s.socEstimated < zMax
      );

      if (zSnaps.length === 0) {
        zones.push({
          label: `${zMin}-${zMax}%`,
          min: zMin,
          max: zMax,
          count: 0,
          avgDelta: null,
          maxDelta: null,
          avgTemp: null,
          avgPower: null,
        });
        continue;
      }

      const zDeltas = zSnaps
        .map((s) => s.cellVoltageDelta)
        .filter((d): d is number => d !== null);
      const zTemps = zSnaps
        .map((s) => s.temperature)
        .filter((t): t is number => t !== null);
      const zPowers = zSnaps.map((s) => s.power);

      zones.push({
        label: `${zMin}-${zMax}%`,
        min: zMin,
        max: zMax,
        count: zSnaps.length,
        avgDelta:
          zDeltas.length > 0
            ? Math.round(
                (zDeltas.reduce((a, b) => a + b, 0) / zDeltas.length) * 1000
              ) / 1000
            : null,
        maxDelta: zDeltas.length > 0 ? Math.max(...zDeltas) : null,
        avgTemp:
          zTemps.length > 0
            ? Math.round(
                (zTemps.reduce((a, b) => a + b, 0) / zTemps.length) * 10
              ) / 10
            : null,
        avgPower:
          Math.round(
            (zPowers.reduce((a, b) => a + b, 0) / zPowers.length) * 10
          ) / 10,
      });
    }

    // ── Global aggregates ────────────────────────────────────────────────
    const voltages = snapshots.map((s) => s.voltage);
    const currents = snapshots.map((s) => s.current);
    const temps = snapshots
      .map((s) => s.temperature)
      .filter((t): t is number => t !== null);
    const sohs = snapshots
      .map((s) => s.sohEstimated)
      .filter((s): s is number => s !== null);

    const avgFn = (arr: number[]) =>
      arr.length > 0
        ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100
        : null;

    const aggregates = {
      voltage: {
        avg: avgFn(voltages),
        min: voltages.length > 0 ? Math.min(...voltages) : null,
        max: voltages.length > 0 ? Math.max(...voltages) : null,
      },
      current: {
        avg: avgFn(currents),
        min: currents.length > 0 ? Math.min(...currents) : null,
        max: currents.length > 0 ? Math.max(...currents) : null,
      },
      temperature: {
        avg: avgFn(temps),
        min: temps.length > 0 ? Math.min(...temps) : null,
        max: temps.length > 0 ? Math.max(...temps) : null,
      },
      sohEstimated: {
        avg: avgFn(sohs),
        min: sohs.length > 0 ? Math.min(...sohs) : null,
        max: sohs.length > 0 ? Math.max(...sohs) : null,
        latest: sohs.length > 0 ? sohs[sohs.length - 1] : null,
      },
      cellDelta: {
        avg: avgDelta,
        max: maxDelta,
        p95: p95Delta,
      },
    };

    return ok({
      device,
      latest: latest ? { ...latest, id: latest.id.toString() } : null,
      period: { from: from.toISOString(), to: to.toISOString() },
      totalSnapshots: totalCount,
      cellImbalance: {
        mostFrequentMin: sortedMinCells,
        mostFrequentMax: sortedMaxCells,
        avgDeltaV: avgDelta,
        maxDeltaV: maxDelta,
        p95DeltaV: p95Delta,
        sampleCount: deltas.length,
      },
      socZoneStats: zones,
      aggregates,
    });
  } catch (e) {
    console.error("Stats error:", e);
    return serverError();
  }
}
