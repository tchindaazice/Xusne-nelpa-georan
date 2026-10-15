import express from 'express';
import http from 'http';
import httpProxy from 'http-proxy';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import {
  loadUsers,
  saveUsers,
  getUsersWithStats,
  getUserById,
  getUserByUuid,
  getUserByToken,
  generateUuidV4,
  generateActivationToken,
  generateClientConfigs,
  activeSessions,
  addTrafficToUser,
  parseVlessUuidFromWsFrame,
  isUserExpired,
  isUserQuotaExceeded,
  getActiveIpsForUser,
  formatBytes,
  UserAccount,
  ActiveSession,
} from './server/userManager.ts';
import {
  loadMembershipRequests,
  findRequestByDeviceOrContact,
  addOrUpdateRequest,
  approveRequest,
  rejectRequest,
  deleteRequest,
  MembershipRequest,
} from './server/membershipManager.ts';
import { ensureXrayBinary } from './server/ensureXray.ts';

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const XRAY_BIN = path.resolve(process.cwd(), 'bin', 'xray');
const XRAY_CONFIG_PATH = path.resolve(process.cwd(), 'xray_config.json');
const XRAY_DATA_DIR = path.resolve(process.cwd(), 'xray_data');

// Enable CORS for all routes (essential for the Android APK and external clients)
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Proxy for WebSocket upgrade to Xray internal port
const XRAY_INTERNAL_PORT = 10086;
const proxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${XRAY_INTERNAL_PORT}`,
  ws: true,
});

proxy.on('error', (err, _req, socket) => {
  console.error('[Nexus Proxy Error]:', err.message);
  try {
    if (socket && !socket.destroyed && 'end' in socket) {
      (socket as any).end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  } catch (e) {
    // ignore
  }
});

let tunnelWsPath = '/nexustunnel';
let xrayProcess: ChildProcess | null = null;
let xrayStatus: 'running' | 'stopped' | 'error' | 'starting' = 'stopped';
let xrayStartedAt: Date | null = null;
let xrayLastError = '';
const logBuffer: { timestamp: string; level: string; message: string }[] = [];
let totalHistoricalWsConnections = 0;

function addLog(level: string, message: string) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message: message.trim(),
  };
  logBuffer.push(line);
  if (logBuffer.length > 500) {
    logBuffer.shift();
  }
  console.log(`[Xray ${level.toUpperCase()}] ${line.message}`);
}

function writeXrayConfigFile() {
  const users = loadUsers();
  const activeClients = users
    .filter((u) => u.isEnabled && !isUserExpired(u) && !isUserQuotaExceeded(u))
    .map((u) => ({
      id: u.uuid,
      email: u.email || `${u.id}@nexus`,
      level: 0,
    }));

  if (activeClients.length === 0) {
    activeClients.push({
      id: 'e3a478b2-5e1b-4cf7-8b09-1a2b3c4d5e6f',
      email: 'nexus-default@root',
      level: 0,
    });
  }

  const fileContent = {
    log: {
      loglevel: 'warning',
    },
    inbounds: [
      {
        listen: '127.0.0.1',
        port: XRAY_INTERNAL_PORT,
        protocol: 'vless',
        settings: {
          clients: activeClients,
          decryption: 'none',
        },
        streamSettings: {
          network: 'ws',
          wsSettings: {
            path: tunnelWsPath,
          },
        },
      },
    ],
    outbounds: [
      {
        protocol: 'freedom',
      },
    ],
  };

  fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(fileContent, null, 2), 'utf-8');
}

function startXrayProcess() {
  if (xrayProcess && !xrayProcess.killed) {
    return;
  }

  ensureXrayBinary();

  if (!fs.existsSync(XRAY_BIN)) {
    xrayStatus = 'error';
    xrayLastError = `Binaire Xray introuvable dans ${XRAY_BIN}`;
    addLog('error', xrayLastError);
    return;
  }

  writeXrayConfigFile();

  xrayStatus = 'starting';
  const users = loadUsers();
  addLog(
    'info',
    `Démarrage du noyau Xray (v26.9.9) avec ${users.length} compte(s) configuré(s) sur le chemin ${tunnelWsPath}...`
  );

  try {
    xrayProcess = spawn(XRAY_BIN, ['run', '-config', XRAY_CONFIG_PATH], {
      env: {
        ...process.env,
        XRAY_LOCATION_ASSET: XRAY_DATA_DIR,
      },
    });

    xrayStartedAt = new Date();
    xrayStatus = 'running';
    xrayLastError = '';

    xrayProcess.stdout?.on('data', (data) => {
      addLog('info', data.toString());
    });

    xrayProcess.stderr?.on('data', (data) => {
      addLog('warn', data.toString());
    });

    xrayProcess.on('error', (err) => {
      xrayStatus = 'error';
      xrayLastError = err.message;
      addLog('error', `Erreur processus Xray: ${err.message}`);
    });

    xrayProcess.on('exit', (code, signal) => {
      addLog('info', `Processus Xray arrêté (code=${code}, signal=${signal})`);
      if (xrayStatus === 'running' || xrayStatus === 'starting') {
        xrayStatus = 'stopped';
      }
      xrayProcess = null;
    });
  } catch (err: any) {
    xrayStatus = 'error';
    xrayLastError = err.message;
    addLog('error', `Échec d'exécution Xray: ${err.message}`);
  }
}

