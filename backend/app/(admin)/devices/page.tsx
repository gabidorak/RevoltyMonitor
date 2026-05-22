"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";

interface Device {
  id: string;
  name: string;
  description: string | null;
  apiKeyHint: string;
  serial: string | null;
  location: string | null;
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  _count: { snapshots: number };
}

interface NewKeyResult {
  id: string;
  name: string;
  apiKey: string;
  apiKeyHint: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs text-gray-400 hover:text-green-400 transition-colors flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copié !
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copier
        </>
      )}
    </button>
  );
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newDevice, setNewDevice] = useState({ name: "", description: "", location: "" });
  const [creating, setCreating] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/devices", { credentials: "include" });
      const data = await res.json();
      if (data.success) setDevices(data.data);
    } catch {
      setError("Échec du chargement des appareils");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newDevice),
      });
      const data = await res.json();
      if (data.success) {
        setNewKeyResult(data.data);
        setShowForm(false);
        setNewDevice({ name: "", description: "", location: "" });
        fetchDevices();
      } else {
        setError(data.error || "Échec de la création de l'appareil");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/devices/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        setDevices((prev) => prev.filter((d) => d.id !== id));
        setDeleteConfirm(null);
      } else {
        setError(data.error || "Échec de la suppression");
      }
    } catch {
      setError("Erreur réseau");
    }
  };

  const handleToggle = async (device: Device) => {
    try {
      const res = await fetch(`/api/v1/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !device.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        setDevices((prev) =>
          prev.map((d) => (d.id === device.id ? { ...d, isActive: !d.isActive } : d))
        );
      }
    } catch {
      setError("Erreur réseau");
    }
  };

  const handleRegenerateKey = async (id: string, name: string) => {
    if (!confirm(`Regénérer la clé API pour "${name}" ? L'ancienne clé cessera de fonctionner immédiatement.`)) return;
    try {
      const res = await fetch(`/api/v1/devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ regenerateKey: true }),
      });
      const data = await res.json();
      if (data.success && data.data.apiKey) {
        setNewKeyResult({ id, name, apiKey: data.data.apiKey, apiKeyHint: data.data.apiKeyHint });
        fetchDevices();
      }
    } catch {
      setError("Erreur réseau");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Appareils & Clés API</h1>
          <p className="text-gray-400 text-sm mt-0.5">Gérer les appareils GX et leurs clés d&apos;accès</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500
                     text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nouvel appareil
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {error}
          <button onClick={() => setError("")} className="ml-auto text-gray-500 hover:text-white">×</button>
        </div>
      )}

      {/* New key banner */}
      {newKeyResult && (
        <div className="mb-4 bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-green-400 font-semibold text-sm mb-1">
                ✅ Clé API pour &ldquo;{newKeyResult.name}&rdquo; — sauvegardez-la maintenant, elle ne sera plus affichée !
              </p>
              <div className="flex items-center gap-3 mt-2">
                <code className="bg-gray-900 border border-gray-700 px-3 py-1.5 rounded-lg text-sm font-mono text-green-300 break-all">
                  {newKeyResult.apiKey}
                </code>
                <CopyButton text={newKeyResult.apiKey} />
              </div>
            </div>
            <button onClick={() => setNewKeyResult(null)} className="text-gray-500 hover:text-white text-lg ml-4">×</button>
          </div>
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Créer un nouvel appareil</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nom *</label>
                <input
                  type="text"
                  required
                  value={newDevice.name}
                  onChange={(e) => setNewDevice((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Maison principale"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Emplacement</label>
                <input
                  type="text"
                  value={newDevice.location}
                  onChange={(e) => setNewDevice((p) => ({ ...p, location: e.target.value }))}
                  placeholder="Garage / Toiture"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
                <input
                  type="text"
                  value={newDevice.description}
                  onChange={(e) => setNewDevice((p) => ({ ...p, description: e.target.value }))}
                  placeholder="3 packs LiFePO4 200Ah 16S"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setError(""); }}
                  className="flex-1 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  {creating ? "Création..." : "Créer & Obtenir la clé"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Devices list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <svg className="animate-spin w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : devices.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-700 rounded-2xl">
          <p className="text-gray-400">Aucun appareil. Créez-en un ci-dessus.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={device.id}
              className={`bg-gray-900 border rounded-xl p-5 ${
                device.isActive ? "border-gray-800" : "border-gray-700 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                        device.isActive ? "bg-green-400" : "bg-gray-600"
                      }`}
                    />
                    <h3 className="font-semibold text-white truncate">{device.name}</h3>
                    {!device.isActive && (
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">Désactivé</span>
                    )}
                  </div>
                  {device.location && <p className="text-sm text-gray-400">{device.location}</p>}
                  {device.description && <p className="text-xs text-gray-500 mt-0.5">{device.description}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                    <span>🔑 Indice clé : <code className="text-gray-400">...{device.apiKeyHint}</code></span>
                    {device.serial && <span>S/N: {device.serial}</span>}
                    <span>{device._count.snapshots.toLocaleString()} snapshots</span>
                    {device.lastSeenAt && (
                      <span>Vu il y a : {formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(device)}
                    className="px-3 py-1.5 text-xs rounded-lg border transition-colors
                               border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white"
                  >
                    {device.isActive ? "Désactiver" : "Activer"}
                  </button>
                  <button
                    onClick={() => handleRegenerateKey(device.id, device.name)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400
                               hover:border-amber-500/50 hover:text-amber-400 transition-colors"
                  >
                    Regénérer clé
                  </button>
                  {deleteConfirm === device.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(device.id)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
                      >
                        Confirmer
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors"
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(device.id)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400
                                 hover:border-red-500/50 hover:text-red-400 transition-colors"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
