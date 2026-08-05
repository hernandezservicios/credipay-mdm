import React, { useCallback, useEffect, useState } from 'react';
import {
  Users as UsersIcon,
  RefreshCw,
  UserPlus,
  Search,
  Loader2,
  KeyRound,
  Trash2,
  ShieldCheck,
  Pencil,
  X as XIcon,
} from 'lucide-react';
import {
  apiCreateUser,
  apiDeleteUser,
  apiListUsers,
  apiResetUserPassword,
  apiSetUserStatus,
  apiUpdateUser,
  errorMessage,
  type PlatformTenantRow,
  type PlatformUserRow,
} from '../services/api';
import { useConfirm } from './ConfirmDialog';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800',
  PENDING: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800',
  INACTIVE: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  SUSPENDED: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-800',
};

interface UsersViewProps {
  tenants: PlatformTenantRow[];
  onNotify: (text: string, type?: 'INFO' | 'LOCK') => void;
}

interface UserFormState {
  open: boolean;
  editing: PlatformUserRow | null;
  name: string;
  email: string;
  phone: string;
  tenantId: string;
  roles: string;
  password: string;
  status: string;
}

const EMPTY_FORM: UserFormState = {
  open: false,
  editing: null,
  name: '',
  email: '',
  phone: '',
  tenantId: '',
  roles: 'OPERADOR',
  password: '',
  status: 'ACTIVE',
};