function stopXrayProcess(): Promise<void> {
  return new Promise((resolve) => {
    if (!xrayProcess || xrayProcess.killed) {
      xrayStatus = 'stopped';
      xrayProcess = null;
      resolve();
      return;
    }

    xrayStatus = 'stopped';
    addLog('info', 'Arrêt du serveur Xray...');
    xrayProcess.kill('SIGTERM');

    const timeout = setTimeout(() => {
      if (xrayProcess && !xrayProcess.killed) {
        xrayProcess.kill('SIGKILL');
      }
      xrayProcess = null;
      resolve();
    }, 2000);

    xrayProcess.on('exit', () => {
      clearTimeout(timeout);
      xrayProcess = null;
      resolve();
    });
  });
}

async function reloadXray() {
  await stopXrayProcess();
  startXrayProcess();
}

// Start initially
startXrayProcess();

// Helper for host extraction
function getHostname(req: express.Request): string {
  const forwardedHost = req.headers['x-forwarded-host'] as string;
  if (forwardedHost) return forwardedHost.split(',')[0].trim();
  const host = req.headers['host'] as string;
  if (host) return host.split(':')[0];
  return process.env.APP_URL ? new URL(process.env.APP_URL).hostname : 'localhost';
}

// WebSocket Upgrade Handling with User Resolution & Traffic Counting
server.on('upgrade', (req, clientSocket: any, head) => {
  const url = req.url || '';
  if (!url.startsWith(tunnelWsPath)) {
    clientSocket.destroy();
    return;
  }

  totalHistoricalWsConnections++;
  const clientIp =
    ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()) ||
    clientSocket.remoteAddress ||
    '127.0.0.1';

  const sessionId = 'sess_' + Math.random().toString(36).substring(2, 9);
  const session: ActiveSession = {
    id: sessionId,
    userId: null,
    userUuid: null,
    userName: null,
    ip: clientIp,
    connectedAt: new Date(),
    bytesUp: 0,
    bytesDown: 0,
    clientSocket,
    proxySocket: null,
  };

  activeSessions.set(sessionId, session);

  let firstFrameHandled = false;

  clientSocket.on('data', (chunk: Buffer) => {
    session.bytesUp += chunk.length;

    if (!firstFrameHandled) {
      firstFrameHandled = true;
      const extractedUuid = parseVlessUuidFromWsFrame(chunk);
      if (extractedUuid) {
        session.userUuid = extractedUuid;
        const user = getUserByUuid(extractedUuid);
        if (user) {
          session.userId = user.id;
          session.userName = user.name;

          if (!user.isEnabled) {
            addLog(
              'warn',
              `[Connexion Refusée] Le compte "${user.name}" (${user.uuid}) est désactivé.`
            );
            clientSocket.destroy();
            return;
          }

          if (isUserExpired(user)) {
            addLog(
              'warn',
              `[Connexion Refusée] Le compte "${user.name}" a expiré le ${new Date(
                user.expiresAt!
              ).toLocaleDateString()}.`
            );
            clientSocket.destroy();
            return;
          }

          if (isUserQuotaExceeded(user)) {
            addLog(
              'warn',
              `[Connexion Refusée] Quota dépassé pour "${user.name}" (${formatBytes(
                user.usedBytes
              )} / ${formatBytes(user.quotaBytes)}).`
            );
            clientSocket.destroy();
            return;
          }

          if (user.maxIps > 0) {
            const currentActiveIps = getActiveIpsForUser(user.id);
            if (currentActiveIps.length > user.maxIps && !currentActiveIps.includes(clientIp)) {
              addLog(
                'warn',
                `[Connexion Refusée] Limite d'IPs simultanées atteinte (${currentActiveIps.length}/${user.maxIps} IP) pour "${user.name}" depuis ${clientIp}.`
              );
              clientSocket.destroy();
              return;
            }
          }

          addLog(
            'info',
            `[Connexion VLESS] Utilisateur "${user.name}" connecté depuis ${clientIp} (Session #${sessionId})`
          );
        } else {
          addLog('warn', `[Connexion Non Reconnue] UUID ${extractedUuid} inconnu.`);
        }
      }
    }

    if (session.userId) {
      addTrafficToUser(session.userId, chunk.length);
      const user = getUserById(session.userId);
      if (user && isUserQuotaExceeded(user)) {
        addLog('warn', `[Quota Atteint en cours de session] Déconnexion immédiate de "${user.name}".`);
        clientSocket.destroy();
      }
    }
  });

  const cleanup = () => {
    if (activeSessions.has(sessionId)) {
      if (session.userName) {
        addLog(
          'info',
          `[Déconnexion] Session #${sessionId} terminée pour "${session.userName}" (Durée: ${Math.round(
            (Date.now() - session.connectedAt.getTime()) / 1000
          )}s, Upload: ${formatBytes(session.bytesUp)}, Download: ${formatBytes(session.bytesDown)})`
        );
      }
      activeSessions.delete(sessionId);
    }
  };

  clientSocket.on('close', cleanup);
  clientSocket.on('error', cleanup);

  proxy.ws(
    req,
    clientSocket,
    head,
    {
      target: `http://127.0.0.1:${XRAY_INTERNAL_PORT}`,
    },
    (err) => {
      if (err) {
        addLog('error', `Erreur WebSocket proxy: ${err.message}`);
        cleanup();
      }
    }
  );
});

