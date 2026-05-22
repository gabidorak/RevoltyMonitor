import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { ok, error, unauthorized, serverError } from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    // ── Auth: extract API key from header ─────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return unauthorized("Missing API key");
    }
    const apiKey = authHeader.replace("Bearer ", "").trim();
    if (!apiKey.startsWith("rvm_")) {
      return unauthorized("Invalid API key format");
    }

    // ── Find device by checking all active devices ─────────────────────────
    // (bcrypt.compare is ~100ms, and we only have a handful of devices, so this is fine)
    const devices = await prisma.device.findMany({
      where: { isActive: true },
      select: { id: true, apiKeyHash: true, serial: true },
    });

    let matchedDevice: (typeof devices)[0] | null = null;
    for (const device of devices) {
      const match = await verifyApiKey(apiKey, device.apiKeyHash);
      if (match) {
        matchedDevice = device;
        break;
      }
    }

    if (!matchedDevice) {
      return unauthorized("Invalid or revoked API key");
    }

    // ── Parse payload ──────────────────────────────────────────────────────
    const body = await req.json();

    // Validate required fields
    const required = [
      "voltage",
      "current",
      "power",
      "socBms",
      "socEstimated",
      "sohBms",
      "sohEstimated",
    ];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return error(`Missing required field: ${field}`);
      }
    }

    // ── Auto-update serial if first time ────────────────────────────────
    if (body.serial && !matchedDevice.serial) {
      await prisma.device.update({
        where: { id: matchedDevice.id },
        data: { serial: body.serial },
      });
    }

    // ── Compute derived fields ─────────────────────────────────────────────
    const minCellV =
      body.minCellVoltage != null ? Number(body.minCellVoltage) : null;
    const maxCellV =
      body.maxCellVoltage != null ? Number(body.maxCellVoltage) : null;
    const cellDelta =
      minCellV != null && maxCellV != null
        ? Math.round((maxCellV - minCellV) * 1000) / 1000
        : null;

    const minTemp =
      body.minCellTemperature != null
        ? Number(body.minCellTemperature)
        : null;
    const maxTemp =
      body.maxCellTemperature != null
        ? Number(body.maxCellTemperature)
        : null;
    const tempDelta =
      minTemp != null && maxTemp != null
        ? Math.round((maxTemp - minTemp) * 10) / 10
        : null;

    // ── Insert snapshot ────────────────────────────────────────────────────
    const snapshot = await prisma.batterySnapshot.create({
      data: {
        deviceId: matchedDevice.id,
        timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),

        // Pack
        voltage: Number(body.voltage),
        current: Number(body.current),
        power: Number(body.power),
        temperature: body.temperature != null ? Number(body.temperature) : null,

        // SOC/SOH
        socBms: Number(body.socBms),
        socEstimated: Number(body.socEstimated),
        sohBms: Number(body.sohBms),
        sohEstimated: Number(body.sohEstimated),

        // Capacity
        capacity: body.capacity != null ? Number(body.capacity) : null,
        installedCapacity:
          body.installedCapacity != null
            ? Number(body.installedCapacity)
            : null,
        consumedAmphours:
          body.consumedAmphours != null ? Number(body.consumedAmphours) : null,

        // Cell voltages
        minCellVoltage: minCellV,
        maxCellVoltage: maxCellV,
        cellVoltageDelta: cellDelta,
        minCellVoltageId: body.minCellVoltageId ?? null,
        maxCellVoltageId: body.maxCellVoltageId ?? null,

        // Temperatures
        minCellTemperature: minTemp,
        maxCellTemperature: maxTemp,
        tempDelta,
        minTempCellId: body.minTempCellId ?? null,
        maxTempCellId: body.maxTempCellId ?? null,

        // System
        modulesOnline:
          body.modulesOnline != null ? Number(body.modulesOnline) : null,
        modulesOffline:
          body.modulesOffline != null ? Number(body.modulesOffline) : null,
        chargedEnergy:
          body.chargedEnergy != null ? Number(body.chargedEnergy) : null,
        dischargedEnergy:
          body.dischargedEnergy != null ? Number(body.dischargedEnergy) : null,

        // Estimator extra
        socBmsDelta: body.socBmsDelta != null ? Number(body.socBmsDelta) : null,
        inDeadZone: body.inDeadZone != null ? Boolean(body.inDeadZone) : null,
        restTimer: body.restTimer != null ? Number(body.restTimer) : null,
        anchorSoc: body.anchorSoc != null ? Number(body.anchorSoc) : null,
        anchorAh: body.anchorAh != null ? Number(body.anchorAh) : null,
        lastSohSample:
          body.lastSohSample != null ? Number(body.lastSohSample) : null,

        // Alarms
        alarmLowVoltage: Boolean(body.alarmLowVoltage),
        alarmHighVoltage: Boolean(body.alarmHighVoltage),
        alarmLowSoc: Boolean(body.alarmLowSoc),
        alarmCellImbalance: Boolean(body.alarmCellImbalance),
        alarmHighTemperature: Boolean(body.alarmHighTemperature),
        alarmLowTemperature: Boolean(body.alarmLowTemperature),
        alarmHighCellVoltage: Boolean(body.alarmHighCellVoltage),
        alarmInternalFailure: Boolean(body.alarmInternalFailure),
        alarmChargeBlocked: Boolean(body.alarmChargeBlocked),
        alarmDischargeBlocked: Boolean(body.alarmDischargeBlocked),
      },
    });

    // ── Update device lastSeenAt ──────────────────────────────────────────
    await prisma.device.update({
      where: { id: matchedDevice.id },
      data: { lastSeenAt: new Date() },
    });

    return ok({ id: snapshot.id.toString(), timestamp: snapshot.timestamp });
  } catch (e) {
    console.error("Ingest error:", e);
    return serverError("Failed to store snapshot");
  }
}
