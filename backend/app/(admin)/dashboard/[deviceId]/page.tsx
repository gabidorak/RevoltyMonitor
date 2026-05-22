"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { format, subHours, subDays } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────────

interface Snapshot {
  id: string;
  timestamp: string;
  voltage: number;
  current: number;
  power: number;
  temperature: number | null;
  socBms: number;
  socEstimated: number;
  sohEstimated: number;
  cellVoltageDelta: number | null;
  minCellVoltage: number | null;
  maxCellVoltage: number | null;
  minCellVoltageId: string | null;
  maxCellVoltageId: string | null;
  minCellTemperature: number | null;
  maxCellTemperature: number | null;
  tempDelta: number | null;
  socBmsDelta: number | null;
}

interface StatsData {
  device: {
    id: string;
    name: string;
    serial: string | null;
    location: string | null;
    isActive: boolean;
    lastSeenAt: string | null;
  };
  latest: Snapshot | null;
  totalSnapshots: number;
  cellImbalance: {
    mostFrequentMin: { cellId: string; count: number; pct: number }[];
    mostFrequentMax: { cellId: string; count: number; pct: number }[];
    avgDeltaV: number | null;
    maxDeltaV: number | null;
    p95DeltaV: number | null;
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
    temperature: { avg: number | null; min: number | null; max: number | null };
    sohEstimated: { avg: number | null; min: number | null; max: number | null; latest: number | null };
    cellDelta: { avg: number | null; max: number | null; p95: number | null };
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHART_COLOR = {
  green: "#4ade80",
  amber: "#fbbf24",
  orange: "#fb923c",
  blue: "#60a5fa",
  purple: "#c084fc",
  red: "#f87171",
  gray: "#6b7280",
};

function fmt(ts: string) {
  return format(new Date(ts), "HH:mm");
}

const TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

// ── Sub-components ─────────────────────────────────────────────────────────

function StatBox({
  label,
  value,
  unit,
  sub,
  color = "text-white",
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value != null ? value : "—"}
        {unit && value != null && (
          <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
        )}
      </p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; unit?: string }[];
  label?: string;
}) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{p.value?.toFixed ? p.value.toFixed(2) : p.value}</span>
          {p.unit && <span className="text-gray-400"> {p.unit}</span>}
        </p>
      ))}
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const deviceId = params.deviceId as string;

  const [timeRange, setTimeRange] = useState(24); // hours
  const [chartData, setChartData] = useState<Snapshot[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const now = new Date();
      const from =
        timeRange >= 24 * 7
          ? subDays(now, timeRange / 24)
          : subHours(now, timeRange);

      const [dataRes, statsRes] = await Promise.all([
        fetch(
          `/api/v1/data/${deviceId}?from=${from.toISOString()}&to=${now.toISOString()}&downsample=true&limit=500`,
          { credentials: "include" }
        ),
        fetch(
          `/api/v1/stats/${deviceId}?from=${subDays(now, 30).toISOString()}&to=${now.toISOString()}`,
          { credentials: "include" }
        ),
      ]);

      if (dataRes.status === 401 || statsRes.status === 401) {
        router.push("/login");
        return;
      }

      const dataJson = await dataRes.json();
      const statsJson = await statsRes.json();

      if (dataJson.success) setChartData(dataJson.data.data || []);
      if (statsJson.success) setStats(statsJson.data);
      else setError(statsJson.error || "Échec du chargement des statistiques");
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, [deviceId, timeRange, router]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  // Prepare chart data (add computed mV delta)
  const prepared = chartData.map((s) => ({
    ...s,
    ts: fmt(s.timestamp),
    cellDeltaMv:
      s.cellVoltageDelta != null
        ? Math.round(s.cellVoltageDelta * 1000)
        : null,
    minCellV_mV:
      s.minCellVoltage != null ? s.minCellVoltage * 1000 : null,
    maxCellV_mV:
      s.maxCellVoltage != null ? s.maxCellVoltage * 1000 : null,
  }));

  const latest = stats?.latest;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => router.back()}
          className="mt-3 text-sm text-gray-400 hover:text-white"
        >
          ← Retour
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1 mb-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-white">
            {stats?.device.name ?? "Chargement..."}
          </h1>
          {stats?.device && (
            <p className="text-gray-400 text-sm mt-0.5">
              {stats.device.location && `${stats.device.location} · `}
              {stats.device.serial && `S/N: ${stats.device.serial} · `}
              {stats.totalSnapshots.toLocaleString()} snapshots au total
            </p>
          )}
        </div>

        {/* Time range selector */}
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setTimeRange(r.hours)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                timeRange === r.hours
                  ? "bg-green-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live metrics */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatBox
            label="SOC (estimé)"
            value={latest.socEstimated.toFixed(1)}
            unit="%"
            sub={`BMS: ${latest.socBms.toFixed(1)}%`}
            color={
              latest.socEstimated < 20
                ? "text-red-400"
                : latest.socEstimated > 80
                ? "text-green-400"
                : "text-white"
            }
          />
          <StatBox label="Tension" value={latest.voltage.toFixed(2)} unit="V" />
          <StatBox
            label="Puissance"
            value={latest.power.toFixed(0)}
            unit="W"
            color={latest.power >= 0 ? "text-green-400" : "text-orange-400"}
          />
          <StatBox
            label="Δ Cellules"
            value={
              latest.cellVoltageDelta != null
                ? (latest.cellVoltageDelta * 1000).toFixed(0)
                : null
            }
            unit="mV"
            sub={
              latest.minCellVoltageId && latest.maxCellVoltageId
                ? `Min: ${latest.minCellVoltageId} / Max: ${latest.maxCellVoltageId}`
                : undefined
            }
            color={
              latest.cellVoltageDelta != null &&
              latest.cellVoltageDelta * 1000 > 50
                ? "text-amber-400"
                : "text-white"
            }
          />
          <StatBox
            label="Temp max"
            value={latest.maxCellTemperature?.toFixed(1) ?? null}
            unit="°C"
            sub={
              latest.minCellTemperature != null
                ? `Min: ${latest.minCellTemperature.toFixed(1)}°C`
                : undefined
            }
          />
          <StatBox
            label="SOH (estimé)"
            value={latest.sohEstimated.toFixed(1)}
            unit="%"
          />
        </div>
      )}

      {loading && chartData.length === 0 && (
        <div className="flex justify-center py-16">
          <svg className="animate-spin w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {prepared.length > 0 && (
        <>
          {/* SOC chart */}
          <ChartCard title="📈 SOC — Estimé vs BMS">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={prepared}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="ts" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} unit="%" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="socEstimated" name="SOC estimé" stroke={CHART_COLOR.green} dot={false} strokeWidth={2} unit="%" />
                <Line type="monotone" dataKey="socBms" name="SOC BMS" stroke={CHART_COLOR.gray} dot={false} strokeWidth={1.5} strokeDasharray="4 2" unit="%" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Cell voltage delta */}
          <ChartCard title="⚡ Déséquilibre cellules — Δ tension (mV)">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={prepared}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="ts" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} unit="mV" />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={50} stroke={CHART_COLOR.amber} strokeDasharray="4 2" label={{ value: "50mV", fill: "#fbbf24", fontSize: 10 }} />
                <Line type="monotone" dataKey="cellDeltaMv" name="Δ cellules" stroke={CHART_COLOR.amber} dot={false} strokeWidth={2} unit="mV" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Min/Max cell voltages */}
          <ChartCard title="🔋 Tensions cellule min / max (mV)">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={prepared}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="ts" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} unit="mV" domain={["auto", "auto"]} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="maxCellV_mV" name="Max cellule" stroke={CHART_COLOR.orange} dot={false} strokeWidth={2} unit="mV" />
                <Line type="monotone" dataKey="minCellV_mV" name="Min cellule" stroke={CHART_COLOR.blue} dot={false} strokeWidth={2} unit="mV" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Temperature */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="🌡️ Températures (°C)">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={prepared}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="ts" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} unit="°C" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="maxCellTemperature" name="Temp max" stroke={CHART_COLOR.red} dot={false} strokeWidth={2} unit="°C" />
                  <Line type="monotone" dataKey="minCellTemperature" name="Temp min" stroke={CHART_COLOR.blue} dot={false} strokeWidth={2} unit="°C" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Power */}
            <ChartCard title="⚡ Puissance (W)">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={prepared}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="ts" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} unit="W" />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="#374151" />
                  <Line type="monotone" dataKey="power" name="Puissance" stroke={CHART_COLOR.purple} dot={false} strokeWidth={2} unit="W" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}

      {/* Stats section */}
      {stats && stats.cellImbalance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Most unbalanced cells */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">
              🔴 Cellules les plus déséquilibrées (30 jours)
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-2">Souvent en position MIN (déchargée)</p>
                {stats.cellImbalance.mostFrequentMin.map((c) => (
                  <div key={c.cellId} className="flex items-center gap-3 mb-1.5">
                    <span className="text-xs font-mono text-blue-400 w-14">{c.cellId}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${Math.min(c.pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-12 text-right">{c.pct}%</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs text-gray-500 mb-2">Souvent en position MAX (chargée en premier)</p>
                {stats.cellImbalance.mostFrequentMax.map((c) => (
                  <div key={c.cellId} className="flex items-center gap-3 mb-1.5">
                    <span className="text-xs font-mono text-orange-400 w-14">{c.cellId}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-orange-500 h-2 rounded-full"
                        style={{ width: `${Math.min(c.pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-12 text-right">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Cell delta summary */}
            <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Δ moyen", value: stats.cellImbalance.avgDeltaV != null ? (stats.cellImbalance.avgDeltaV * 1000).toFixed(1) : null, unit: "mV" },
                { label: "Δ max", value: stats.cellImbalance.maxDeltaV != null ? (stats.cellImbalance.maxDeltaV * 1000).toFixed(1) : null, unit: "mV" },
                { label: "Δ P95", value: stats.cellImbalance.p95DeltaV != null ? (stats.cellImbalance.p95DeltaV * 1000).toFixed(1) : null, unit: "mV" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-base font-bold text-amber-400">
                    {item.value ?? "—"}{item.value && <span className="text-xs text-gray-400 ml-1">{item.unit}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* SOC zone stats */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">
              📊 Métriques par zone SOC (30 jours)
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={stats.socZoneStats}
                margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} unit="mV" />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="avgDelta" name="Δ moyen" fill={CHART_COLOR.amber} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-500 text-center mt-1">Déséquilibre moyen par zone de SOC</p>
          </div>
        </div>
      )}
    </div>
  );
}