// Proxy downlink data interception
proxy.on('open', (proxySocket: any) => {
  proxySocket.on('data', (chunk: Buffer) => {
    for (const session of activeSessions.values()) {
      if (!session.proxySocket) {
        session.proxySocket = proxySocket;
      }
      if (session.proxySocket === proxySocket) {
        session.bytesDown += chunk.length;
        if (session.userId) {
          addTrafficToUser(session.userId, chunk.length);
        }
        break;
      }
    }
  });
});

// Direct HTTP probe on WS path
app.get(tunnelWsPath, (_req, res) => {
  const users = loadUsers();
  res.json({
    status: 'ok',
    service: 'Nexus Tunnel Multi-Account Manager',
    dockerImage: 'docker.io/nextl/nexus-tunnel',
    totalAccounts: users.length,
    activeSessions: activeSessions.size,
    message: 'Le tunnel VLESS WebSocket est actif et opérationnel.',
  });
});

// ==========================================
// ANDROID APK INTEGRATION ENDPOINTS (tchindaazice/App)
// ==========================================

// 1. Submit Membership Request from Android APK
app.post(['/api/membership/request', '/api/membership/requests'], (req, res) => {
  const {
    fullName,
    country,
    countryCode,
    channel,
    contactDetail,
    deviceId,
    deviceModel,
    androidVersion,
    timestamp,
  } = req.body;

  if (!fullName || !contactDetail || !deviceId) {
    res.status(400).json({
      success: false,
      message: 'Les champs nom complet, contact et identifiant appareil sont requis.',
      status: 'NOT_SUBMITTED',
    });
    return;
  }

  // Check if this device or contact is already approved
  const existingReq = findRequestByDeviceOrContact(deviceId, contactDetail);
  if (existingReq && existingReq.status === 'APPROVED' && existingReq.approvedUserId) {
    const user = getUserById(existingReq.approvedUserId);
    if (user && user.isEnabled) {
      res.json({
        success: true,
        message: 'Votre compte est déjà approuvé et actif!',
        status: 'APPROVED',
        uid: user.uuid,
        token: user.token,
        quotaBytes: user.quotaBytes,
        expirationTimestamp: user.expiresAt ? new Date(user.expiresAt).getTime() : null,
      });
      return;
    }
  }

  const { request, isNew } = addOrUpdateRequest({
    fullName,
    country: country || 'Cameroun',
    countryCode: countryCode || 'CM',
    channel: channel || 'WHATSAPP',
    contactDetail,
    deviceId,
    deviceModel: deviceModel || 'Android',
    androidVersion: androidVersion || 'Android',
    timestamp: timestamp || Date.now(),
  });

  addLog(
    'info',
    `[APK Demande Adhésion] ${isNew ? 'Nouvelle demande' : 'Mise à jour demande'} reçue de "${fullName}" (${contactDetail}, ${country}) sur appareil ${deviceModel}`
  );

  res.json({
    success: true,
    message: "Demande reçue. En attente d'approbation par un administrateur sur le Web Panel.",
    status: request.status, // "PENDING"
    uid: null,
    token: null,
    quotaBytes: null,
    expirationTimestamp: null,
  });
});

