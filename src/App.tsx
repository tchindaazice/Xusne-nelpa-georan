/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Server,
  Shield,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  Play,
  Square,
  Terminal,
  Settings,
  ExternalLink,
  Layers,
  Wifi,
  Cpu,
  Download,
  AlertCircle,
  CheckCircle2,
  Radio,
  Zap,
  Globe,
  Sliders,
  Smartphone,
  Monitor,
  Users,
  UserPlus,
  Trash2,
  Edit2,
  Clock,
  HardDrive,
  Eye,
  Power,
  RotateCcw,
  Search,
  Filter,
  X,
  ChevronDown,
  Info
} from 'lucide-react';

interface UserAccount {
  id: string;
  name: string;
  uuid: string;
  email: string;
  isEnabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  quotaBytes: number;
  usedBytes: number;
  maxIps: number;
  notes?: string;
  lastSeenAt: string | null;
  isOnline: boolean;
  activeConnectionsCount: number;
  activeIpsCount: number;
  activeIps: string[];
  isExpired: boolean;
  isQuotaExceeded: boolean;
  isMaxIpsReached: boolean;
  percentQuotaUsed: number;
  readableQuota: string;
  readableUsed: string;
}

interface ActiveSessionItem {
  id: string;
  userId: string | null;
  userName: string;
  userUuid: string | null;
  ip: string;
  connectedAt: string;
  uptimeSeconds: number;
  bytesUp: number;
  bytesDown: number;
  readableUpload: string;
  readableDownload: string;
}

interface SystemStatus {
  status: 'running' | 'stopped' | 'error' | 'starting';
  pid: number | null;
  uptimeSeconds: number;
  startedAt: string | null;
  version: string;
  dockerImage: string;
  tunnelPath: string;
  host: string;
  port: number;
  stats: {
    totalAccounts: number;
    onlineAccounts: number;
    activeSessions: number;
    totalHistoricalConnections: number;
    totalBandwidthUsed: string;
  };
}

interface UserConfigDetails {
  user: UserAccount;
  vlessUrl: string;
  qrCodeDataUrl: string;
  remark: string;
  formats: {
    clash: string;
    singbox: string;
    v2rayN: string;
  };
}