export const UsersView: React.FC<UsersViewProps> = ({ tenants, onNotify }) => {
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [busyId, setBusyId] = useState<number | null>(null);
  const confirm = useConfirm();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiListUsers({
        tenant_id: tenantFilter ? Number(tenantFilter) : undefined,
        q: search || undefined,
      });
      setUsers(res.data);
    } catch (err) {
      onNotify(`❌ No se pudieron cargar los usuarios: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setLoading(false);
    }
  }, [tenantFilter, search, onNotify]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [reload]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, tenantId: tenantFilter || '', open: true });
  };

  const openEdit = (u: PlatformUserRow) => {
    setForm({
      open: true,
      editing: u,
      name: u.name,
      email: u.email,
      phone: u.phone ?? '',
      tenantId: u.tenant_id != null ? String(u.tenant_id) : '',
      roles: u.role_slugs ?? 'OPERADOR',
      password: '',
      status: u.status,
    });
  };

  const closeForm = () => setForm((f) => ({ ...f, open: false }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId(-1);
    try {
      if (form.editing) {
        const roles = form.roles
          .split(',')
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean);
        await apiUpdateUser(form.editing.id, {
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          status: form.status,
          roles,
        });
        onNotify(`✅ Usuario "${form.name}" actualizado.`);
      } else {
        const roles = form.roles
          .split(',')
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean);
        const res = await apiCreateUser({
          tenant_id: form.tenantId ? Number(form.tenantId) : undefined,
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          password: form.password || undefined,
          roles,
          status: form.status,
        });
        if (res.dev_password) {
          onNotify(`✅ Usuario creado. Contraseña dev: ${res.dev_password}`);
        } else {
          onNotify(`✅ Usuario "${res.data.name}" creado.`);
        }
      }
      closeForm();
      void reload();
    } catch (err) {
      onNotify(`❌ ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const handleStatus = async (u: PlatformUserRow) => {
    const next =
      u.status === 'ACTIVE' ? 'INACTIVE' : u.status === 'INACTIVE' ? 'ACTIVE' : 'ACTIVE';
    const ok = await confirm({
      title: `Cambiar estado de "${u.name}"`,
      message: `¿Mover a ${next}? Sus sesiones activas se cerrarán si no está ACTIVO.`,
      tone: next === 'ACTIVE' ? 'emerald' : 'amber',
      confirmLabel: next === 'ACTIVE' ? 'Activar' : 'Desactivar',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await apiSetUserStatus(u.id, next);
      onNotify(`✅ Estado de "${u.name}" → ${next}.`);
      void reload();
    } catch (err) {
      onNotify(`❌ ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspend = async (u: PlatformUserRow) => {
    const ok = await confirm({
      title: `Suspender a "${u.name}"`,
      message: 'El usuario perderá el acceso inmediatamente y sus sesiones se cerrarán.',
      tone: 'rose',
      confirmLabel: 'Suspender',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await apiSetUserStatus(u.id, 'SUSPENDED');
      onNotify(`✅ Usuario "${u.name}" suspendido.`);
      void reload();
    } catch (err) {
      onNotify(`❌ ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (u: PlatformUserRow) => {
    const ok = await confirm({
      title: `Restablecer contraseña de "${u.name}"`,
      message: 'Se generará un enlace de restablecimiento y se exigirá cambio en el próximo inicio de sesión.',
      tone: 'indigo',
      confirmLabel: 'Restablecer',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      const res = await apiResetUserPassword(u.id);
      onNotify(
        res.dev_reset_link
          ? `✅ Enlace generado (dev): ${res.dev_reset_link}`
          : `✅ Contraseña de "${u.name}" restablecida.`
      );
    } catch (err) {
      onNotify(`❌ ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u: PlatformUserRow) => {
    const ok = await confirm({
      title: `Eliminar a "${u.name}"`,
      message: 'Se eliminará de forma lógica (soft delete) y se cerrarán sus sesiones. Esta acción es reversible a nivel BD.',
      tone: 'rose',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await apiDeleteUser(u.id);
      onNotify(`🗑️ Usuario "${u.name}" eliminado.`);
      void reload();
    } catch (err) {
      onNotify(`❌ ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Usuarios de la Plataforma</h2>
          <p className="text-xs text-slate-400">
            Super Administradores globales y usuarios de cada empresa
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => void reload()}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>
          <button
            onClick={openCreate}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Crear usuario</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o correo..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Todas las empresas</option>
          <option value="global">Solo Super Admins (globales)</option>
          {tenants.map((t) => (
            <option key={t.tenant_id} value={String(t.tenant_id)}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
          Cargando usuarios...
        </div>
      ) : users.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
          No hay usuarios que coincidan con el filtro.
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3 font-bold">Usuario</th>
                  <th className="px-5 py-3 font-bold">Empresa</th>
                  <th className="px-5 py-3 font-bold">Roles</th>
                  <th className="px-5 py-3 font-bold">Estado</th>
                  <th className="px-5 py-3 font-bold">Último acceso</th>
                  <th className="px-5 py-3 font-bold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-300 flex items-center justify-center shrink-0">
                          <UsersIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{u.name}</div>
                          <div className="text-[10px] text-slate-500 truncate">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-300">
                      {u.tenant_id == null ? (
                        <span className="flex items-center space-x-1">
                          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="font-bold text-indigo-300">Plataforma (global)</span>
                        </span>
                      ) : (
                        u.tenant_name ?? `Empresa #${u.tenant_id}`
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(u.role_slugs ?? '')
                          .split(',')
                          .filter(Boolean)
                          .map((r) => (
                            <span
                              key={r}
                              className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-slate-300 border border-slate-700"
                            >
                              {r}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[u.status] ?? ''}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('es-DO') : 'Nunca'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleStatus(u)}
                          disabled={busyId === u.id}
                          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
                          title={u.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}
                        >
                          {busyId === u.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => void handleSuspend(u)}
                          className="p-1.5 rounded-lg bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 transition-colors"
                          title="Suspender"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleResetPassword(u)}
                          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                          title="Restablecer contraseña"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleDelete(u)}
                          className="p-1.5 rounded-lg bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form.open && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="bg-slate-900 px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
                <UsersIcon className="w-4 h-4 text-indigo-300" />
                <span>{form.editing ? `Editar "${form.editing.name}"` : 'Crear usuario'}</span>
              </h3>
              <button onClick={closeForm} className="text-slate-400 hover:text-white transition-colors" aria-label="Cerrar">
                <XIcon />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Nombre *
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Correo *
                </label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Teléfono
                  </label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Estado
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PENDING">PENDING</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Empresa (vacío = Super Admin global)
                </label>
                <select
                  value={form.tenantId}
                  onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
                  disabled={!!form.editing}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">Plataforma (SUPER_ADMIN)</option>
                  {tenants.map((t) => (
                    <option key={t.tenant_id} value={String(t.tenant_id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Roles (separados por coma)
                </label>
                <input
                  value={form.roles}
                  onChange={(e) => setForm((f) => ({ ...f, roles: e.target.value }))}
                  placeholder="ADMIN,GESTOR"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {!form.editing && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Contraseña inicial (mín. 8; vacío = genera)
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busyId === -1}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-900/20 transition-colors disabled:opacity-60 flex items-center space-x-2"
                >
                  {busyId === -1 && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{form.editing ? 'Guardar' : 'Crear usuario'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