// 2. Poll Membership Status from Android APK
app.get('/api/membership/status', (req, res) => {
  const deviceId = (req.query.deviceId as string) || '';
  const contact = (req.query.contact as string) || '';

  if (!deviceId && !contact) {
    res.status(400).json({
      success: false,
      message: 'Paramètre deviceId ou contact manquant.',
      status: 'NOT_SUBMITTED',
    });
    return;
  }

  const request = findRequestByDeviceOrContact(deviceId, contact);
  if (!request) {
    res.json({
      success: false,
      message: 'Aucune demande trouvée pour cet appareil.',
      status: 'NOT_SUBMITTED',
    });
    return;
  }

  if (request.status === 'APPROVED') {
    let user: UserAccount | undefined;
    if (request.approvedUserId) {
      user = getUserById(request.approvedUserId);
    }
    if (!user && request.assignedToken) {
      user = getUserByToken(request.assignedToken);
    }

    if (user) {
      res.json({
        success: true,
        message: 'Demande approuvée par l’administrateur ! Bienvenue sur Nexus Tunnel.',
        status: 'APPROVED',
        uid: user.uuid,
        token: user.token,
        quotaBytes: user.quotaBytes,
        expirationTimestamp: user.expiresAt ? new Date(user.expiresAt).getTime() : null,
      });
      return;
    }
  }

  if (request.status === 'REJECTED') {
    res.json({
      success: false,
      message: 'Votre demande d’adhésion a été refusée par l’administrateur.',
      status: 'REJECTED',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Votre demande est en cours d’examen par l’administrateur...',
    status: 'PENDING',
  });
});

// 3. Verify Token from Android APK
app.post(['/api/token/verify', '/api/token/activate'], (req, res) => {
  const { token, deviceId } = req.body;

  if (!token || !token.trim()) {
    res.status(400).json({
      success: false,
      message: 'Token requis.',
      status: 'REJECTED',
    });
    return;
  }

  const user = getUserByToken(token);
  if (!user) {
    addLog('warn', `[APK Token] Tentative de vérification échouée pour le token: "${token}"`);
    res.status(404).json({
      success: false,
      message: 'Token invalide ou introuvable.',
      status: 'REJECTED',
    });
    return;
  }

  if (!user.isEnabled) {
    res.status(403).json({
      success: false,
      message: 'Ce compte est actuellement désactivé.',
      status: 'REJECTED',
    });
    return;
  }

  if (isUserExpired(user)) {
    res.status(403).json({
      success: false,
      message: 'Ce compte a expiré.',
      status: 'REJECTED',
    });
    return;
  }

  if (isUserQuotaExceeded(user)) {
    res.status(403).json({
      success: false,
      message: 'Le quota de données de ce compte est épuisé.',
      status: 'REJECTED',
    });
    return;
  }

  // Bind deviceId if not bound yet
  if (deviceId && !user.deviceId) {
    user.deviceId = deviceId;
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      users[idx].deviceId = deviceId;
      saveUsers(users);
    }
  }

  addLog('info', `[APK Token] Token validé avec succès pour "${user.name}" (Appareil: ${deviceId || 'N/A'})`);

  res.json({
    success: true,
    message: 'Token validé avec succès!',
    status: 'APPROVED',
    uid: user.uuid,
    token: user.token,
    quotaBytes: user.quotaBytes,
    expirationTimestamp: user.expiresAt ? new Date(user.expiresAt).getTime() : null,
  });
});

