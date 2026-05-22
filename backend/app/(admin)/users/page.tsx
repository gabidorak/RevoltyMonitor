"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface User {
  id: string;
  username: string;
  role: "ADMIN" | "USER";
  createdAt: string;
  lastSeenAt: string | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState<User | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "USER" });
  const [editData, setEditData] = useState({ username: "", password: "", role: "" });
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users", { credentials: "include" });
      const data = await res.json();
      if (data.success) setUsers(data.data);
      else setError(data.error || "Échec du chargement des utilisateurs");
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me", { credentials: "include" });
      const data = await res.json();
      if (data.success) setCurrentUserId(data.data.userId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchCurrentUser();
  }, [fetchUsers, fetchCurrentUser]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateForm(false);
        setNewUser({ username: "", password: "", role: "USER" });
        setSuccess(`Utilisateur "${data.data.username}" créé avec succès`);
        fetchUsers();
      } else {
        setError(data.error || "Échec de la création");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditForm) return;
    setUpdating(true);
    setError("");
    try {
      const payload: Record<string, string> = {};
      if (editData.username && editData.username !== showEditForm.username) payload.username = editData.username;
      if (editData.password) payload.password = editData.password;
      if (editData.role && editData.role !== showEditForm.role) payload.role = editData.role;

      if (Object.keys(payload).length === 0) {
        setError("Aucune modification");
        setUpdating(false);
        return;
      }

      const res = await fetch(`/api/v1/users/${showEditForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setShowEditForm(null);
        setSuccess("Utilisateur mis à jour");
        fetchUsers();
      } else {
        setError(data.error || "Échec de la mise à jour");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setUpdating(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowPasswordForm(false);
        setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setSuccess("Mot de passe modifié avec succès");
      } else {
        setError(data.error || "Échec du changement de mot de passe");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        setDeleteConfirm(null);
        setSuccess("Utilisateur supprimé");
        fetchUsers();
      } else {
        setError(data.error || "Échec de la suppression");
      }
    } catch {
      setError("Erreur réseau");
    }
  };

  const openEditForm = (user: User) => {
    setShowEditForm(user);
    setEditData({ username: user.username, password: "", role: user.role });
    setError("");
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestion des utilisateurs</h1>
          <p className="text-gray-400 text-sm mt-0.5">Gérer les comptes et les permissions</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowPasswordForm(true); setError(""); setSuccess(""); }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-700 text-gray-300
                       hover:bg-gray-800 hover:text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Changer mon mot de passe
          </button>
          <button
            onClick={() => { setShowCreateForm(true); setError(""); setSuccess(""); }}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nouvel utilisateur
          </button>
        </div>
      </div>

      {/* Success message */}
      {success && (
        <div className="mb-4 flex items-center gap-2 text-green-400 text-sm bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {success}
          <button onClick={() => setSuccess("")} className="ml-auto text-gray-500 hover:text-white">×</button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {error}
          <button onClick={() => setError("")} className="ml-auto text-gray-500 hover:text-white">×</button>
        </div>
      )}

      {/* Create user modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Créer un nouvel utilisateur</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nom d&apos;utilisateur *</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={newUser.username}
                  onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                  placeholder="johndoe"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Mot de passe *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newUser.password}
                  onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Rôle</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             focus:outline-none focus:ring-2 focus:ring-green-500/50"
                >
                  <option value="USER">Utilisateur</option>
                  <option value="ADMIN">Administrateur</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(false); setError(""); }}
                  className="flex-1 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  {creating ? "Création..." : "Créer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {showEditForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">
              Modifier &ldquo;{showEditForm.username}&rdquo;
            </h2>
            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nom d&apos;utilisateur</label>
                <input
                  type="text"
                  minLength={3}
                  value={editData.username}
                  onChange={(e) => setEditData((p) => ({ ...p, username: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Nouveau mot de passe <span className="text-gray-500">(laisser vide pour ne pas changer)</span>
                </label>
                <input
                  type="password"
                  minLength={6}
                  value={editData.password}
                  onChange={(e) => setEditData((p) => ({ ...p, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Rôle</label>
                <select
                  value={editData.role}
                  onChange={(e) => setEditData((p) => ({ ...p, role: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             focus:outline-none focus:ring-2 focus:ring-green-500/50"
                >
                  <option value="USER">Utilisateur</option>
                  <option value="ADMIN">Administrateur</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowEditForm(null); setError(""); }}
                  className="flex-1 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  {updating ? "Mise à jour..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change password modal */}
      {showPasswordForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Changer mon mot de passe</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Mot de passe actuel *</label>
                <input
                  type="password"
                  required
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData((p) => ({ ...p, currentPassword: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nouveau mot de passe *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData((p) => ({ ...p, newPassword: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmer le nouveau mot de passe *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData((p) => ({ ...p, confirmPassword: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white
                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowPasswordForm(false); setError(""); setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" }); }}
                  className="flex-1 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  {changingPassword ? "Modification..." : "Modifier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <svg className="animate-spin w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-700 rounded-2xl">
          <p className="text-gray-400">Aucun utilisateur trouvé.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {/* User avatar */}
                    <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-gray-300">{user.username[0].toUpperCase()}</span>
                    </div>
                    <h3 className="font-semibold text-white truncate">{user.username}</h3>
                    {/* Role badge */}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        user.role === "ADMIN"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      }`}
                    >
                      {user.role === "ADMIN" ? "Administrateur" : "Utilisateur"}
                    </span>
                    {user.id === currentUserId && (
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">Vous</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 ml-10">
                    <span>Créé le {new Date(user.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</span>
                    {user.lastSeenAt ? (
                      <span>
                        Dernière connexion : {formatDistanceToNow(new Date(user.lastSeenAt), { addSuffix: true, locale: fr })}
                      </span>
                    ) : (
                      <span className="text-gray-600">Jamais connecté</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEditForm(user)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400
                               hover:border-gray-600 hover:text-white transition-colors"
                  >
                    Modifier
                  </button>
                  {user.id !== currentUserId && (
                    <>
                      {deleteConfirm === user.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(user.id)}
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
                          onClick={() => setDeleteConfirm(user.id)}
                          className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400
                                     hover:border-red-500/50 hover:text-red-400 transition-colors"
                        >
                          Supprimer
                        </button>
                      )}
                    </>
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