export default function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionItem[]>([]);
  const [logs, setLogs] = useState<{ timestamp: string; level: string; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'settings' | 'logs'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'expired' | 'quota'>('all');

  // Modals
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [viewingConfigs, setViewingConfigs] = useState<UserConfigDetails | null>(null);
  const [configSubTab, setConfigSubTab] = useState<'vless' | 'clash' | 'singbox' | 'v2rayn'>('vless');

  // User Form State
  const [formName, setFormName] = useState('');
  const [formUuid, setFormUuid] = useState('');
  const [formQuotaUnit, setFormQuotaUnit] = useState<'MO' | 'GO'>('GO');
  const [formQuotaValue, setFormQuotaValue] = useState<string>('5');
  const [formIsUnlimitedQuota, setFormIsUnlimitedQuota] = useState(false);
  const [formExpiryType, setFormExpiryType] = useState<'unlimited' | 'custom'>('unlimited');
  const [formExpiryDate, setFormExpiryDate] = useState<string>('');
  const [formMaxIps, setFormMaxIps] = useState<number>(0);
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Probe Test State
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    success: boolean;
    statusCode?: number;
    message?: string;
  } | null>(null);

  // Auto-scroll logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);

  // Helper copy
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Fetch functions
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    Promise.all([fetchStatus(), fetchUsers(), fetchSessions(), fetchLogs()]).finally(() => {
      setLoading(false);
    });

    const interval = setInterval(() => {
      fetchStatus();
      fetchUsers();
      fetchSessions();
      fetchLogs();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScrollLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScrollLogs]);

  // Generate random UUID
  const handleGenerateRandomUuid = async () => {
    try {
      const res = await fetch('/api/uuid/generate');
      const data = await res.json();
      setFormUuid(data.uuid);
    } catch (e) {
      console.error(e);
    }
  };

  // Open Create Modal
  const openCreateModal = () => {
    setEditingUserId(null);
    setFormName('');
    handleGenerateRandomUuid();
    setFormIsUnlimitedQuota(false);
    setFormQuotaUnit('GO');
    setFormQuotaValue('5');
    setFormExpiryType('unlimited');
    setFormExpiryDate('');
    setFormMaxIps(2);
    setFormNotes('');
    setFormError('');
    setIsUserModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (user: UserAccount) => {
    setEditingUserId(user.id);
    setFormName(user.name);
    setFormUuid(user.uuid);

    if (user.quotaBytes <= 0) {
      setFormIsUnlimitedQuota(true);
      setFormQuotaValue('5');
      setFormQuotaUnit('GO');
    } else {
      setFormIsUnlimitedQuota(false);
      const isGo = user.quotaBytes % (1024 * 1024 * 1024) === 0 || user.quotaBytes >= 1024 * 1024 * 1024;
      if (isGo) {
        setFormQuotaUnit('GO');
        setFormQuotaValue((user.quotaBytes / (1024 * 1024 * 1024)).toString());
      } else {
        setFormQuotaUnit('MO');
        setFormQuotaValue((user.quotaBytes / (1024 * 1024)).toString());
      }
    }

    if (user.expiresAt) {
      setFormExpiryType('custom');
      const d = new Date(user.expiresAt);
      const iso = d.toISOString().split('T')[0];
      setFormExpiryDate(iso);
    } else {
      setFormExpiryType('unlimited');
      setFormExpiryDate('');
    }

    setFormMaxIps(user.maxIps);
    setFormNotes(user.notes || '');
    setFormError('');
    setIsUserModalOpen(true);
  };

  // Save User (Create or Update)
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Le nom du compte est obligatoire.');
      return;
    }

    let calculatedQuotaBytes = 0;
    if (!formIsUnlimitedQuota) {
      const val = parseFloat(formQuotaValue);
      if (isNaN(val) || val <= 0) {
        setFormError('Veuillez spécifier un quota valide.');
        return;
      }
      calculatedQuotaBytes =
        formQuotaUnit === 'GO' ? Math.round(val * 1024 * 1024 * 1024) : Math.round(val * 1024 * 1024);
    }

    let finalExpiresAt: string | null = null;
    if (formExpiryType === 'custom') {
      if (!formExpiryDate) {
        setFormError("Veuillez sélectionner une date d'expiration.");
        return;
      }
      finalExpiresAt = new Date(formExpiryDate + 'T23:59:59.000Z').toISOString();
    }

    setFormSubmitting(true);
    setFormError('');

    try {
      const payload = {
        name: formName.trim(),
        uuid: formUuid.trim(),
        quotaBytes: calculatedQuotaBytes,
        expiresAt: finalExpiresAt,
        maxIps: Number(formMaxIps) || 0,
        notes: formNotes.trim(),
      };

      const url = editingUserId ? `/api/users/${editingUserId}` : '/api/users';
      const method = editingUserId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Une erreur est survenue lors de l'enregistrement.");
        setFormSubmitting(false);
        return;
      }

      setIsUserModalOpen(false);
      await fetchUsers();
      await fetchStatus();
    } catch (err: any) {
      setFormError(err.message || 'Erreur réseau');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Quick Expiry helper (+7d, +30d, +90d, +1y)
  const setQuickExpiry = (days: number) => {
    setFormExpiryType('custom');
    const d = new Date();
    d.setDate(d.getDate() + days);
    setFormExpiryDate(d.toISOString().split('T')[0]);
  };

  // Delete User
  const handleDeleteUser = async (user: UserAccount) => {
    if (!confirm(`Supprimer définitivement le compte "${user.name}" (${user.uuid}) ?`)) {
      return;
    }
    try {
      await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      await fetchUsers();
      await fetchStatus();
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle User Active
  const handleToggleUser = async (user: UserAccount) => {
    try {
      await fetch(`/api/users/${user.id}/toggle`, { method: 'POST' });
      await fetchUsers();
      await fetchStatus();
    } catch (e) {
      console.error(e);
    }
  };

  // Reset Traffic
  const handleResetTraffic = async (user: UserAccount) => {
    if (!confirm(`Remettre le compteur de consommation de "${user.name}" à 0 Mo ?`)) {
      return;
    }
    try {
      await fetch(`/api/users/${user.id}/reset-traffic`, { method: 'POST' });
      await fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  // View User Config & QR
  const handleViewConfigs = async (user: UserAccount) => {
    try {
      const res = await fetch(`/api/users/${user.id}/configs`);
      if (res.ok) {
        const data = await res.json();
        setViewingConfigs(data);
        setConfigSubTab('vless');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Disconnect active session
  const handleDisconnectSession = async (sessionId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/disconnect`, { method: 'POST' });
      await fetchSessions();
      await fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  // Probe test
  const handleTestProbe = async () => {
    setProbing(true);
    try {
      const res = await fetch('/api/test-probe', { method: 'POST' });
      const data = await res.json();
      setProbeResult(data);
    } catch (err: any) {
      setProbeResult({ success: false, message: err.message });
    } finally {
      setProbing(false);
    }
  };

  // Global control
  const handleControl = async (action: 'restart' | 'stop' | 'start') => {
    try {
      await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchStatus();
      await fetchLogs();
    } catch (e) {
      console.error(e);
    }
  };

  // Filtered Users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.uuid.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (statusFilter === 'online') return u.isOnline;
    if (statusFilter === 'offline') return !u.isOnline;
    if (statusFilter === 'expired') return u.isExpired;
    if (statusFilter === 'quota') return u.isQuotaExceeded;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 pb-20">
      {/* Background glow */}
      <div className="absolute top-0 inset-x-0 h-[450px] bg-gradient-to-b from-cyan-950/25 via-indigo-950/15 to-transparent pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Top Navbar */}
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800/80 gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 p-0.5 shadow-xl shadow-cyan-500/20">
              <div className="h-full w-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                <Radio className="h-6 w-6 text-cyan-400 animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Nexus Tunnel
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    Gestionnaire Multi-Comptes VLESS
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 font-mono">
                <Layers className="h-3 w-3 text-cyan-400" />
                Image Docker : <span className="text-cyan-300">docker.io/nextl/nexus-tunnel</span>
                <span className="text-slate-600">•</span>
                <span>Xray v26.9.9</span>
              </p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
              <span className="relative flex h-2.5 w-2.5">
                {status?.status === 'running' ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                )}
              </span>
              <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                {status?.status === 'running' ? 'Tunnel Actif' : status?.status || 'Arrêté'}
              </span>
            </div>

            <button
              onClick={() => handleControl('restart')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition active:scale-95"
              title="Redémarrer le moteur Xray"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recharger
            </button>

            <button
              onClick={handleTestProbe}
              disabled={probing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 transition active:scale-95 disabled:opacity-50"
            >
              <Zap className={`h-3.5 w-3.5 ${probing ? 'animate-bounce' : ''}`} />
              Test Sonde
            </button>

            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-lg shadow-cyan-500/25 transition active:scale-95"
            >
              <UserPlus className="h-4 w-4" />
              Nouveau Compte
            </button>
          </div>
        </header>

        {/* Global Statistics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6">
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Comptes Créés</span>
              <Users className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">
              {status?.stats?.totalAccounts ?? users.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Comptes VLESS configurés</div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Utilisateurs Connectés</span>
              <Activity className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight flex items-baseline gap-2">
              <span>{status?.stats?.onlineAccounts ?? 0}</span>
              <span className="text-xs text-slate-500 font-normal">
                / {users.length} compte(s)
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">En ligne en ce moment</div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Sessions WS Actives</span>
              <Wifi className="h-4 w-4 text-purple-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">
              {status?.stats?.activeSessions ?? sessions.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Appareils connectés simultanés
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Volume Total Échangé</span>
              <HardDrive className="h-4 w-4 text-blue-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-cyan-300 tracking-tight">
              {status?.stats?.totalBandwidthUsed || '0 Mo'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Données cumulées sur le tunnel</div>
          </div>
        </div>

        {/* Live Probe Feedback Banner */}
        {probeResult && (
          <div
            className={`mt-4 p-3.5 rounded-xl border flex items-center justify-between text-xs transition ${
              probeResult.success
                ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/70 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {probeResult.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
              )}
              <span>{probeResult.message}</span>
            </div>
            <button
              onClick={() => setProbeResult(null)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Main Tab Navigation */}
        <div className="flex items-center justify-between border-b border-slate-800 mt-8 pb-3 gap-4 flex-wrap">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                activeTab === 'users'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Users className="h-4 w-4" />
              Gestion des Comptes ({users.length})
            </button>

            <button
              onClick={() => setActiveTab('sessions')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                activeTab === 'sessions'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Wifi className="h-4 w-4" />
              Sessions en Direct ({sessions.length})
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                activeTab === 'settings'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Sliders className="h-4 w-4" />
              Paramètres Tunnel
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                activeTab === 'logs'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Terminal className="h-4 w-4" />
              Journal d'Activité
            </button>
          </div>

          {/* Search & Filter Bar (shown on users tab) */}
          {activeTab === 'users' && (
            <div className="flex items-center gap-2.5 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher nom ou UUID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="all">Tous les états</option>
                <option value="online">En ligne seulement</option>
                <option value="offline">Hors ligne</option>
                <option value="expired">Expirés</option>
                <option value="quota">Quota Dépassé</option>
              </select>
            </div>
          )}
        </div>

        {/* TAB 1: USERS LIST */}
        {activeTab === 'users' && (
          <div className="mt-6 space-y-4">
            {filteredUsers.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-12 text-center">
                <Users className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-300">Aucun compte trouvé</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {searchQuery || statusFilter !== 'all'
                    ? 'Aucun compte ne correspond à vos critères de recherche.'
                    : 'Commencez par créer votre premier compte VLESS personnalisé.'}
                </p>
                <button
                  onClick={openCreateModal}
                  className="mt-4 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition inline-flex items-center gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  Créer un compte
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className={`bg-slate-900/80 border rounded-2xl p-5 backdrop-blur transition shadow-lg ${
                      !user.isEnabled
                        ? 'border-slate-800/60 opacity-65'
                        : user.isExpired
                        ? 'border-rose-900/50 bg-rose-950/10'
                        : user.isQuotaExceeded
                        ? 'border-amber-900/50 bg-amber-950/10'
                        : user.isOnline
                        ? 'border-emerald-800/40 bg-slate-900/90'
                        : 'border-slate-800/80'
                    }`}
                  >
                    {/* Header of Card */}
                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800/80">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-white text-base">{user.name}</h3>

                          {/* Online / Offline status badge */}
                          {user.isOnline ? (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                              En Ligne ({user.activeIpsCount} IP{user.activeIpsCount > 1 ? 's' : ''})
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                              Hors ligne
                            </span>
                          )}

                          {!user.isEnabled && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              Désactivé
                            </span>
                          )}
                        </div>

                        {/* UUID with copy */}
                        <div className="flex items-center gap-1.5 mt-1 text-slate-400 text-xs font-mono">
                          <span className="truncate max-w-[220px]">{user.uuid}</span>
                          <button
                            onClick={() => handleCopy(user.uuid, `uuid-${user.id}`)}
                            className="text-slate-400 hover:text-cyan-300 p-0.5 transition"
                            title="Copier l'UUID"
                          >
                            {copiedKey === `uuid-${user.id}` ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Quick Switch Button (Active/Inactive) */}
                      <button
                        onClick={() => handleToggleUser(user)}
                        className={`p-2 rounded-xl transition border ${
                          user.isEnabled
                            ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400 hover:bg-emerald-900/60'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                        }`}
                        title={user.isEnabled ? 'Désactiver le compte' : 'Activer le compte'}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Quota Progress Bar */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-400 flex items-center gap-1 font-medium">
                          <HardDrive className="h-3.5 w-3.5 text-cyan-400" />
                          Quota de connexion :
                        </span>
                        <div className="font-mono text-xs">
                          <span className="font-semibold text-white">{user.readableUsed}</span>
                          <span className="text-slate-400"> / {user.readableQuota}</span>
                          {user.quotaBytes > 0 && (
                            <span
                              className={`ml-1.5 font-bold ${
                                user.percentQuotaUsed >= 100
                                  ? 'text-rose-400'
                                  : user.percentQuotaUsed >= 80
                                  ? 'text-amber-400'
                                  : 'text-cyan-400'
                              }`}
                            >
                              ({user.percentQuotaUsed}%)
                            </span>
                          )}
                        </div>
                      </div>

                      {user.quotaBytes > 0 ? (
                        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div
                            className={`h-full transition-all duration-500 ${
                              user.percentQuotaUsed >= 100
                                ? 'bg-rose-500'
                                : user.percentQuotaUsed >= 80
                                ? 'bg-amber-500'
                                : 'bg-gradient-to-r from-cyan-500 to-blue-500'
                            }`}
                            style={{ width: `${user.percentQuotaUsed}%` }}
                          />
                        </div>
                      ) : (
                        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div className="h-full bg-cyan-500/40 w-full" />
                        </div>
                      )}
                    </div>

                    {/* Expiration & IP Limits Badges */}
                    <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                      {/* Expiration Badge */}
                      <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">
                          Expiration
                        </span>
                        <div className="mt-0.5 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {user.expiresAt ? (
                            <span
                              className={`font-semibold ${
                                user.isExpired ? 'text-rose-400 font-bold' : 'text-slate-200'
                              }`}
                            >
                              {user.isExpired
                                ? 'Expiré'
                                : new Date(user.expiresAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-cyan-400 font-medium">Illimité (Jamais)</span>
                          )}
                        </div>
                      </div>

                      {/* Simultaneous IP Limit Badge */}
                      <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">
                          Limite d'Appareils / IP
                        </span>
                        <div className="mt-0.5 flex items-center gap-1">
                          <Smartphone className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-semibold text-slate-200">
                            {user.maxIps > 0 ? (
                              <>
                                <span className={user.activeIpsCount >= user.maxIps ? 'text-amber-400' : ''}>
                                  {user.activeIpsCount}
                                </span>
                                /{user.maxIps} IP max
                              </>
                            ) : (
                              <span className="text-cyan-400 font-medium">Illimité</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Active IPs list if online */}
                    {user.isOnline && user.activeIps.length > 0 && (
                      <div className="mt-3 p-2 bg-slate-950/80 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 flex items-center gap-2">
                        <Wifi className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="text-slate-500">IPs connectées :</span>
                        <span className="text-emerald-300 font-semibold truncate">
                          {user.activeIps.join(', ')}
                        </span>
                      </div>
                    )}

                    {/* Card Actions Footer */}
                    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-800/80">
                      <button
                        onClick={() => handleViewConfigs(user)}
                        className="flex-1 py-1.5 px-3 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        Connexion & QR Code
                      </button>

                      <button
                        onClick={() => handleResetTraffic(user)}
                        className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition"
                        title="Remettre le quota à zéro"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>

                      <button
                        onClick={() => openEditModal(user)}
                        className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition"
                        title="Modifier le compte"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>

                      <button
                        onClick={() => handleDeleteUser(user)}
                        className="p-2 rounded-xl bg-slate-950 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-800 transition"
                        title="Supprimer ce compte"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ACTIVE SESSIONS */}
        {activeTab === 'sessions' && (
          <div className="mt-6 space-y-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur shadow-xl">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-emerald-400" />
                    Connexions WebSocket en temps réel ({sessions.length})
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Surveillance en direct des sessions VLESS actives sur le port WebSocket 443
                  </p>
                </div>

                <button
                  onClick={fetchSessions}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700"
                >
                  <RefreshCw className="h-3 w-3" />
                  Actualiser
                </button>
              </div>

              {sessions.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  <Radio className="h-8 w-8 text-slate-600 mx-auto mb-2 opacity-60" />
                  Aucune session active pour le moment. Connectez un client VLESS pour le voir apparaître ici.
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                        <th className="pb-3 pl-2">Utilisateur</th>
                        <th className="pb-3">Adresse IP Distante</th>
                        <th className="pb-3">Durée</th>
                        <th className="pb-3">Upload / Download</th>
                        <th className="pb-3 text-right pr-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {sessions.map((sess) => (
                        <tr key={sess.id} className="hover:bg-slate-800/30 transition">
                          <td className="py-3 pl-2 font-sans font-semibold text-white flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            {sess.userName}
                          </td>
                          <td className="py-3 text-cyan-300">{sess.ip}</td>
                          <td className="py-3 text-slate-400">{sess.uptimeSeconds}s</td>
                          <td className="py-3 text-slate-300">
                            ↑ {sess.readableUpload} / ↓ {sess.readableDownload}
                          </td>
                          <td className="py-3 text-right pr-2">
                            <button
                              onClick={() => handleDisconnectSession(sess.id)}
                              className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800 text-[11px] font-sans font-medium transition"
                            >
                              Déconnecter
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SETTINGS & DOCKER DEPLOYMENTS */}
        {activeTab === 'settings' && (
          <div className="mt-6 space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur shadow-xl">
              <h2 className="text-base font-semibold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
                <Sliders className="h-4 w-4 text-cyan-400" />
                Configuration Globale du Tunnel
              </h2>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 text-xs block mb-1">Image Docker Source</span>
                  <span className="text-cyan-300 font-mono text-sm font-semibold">
                    docker.io/nextl/nexus-tunnel:latest
                  </span>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Image conteneur Alpine avec noyau Xray v26.9.9 et listes GeoIP / GeoSite.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 text-xs block mb-1">Chemin d'écoute WebSocket</span>
                  <span className="text-white font-mono text-sm font-semibold">
                    {status?.tunnelPath || '/nexustunnel'}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Acheminé via proxy TLS HTTPS 443 vers le serveur Xray interne.
                  </p>
                </div>
              </div>

              {/* Docker Deploy commands for external servers */}
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Commande Docker Run pour déployer sur un VPS externe :
                </h3>
                <div className="relative">
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-cyan-300 overflow-x-auto whitespace-pre-wrap">
                    {`docker run -d \\
  --name nexus-tunnel \\
  --restart always \\
  -p 8080:8080 \\
  -e PORT=8080 \\
  docker.io/nextl/nexus-tunnel:latest`}
                  </pre>
                  <button
                    onClick={() =>
                      handleCopy(
                        `docker run -d --name nexus-tunnel --restart always -p 8080:8080 -e PORT=8080 docker.io/nextl/nexus-tunnel:latest`,
                        'copy-docker-run'
                      )
                    }
                    className="absolute top-2.5 right-2.5 text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-slate-900/90 px-2 py-1 rounded border border-slate-800"
                  >
                    {copiedKey === 'copy-docker-run' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    Copier
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: REAL-TIME LOGS */}
        {activeTab === 'logs' && (
          <div className="mt-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur shadow-xl flex flex-col h-[550px]">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  Journal d'Audit et Logs en Direct ({logs.length})
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAutoScrollLogs(!autoScrollLogs)}
                    className={`text-[10px] px-2.5 py-1 rounded-lg border transition ${
                      autoScrollLogs
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {autoScrollLogs ? 'Auto-scroll Actif' : 'Pause'}
                  </button>
                  <button
                    onClick={fetchLogs}
                    className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg bg-slate-800 border border-slate-700"
                    title="Actualiser les logs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3.5 overflow-y-auto font-mono text-[11px] space-y-1.5 text-slate-300">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic">Aucun log enregistré pour le moment...</div>
                ) : (
                  logs.map((l, idx) => (
                    <div key={idx} className="leading-relaxed break-all">
                      <span className="text-slate-600 mr-2">
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={`font-semibold mr-2 uppercase text-[10px] px-1 rounded ${
                          l.level === 'error'
                            ? 'bg-rose-950 text-rose-400 border border-rose-800'
                            : l.level === 'warn'
                            ? 'bg-amber-950 text-amber-400 border border-amber-800'
                            : 'bg-slate-800 text-cyan-400'
                        }`}
                      >
                        {l.level}
                      </span>
                      <span>{l.message}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: CREATE / EDIT USER ACCOUNT */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsUserModalOpen(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-cyan-400" />
              {editingUserId ? 'Modifier le Compte VLESS' : 'Créer un Nouveau Compte VLESS'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configurez le nom, l'UUID personnalisé, le quota (Mo/Go), l'expiration et la limite d'IP.
            </p>

            {formError && (
              <div className="mt-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="mt-5 space-y-4">
              {/* Nom / Libellé */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Nom ou Identifiant du Compte *
                </label>
                <input
                  type="text"
                  placeholder="ex: Azice, Bureau, Famille, Client-01"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* UUID Personnalisé ou Aléatoire */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    UUID VLESS Personnalisé *
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateRandomUuid}
                    className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1 font-medium"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Générer Aléatoirement
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
                  value={formUuid}
                  onChange={(e) => setFormUuid(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Quota de Connexion (Mo ou Go) */}
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5 text-cyan-400" />
                    Quota de Données
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formIsUnlimitedQuota}
                      onChange={(e) => setFormIsUnlimitedQuota(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <span>Illimité</span>
                  </label>
                </div>

                {!formIsUnlimitedQuota && (
                  <div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={formQuotaValue}
                        onChange={(e) => setFormQuotaValue(e.target.value)}
                        placeholder="Ex: 5"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                      />
                      <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-0.5">
                        <button
                          type="button"
                          onClick={() => setFormQuotaUnit('MO')}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                            formQuotaUnit === 'MO' ? 'bg-cyan-600 text-white' : 'text-slate-400'
                          }`}
                        >
                          Mo
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormQuotaUnit('GO')}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                            formQuotaUnit === 'GO' ? 'bg-cyan-600 text-white' : 'text-slate-400'
                          }`}
                        >
                          Go
                        </button>
                      </div>
                    </div>

                    {/* Pre-set Quick buttons */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['500 Mo', '1 Go', '2 Go', '5 Go', '10 Go', '50 Go', '100 Go'].map((item) => {
                        const [val, unit] = item.split(' ');
                        return (
                          <button
                            key={item}
                            type="button"
                            onClick={() => {
                              setFormQuotaValue(val);
                              setFormQuotaUnit(unit.toUpperCase() as 'MO' | 'GO');
                              setFormIsUnlimitedQuota(false);
                            }}
                            className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300"
                          >
                            {item}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Date d'expiration */}
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    Date d'Expiration
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="expiry"
                        checked={formExpiryType === 'unlimited'}
                        onChange={() => setFormExpiryType('unlimited')}
                        className="text-cyan-500"
                      />
                      <span>Jamais (Illimité)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="expiry"
                        checked={formExpiryType === 'custom'}
                        onChange={() => setFormExpiryType('custom')}
                        className="text-cyan-500"
                      />
                      <span>Date précise</span>
                    </label>
                  </div>
                </div>

                {formExpiryType === 'custom' && (
                  <div>
                    <input
                      type="date"
                      value={formExpiryDate}
                      onChange={(e) => setFormExpiryDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                    {/* Quick expiry presets */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => setQuickExpiry(7)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                      >
                        +7 Jours
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickExpiry(30)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                      >
                        +30 Jours
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickExpiry(90)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                      >
                        +90 Jours
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickExpiry(365)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                      >
                        +1 An
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Limite d'IPs simultanées */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Limite d'IPs / Appareils Connectés Simultanés
                </label>
                <select
                  value={formMaxIps}
                  onChange={(e) => setFormMaxIps(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value={0}>Illimité (Toutes les connexions acceptées)</option>
                  <option value={1}>1 Appareil / IP simultanée (Strict)</option>
                  <option value={2}>2 Appareils / IPs simultanées</option>
                  <option value={3}>3 Appareils / IPs simultanées</option>
                  <option value={5}>5 Appareils / IPs simultanées</option>
                  <option value={10}>10 Appareils / IPs simultanées</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Si un utilisateur tente de se connecter avec un appareil supplémentaire dépassant cette limite, la connexion sera automatiquement bloquée.
                </span>
              </div>

              {/* Notes optionnelles */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Notes ou Remarques (Optionnel)
                </label>
                <input
                  type="text"
                  placeholder="ex: Abonnement mensuel, ami, téléphone pro..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
                >
                  {formSubmitting
                    ? 'Enregistrement...'
                    : editingUserId
                    ? 'Mettre à jour'
                    : 'Créer le Compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VIEW CONFIG & QR CODE */}
      {viewingConfigs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setViewingConfigs(null)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Configuration Client : {viewingConfigs.user.name}
                </h2>
                <p className="text-xs text-slate-400">
                  Scannez le QR Code ou copiez la configuration pour importer directement dans votre client.
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
              {/* QR Code */}
              <div className="sm:col-span-5 flex flex-col items-center justify-center p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <div className="p-2.5 bg-white rounded-xl shadow-lg">
                  <img
                    src={viewingConfigs.qrCodeDataUrl}
                    alt="VLESS QR Code"
                    className="w-44 h-44 object-contain"
                  />
                </div>
                <span className="text-[11px] text-slate-400 mt-2 font-mono">
                  v2rayNG / Shadowrocket
                </span>
              </div>

              {/* Summary */}
              <div className="sm:col-span-7 space-y-3">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Protocole :</span>
                    <span className="font-semibold text-white">VLESS + WebSocket + TLS</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">UUID Client :</span>
                    <span className="font-mono text-cyan-300 truncate max-w-[170px]">
                      {viewingConfigs.user.uuid}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Quota :</span>
                    <span className="font-semibold text-white">
                      {viewingConfigs.user.readableQuota}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Expiration :</span>
                    <span className="font-semibold text-white">
                      {viewingConfigs.user.expiresAt
                        ? new Date(viewingConfigs.user.expiresAt).toLocaleDateString()
                        : 'Illimité'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Limite Appareils :</span>
                    <span className="font-semibold text-white">
                      {viewingConfigs.user.maxIps > 0
                        ? `${viewingConfigs.user.maxIps} IP simultanées`
                        : 'Illimité'}
                    </span>
                  </div>
                </div>

                {/* Direct VLESS URI */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-medium">Lien direct VLESS URI :</span>
                    <button
                      onClick={() => handleCopy(viewingConfigs.vlessUrl, 'modal-vless-url')}
                      className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1"
                    >
                      {copiedKey === 'modal-vless-url' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" /> Copié !
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copier le lien
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={2}
                    value={viewingConfigs.vlessUrl}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-[11px] font-mono text-cyan-300 resize-none break-all"
                  />
                </div>
              </div>
            </div>

            {/* Other Config Formats (Clash, Singbox, v2rayN) */}
            <div className="mt-5 border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfigSubTab('vless')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      configSubTab === 'vless'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    VLESS URI
                  </button>
                  <button
                    onClick={() => setConfigSubTab('clash')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      configSubTab === 'clash'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    Clash Meta (YAML)
                  </button>
                  <button
                    onClick={() => setConfigSubTab('singbox')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      configSubTab === 'singbox'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    Sing-box (JSON)
                  </button>
                  <button
                    onClick={() => setConfigSubTab('v2rayn')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      configSubTab === 'v2rayn'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    v2rayN
                  </button>
                </div>

                <button
                  onClick={() => {
                    const str =
                      configSubTab === 'vless'
                        ? viewingConfigs.vlessUrl
                        : configSubTab === 'clash'
                        ? viewingConfigs.formats.clash
                        : configSubTab === 'singbox'
                        ? viewingConfigs.formats.singbox
                        : viewingConfigs.formats.v2rayN;
                    handleCopy(str, 'subtab-copy');
                  }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  {copiedKey === 'subtab-copy' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" /> Copié !
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copier
                    </>
                  )}
                </button>
              </div>

              <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-cyan-300 overflow-x-auto whitespace-pre-wrap max-h-48">
                {configSubTab === 'vless' && viewingConfigs.vlessUrl}
                {configSubTab === 'clash' && viewingConfigs.formats.clash}
                {configSubTab === 'singbox' && viewingConfigs.formats.singbox}
                {configSubTab === 'v2rayn' && viewingConfigs.formats.v2rayN}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