// 4. Real-time Quota Sync from Android APK
app.get('/api/user/quota', (req, res) => {
  const uid = (req.query.uid as string) || '';
  const authHeader = req.headers['authorization'] || '';
  let tokenFromHeader = '';
  if (authHeader.startsWith('Bearer ')) {
    tokenFromHeader = authHeader.substring(7).trim();
  }

  let user: UserAccount | undefined;
  if (uid) {
    user = getUserByUuid(uid);
  }
  if (!user && tokenFromHeader) {
    user = getUserByToken(tokenFromHeader);
  }

  if (!user) {
    res.status(404).json({
      success: false,
      message: 'Compte introuvable pour ce quota.',
      uid: '',
      quotaTotalBytes: 0,
      quotaUsedBytes: 0,
      expirationTimestamp: 0,
      isValid: false,
    });
    return;
  }

  const isValid = user.isEnabled && !isUserExpired(user) && !isUserQuotaExceeded(user);

  res.json({
    success: true,
    uid: user.uuid,
    quotaTotalBytes: user.quotaBytes,
    quotaUsedBytes: user.usedBytes,
    expirationTimestamp: user.expiresAt ? new Date(user.expiresAt).getTime() : 0,
    isValid,
  });
});

// 5. Server Info & VLESS parameters discovery for APK
app.get('/api/app/config', (req, res) => {
  const host = getHostname(req);
  res.json({
    webPanelUrl: `https://${host}`,
    serverAddress: host,
    serverPort: 443,
    transport: 'ws',
    wsPath: tunnelWsPath,
    security: 'tls',
    sni: host,
    alpn: 'http/1.1',
    protocol: 'vless',
    dockerImage: 'docker.io/nextl/nexus-tunnel',
    status: xrayStatus,
  });
});

// ==========================================
// ADMIN ENDPOINTS (MEMBERSHIP APPROVALS)
// ==========================================

app.get('/api/admin/requests', (_req, res) => {
  const requests = loadMembershipRequests();
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  res.json({ requests, pendingCount });
});

