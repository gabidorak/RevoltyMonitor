import { prisma } from "@/lib/db";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

async function getDevicesWithLatest() {
  const devices = await prisma.device.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: {
        take: 1,
        orderBy: { timestamp: "desc" },
        select: {
          timestamp: true,
          voltage: true,
          current: true,
          power: true,
          socEstimated: true,
          sohEstimated: true,
          cellVoltageDelta: true,
          maxCellTemperature: true,
          minCellTemperature: true,
          alarmCellImbalance: true,
          alarmHighTemperature: true,
          alarmLowVoltage: true,
          alarmHighVoltage: true,
          modulesOffline: true,
        },
      },
      _count: { select: { snapshots: true } },
    },
  });
  return devices;
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        online ? "bg-green-400" : "bg-gray-600"
      }`}
    />
  );
}

function MetricCard({
  label,
  value,
  unit,
  color = "text-white",
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-bold ${color}`}>
        {value != null ? value : "—"}
        {unit && value != null && (
          <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
        )}
      </span>
    </div>
  );
}

export default async function DashboardPage() {
  const devices = await getDevicesWithLatest();

  const now = new Date();
  const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {devices.length} device{devices.length !== 1 ? "s" : ""} registered
          </p>
        </div>
        <Link
          href="/devices"
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500
                     text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Device
        </Link>
      </div>

      {/* Devices grid */}
      {devices.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-gray-700 rounded-2xl">
          <svg className="w-12 h-12 text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          <p className="text-gray-400">No devices yet.</p>
          <p className="text-gray-500 text-sm mt-1">
            Go to{" "}
            <Link href="/devices" className="text-green-400 hover:underline">
              Devices
            </Link>{" "}
            to create your first device and get an API key.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {devices.map((device) => {
            const snap = device.snapshots[0] || null;
            const isOnline =
              device.lastSeenAt != null &&
              now.getTime() - new Date(device.lastSeenAt).getTime() <
                ONLINE_THRESHOLD_MS;
            const hasAlarm =
              snap &&
              (snap.alarmCellImbalance ||
                snap.alarmHighTemperature ||
                snap.alarmLowVoltage ||
                snap.alarmHighVoltage ||
                (snap.modulesOffline ?? 0) > 0);

            return (
              <Link
                key={device.id}
                href={`/dashboard/${device.id}`}
                className="group block bg-gray-900 border border-gray-800 hover:border-gray-700
                           rounded-2xl p-5 transition-all hover:shadow-lg hover:shadow-black/20"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <StatusDot online={isOnline} />
                      <h2 className="font-semibold text-white group-hover:text-green-400 transition-colors">
                        {device.name}
                      </h2>
                    </div>
                    <p className="text-xs text-gray-500">
                      {device.location || "No location"} •{" "}
                      {device._count.snapshots.toLocaleString()} snapshots
                    </p>
                  </div>
                  {hasAlarm && (
                    <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10
                                     border border-amber-400/20 rounded-full px-2 py-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                      Alarm
                    </span>
                  )}
                </div>

                {/* Metrics */}
                {snap ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <MetricCard
                      label="SOC (est.)"
                      value={snap.socEstimated.toFixed(1)}
                      unit="%"
                      color={
                        snap.socEstimated < 20
                          ? "text-red-400"
                          : snap.socEstimated > 80
                          ? "text-green-400"
                          : "text-white"
                      }
                    />
                    <MetricCard
                      label="Voltage"
                      value={snap.voltage.toFixed(2)}
                      unit="V"
                    />
                    <MetricCard
                      label="Power"
                      value={snap.power.toFixed(0)}
                      unit="W"
                      color={snap.power >= 0 ? "text-green-400" : "text-orange-400"}
                    />
                    <MetricCard
                      label="Cell Δ"
                      value={
                        snap.cellVoltageDelta != null
                          ? (snap.cellVoltageDelta * 1000).toFixed(0)
                          : null
                      }
                      unit="mV"
                      color={
                        snap.cellVoltageDelta != null &&
                        snap.cellVoltageDelta * 1000 > 50
                          ? "text-amber-400"
                          : "text-white"
                      }
                    />
                    <MetricCard
                      label="SOH (est.)"
                      value={snap.sohEstimated.toFixed(1)}
                      unit="%"
                    />
                    <MetricCard
                      label="Temp"
                      value={snap.maxCellTemperature?.toFixed(1) ?? null}
                      unit="°C"
                    />
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm py-4 text-center">No data yet</p>
                )}

                {/* Last seen */}
                <div className="mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500">
                  {snap
                    ? `Last data: ${formatDistanceToNow(new Date(snap.timestamp), { addSuffix: true })}`
                    : "Never seen"}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