app.post('/api/admin/requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, uuid, token, quotaBytes, expiresAt, maxIps, notes } = req.body;

    const requests = loadMembershipRequests();
    const reqItem = requests.find((r) => r.id === id);
    if (!reqItem) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }

    const finalUuid = uuid && uuid.trim() ? uuid.trim().toLowerCase() : generateUuidV4();
    const finalToken = token && token.trim() ? token.trim().toUpperCase() : generateActivationToken();
    const finalName = name && name.trim() ? name.trim() : reqItem.fullName;

    const users = loadUsers();
    if (users.some((u) => u.uuid.toLowerCase() === finalUuid)) {
      res.status(400).json({ error: 'Cet UUID est déjà attribué à un autre compte.' });
      return;
    }

    const newUser: UserAccount = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      name: finalName,
      uuid: finalUuid,
      token: finalToken,
      email: `${finalName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Math.random().toString(36).slice(2, 6)}@nexus`,
      isEnabled: true,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      quotaBytes: Number(quotaBytes) || 0,
      usedBytes: 0,
      maxIps: Number(maxIps) || 0,
      notes: notes || `Approuvé depuis l'APK (${reqItem.country}, ${reqItem.channel}: ${reqItem.contactDetail})`,
      deviceId: reqItem.deviceId,
      deviceModel: reqItem.deviceModel,
      country: reqItem.country,
      countryCode: reqItem.countryCode,
      channel: reqItem.channel,
      contactDetail: reqItem.contactDetail,
      lastSeenAt: null,
    };

    users.push(newUser);
    saveUsers(users);

    approveRequest(id, newUser.id, finalToken);

    addLog(
      'info',
      `[Demande Approuvée] Demande de "${reqItem.fullName}" approuvée! Compte créé: "${newUser.name}", UUID: ${newUser.uuid}, Token: ${finalToken}`
    );

    await reloadXray();

    res.json({ success: true, user: newUser, request: reqItem });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/requests/:id/reject', (req, res) => {
  const { id } = req.params;
  const rejected = rejectRequest(id);
  if (!rejected) {
    res.status(404).json({ error: 'Demande introuvable.' });
    return;
  }
  addLog('warn', `[Demande Refusée] Demande #${id} refusée par l'administrateur.`);
  res.json({ success: true, request: rejected });
});

app.delete('/api/admin/requests/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteRequest(id);
  if (!deleted) {
    res.status(404).json({ error: 'Demande introuvable.' });
    return;
  }
  res.json({ success: true, message: 'Demande supprimée.' });
});

// ==========================================
// STANDARD SYSTEM & USERS API
// ==========================================

app.get('/api/status', (req, res) => {
  const host = getHostname(req);
  const uptimeSeconds =
    xrayStartedAt && xrayStatus === 'running'
      ? Math.floor((Date.now() - xrayStartedAt.getTime()) / 1000)
      : 0;

  const users = getUsersWithStats();
  const onlineUsers = users.filter((u) => u.isOnline).length;
  const totalUsedBytes = users.reduce((acc, u) => acc + u.usedBytes, 0);
  const requests = loadMembershipRequests();
  const pendingRequests = requests.filter((r) => r.status === 'PENDING').length;

  res.json({
    status: xrayStatus,
    pid: xrayProcess?.pid || null,
    uptimeSeconds,
    startedAt: xrayStartedAt,
    lastError: xrayLastError,
    version: 'Xray 26.9.9 (Xray, Penetrates Everything.)',
    dockerImage: 'docker.io/nextl/nexus-tunnel',
    tunnelPath: tunnelWsPath,
    host,
    port: PORT,
    stats: {
      totalAccounts: users.length,
      onlineAccounts: onlineUsers,
      activeSessions: activeSessions.size,
      totalHistoricalConnections: totalHistoricalWsConnections,
      totalBandwidthUsed: formatBytes(totalUsedBytes),
      pendingRequestsCount: pendingRequests,
      memoryUsage: process.memoryUsage(),
    },
  });
});

app.get('/api/users', (_req, res) => {
  const users = getUsersWithStats();
  res.json({ users });
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, uuid, token, quotaBytes, expiresAt, maxIps, notes } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Le nom du compte est obligatoire.' });
      return;
    }

    const finalUuid = uuid && uuid.trim() ? uuid.trim().toLowerCase() : generateUuidV4();
    const finalToken = token && token.trim() ? token.trim().toUpperCase() : generateActivationToken();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(finalUuid)) {
      res.status(400).json({ error: "L'UUID fourni est invalide (format standard UUIDv4 attendu)." });
      return;
    }

    const users = loadUsers();
    if (users.some((u) => u.uuid.toLowerCase() === finalUuid)) {
      res.status(400).json({ error: 'Cet UUID est déjà attribué à un autre compte.' });
      return;
    }

    const newUser: UserAccount = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      uuid: finalUuid,
      token: finalToken,
      email: `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Math.random().toString(36).slice(2, 6)}@nexus`,
      isEnabled: true,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      quotaBytes: Number(quotaBytes) || 0,
      usedBytes: 0,
      maxIps: Number(maxIps) || 0,
      notes: notes || '',
      lastSeenAt: null,
    };

    users.push(newUser);
    saveUsers(users);

    addLog('info', `Nouveau compte créé : "${newUser.name}" (UUID: ${newUser.uuid}, Token: ${finalToken})`);
    await reloadXray();

    res.status(201).json({ success: true, user: newUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, uuid, token, quotaBytes, expiresAt, maxIps, notes, isEnabled } = req.body;

    const users = loadUsers();
    const userIndex = users.findIndex((u) => u.id === id);

    if (userIndex === -1) {
      res.status(404).json({ error: 'Compte introuvable.' });
      return;
    }

    const existingUser = users[userIndex];

    if (name) existingUser.name = name.trim();
    if (uuid) {
      const trimmedUuid = uuid.trim().toLowerCase();
      if (users.some((u) => u.id !== id && u.uuid.toLowerCase() === trimmedUuid)) {
        res.status(400).json({ error: 'Cet UUID est déjà utilisé par un autre compte.' });
        return;
      }
      existingUser.uuid = trimmedUuid;
    }
    if (token) existingUser.token = token.trim().toUpperCase();
    if (quotaBytes !== undefined) existingUser.quotaBytes = Number(quotaBytes) || 0;
    if (expiresAt !== undefined) {
      existingUser.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
    }
    if (maxIps !== undefined) existingUser.maxIps = Number(maxIps) || 0;
    if (notes !== undefined) existingUser.notes = notes;
    if (isEnabled !== undefined) existingUser.isEnabled = Boolean(isEnabled);

    saveUsers(users);
    addLog('info', `Compte mis à jour : "${existingUser.name}"`);
    await reloadXray();

    res.json({ success: true, user: existingUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let users = loadUsers();
    const user = users.find((u) => u.id === id);

    if (!user) {
      res.status(404).json({ error: 'Compte introuvable.' });
      return;
    }

    for (const [sessId, session] of activeSessions.entries()) {
      if (session.userId === id) {
        session.clientSocket?.destroy();
        activeSessions.delete(sessId);
      }
    }

    users = users.filter((u) => u.id !== id);
    saveUsers(users);

    addLog('info', `Compte supprimé : "${user.name}"`);
    await reloadXray();

    res.json({ success: true, message: 'Compte supprimé avec succès.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id/reset-traffic', (req, res) => {
  const { id } = req.params;
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) {
    res.status(404).json({ error: 'Compte introuvable.' });
    return;
  }

  user.usedBytes = 0;
  saveUsers(users);
  addLog('info', `Consommation de données réinitialisée pour "${user.name}".`);
  res.json({ success: true, user });
});

app.post('/api/users/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) {
    res.status(404).json({ error: 'Compte introuvable.' });
    return;
  }

  user.isEnabled = !user.isEnabled;
  saveUsers(users);

  if (!user.isEnabled) {
    for (const [sessId, session] of activeSessions.entries()) {
      if (session.userId === id) {
        session.clientSocket?.destroy();
        activeSessions.delete(sessId);
      }
    }
  }

  addLog('info', `Statut du compte "${user.name}" basculé à ${user.isEnabled ? 'ACTIF' : 'DÉSACTIVÉ'}`);
  await reloadXray();
  res.json({ success: true, isEnabled: user.isEnabled, user });
});

app.get('/api/users/:id/configs', async (req, res) => {
  const { id } = req.params;
  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: 'Compte introuvable.' });
    return;
  }

  const host = getHostname(req);
  const configs = await generateClientConfigs(user, host, PORT, tunnelWsPath);
  res.json(configs);
});

app.get('/api/sessions', (_req, res) => {
  const list = Array.from(activeSessions.values()).map((s) => ({
    id: s.id,
    userId: s.userId,
    userName: s.userName || 'En attente de handshake',
    userUuid: s.userUuid,
    ip: s.ip,
    connectedAt: s.connectedAt,
    uptimeSeconds: Math.floor((Date.now() - s.connectedAt.getTime()) / 1000),
    bytesUp: s.bytesUp,
    bytesDown: s.bytesDown,
    readableUpload: formatBytes(s.bytesUp),
    readableDownload: formatBytes(s.bytesDown),
  }));
  res.json({ sessions: list });
});

app.post('/api/sessions/:id/disconnect', (req, res) => {
  const { id } = req.params;
  const session = activeSessions.get(id);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable.' });
    return;
  }

  session.clientSocket?.destroy();
  activeSessions.delete(id);
  addLog('info', `Session #${id} déconnectée manuellement.`);
  res.json({ success: true, message: 'Session terminée.' });
});

app.get('/api/uuid/generate', (_req, res) => {
  res.json({ uuid: generateUuidV4(), token: generateActivationToken() });
});

app.get('/api/logs', (_req, res) => {
  res.json({ logs: logBuffer });
});

app.post('/api/control', async (req, res) => {
  const { action } = req.body;
  if (action === 'start') {
    startXrayProcess();
    res.json({ success: true, message: 'Serveur démarré' });
  } else if (action === 'stop') {
    await stopXrayProcess();
    res.json({ success: true, message: 'Serveur arrêté' });
  } else if (action === 'restart') {
    await reloadXray();
    res.json({ success: true, message: 'Serveur redémarré avec succès' });
  } else {
    res.status(400).json({ error: 'Action invalide.' });
  }
});

app.post('/api/test-probe', (_req, res) => {
  let responded = false;
  const finish = (data: any, code = 200) => {
    if (responded) return;
    responded = true;
    res.status(code).json(data);
  };

  const testReq = http.request({
    hostname: '127.0.0.1',
    port: XRAY_INTERNAL_PORT,
    path: tunnelWsPath,
    method: 'GET',
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
    timeout: 3000,
  });

  testReq.on('upgrade', (_probeRes, socket) => {
    socket.destroy();
    finish({
      success: true,
      statusCode: 101,
      statusMessage: 'Switching Protocols',
      message: 'Le tunnel Xray a validé le handshake WebSocket avec succès (HTTP 101 Switching Protocols) !',
    });
  });

  testReq.on('response', (probeRes) => {
    finish({
      success: true,
      statusCode: probeRes.statusCode,
      statusMessage: probeRes.statusMessage,
      message: `Le tunnel Xray a répondu (Code ${probeRes.statusCode})`,
    });
  });

  testReq.on('timeout', () => {
    testReq.destroy();
    finish(
      {
        success: false,
        message: "Délai d'attente dépassé lors du test de sonde.",
      },
      504
    );
  });

  testReq.on('error', (err) => {
    finish(
      {
        success: false,
        error: err.message,
        message: 'Impossible de joindre le service Xray en local.',
      },
      502
    );
  });

  testReq.end();
});

// Update global tunnel path
app.post('/api/tunnel-path', async (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath) {
    res.status(400).json({ error: 'Chemin requis' });
    return;
  }
  tunnelWsPath = newPath.startsWith('/') ? newPath : `/${newPath}`;
  addLog('info', `Chemin WebSocket mis à jour : ${tunnelWsPath}`);
  await reloadXray();
  res.json({ success: true, path: tunnelWsPath });
});

// Mount Vite or serve static files
async function initFrontend() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Nexus Tunnel] Serveur Web prêt sur http://0.0.0.0:${PORT}`);
    console.log(`[Nexus Tunnel] Endpoint VLESS WS : ${tunnelWsPath}`);
    console.log(`[Nexus Tunnel] API APK : /api/membership/request & /api/token/verify`);
  });
}

initFrontend().catch((err) => {
  console.error('Fatal initialization error:', err);
});
