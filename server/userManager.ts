import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';

export interface UserAccount {
  id: string;
  name: string;
  uuid: string;
  email: string;
  isEnabled: boolean;
  createdAt: string;
  expiresAt: string | null; // ISO date string or null for unlimited
  quotaBytes: number; // 0 = unlimited, otherwise quota in bytes
  usedBytes: number;
  maxIps: number; // 0 = unlimited, 1 = 1 IP, 2 = 2 IPs, etc.
  notes?: string;
  lastSeenAt: string | null;
}

export interface UserAccountWithStats extends UserAccount {
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

export interface ActiveSession {
  id: string;
  userId: string | null;
  userUuid: string | null;
  userName: string | null;
  ip: string;
  connectedAt: Date;
  bytesUp: number;
  bytesDown: number;
  clientSocket: any;
  proxySocket: any;
}

const USERS_FILE_PATH = path.resolve(process.cwd(), 'users.json');

// In-memory active sessions Map<sessionId, ActiveSession>
export const activeSessions = new Map<string, ActiveSession>();

export function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 Mo';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return `${val} ${sizes[i] || 'Go'}`;
}

export function loadUsers(): UserAccount[] {
  try {
    if (fs.existsSync(USERS_FILE_PATH)) {
      const data = fs.readFileSync(USERS_FILE_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[UserManager] Failed to read users.json:', err);
  }
  return [];
}

export function saveUsers(users: UserAccount[]): void {
  try {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('[UserManager] Failed to save users.json:', err);
  }
}

export function getUserByUuid(uuid: string): UserAccount | undefined {
  const users = loadUsers();
  return users.find((u) => u.uuid.toLowerCase() === uuid.toLowerCase());
}

export function getUserById(id: string): UserAccount | undefined {
  const users = loadUsers();
  return users.find((u) => u.id === id);
}

export function isUserExpired(user: UserAccount): boolean {
  if (!user.expiresAt) return false;
  return new Date(user.expiresAt).getTime() < Date.now();
}

export function isUserQuotaExceeded(user: UserAccount): boolean {
  if (user.quotaBytes <= 0) return false;
  return user.usedBytes >= user.quotaBytes;
}

export function getActiveIpsForUser(userId: string): string[] {
  const ips = new Set<string>();
  for (const session of activeSessions.values()) {
    if (session.userId === userId && session.ip) {
      ips.add(session.ip);
    }
  }
  return Array.from(ips);
}

export function getUsersWithStats(): UserAccountWithStats[] {
  const users = loadUsers();
  return users.map((u) => {
    const activeIps = getActiveIpsForUser(u.id);
    const activeConns = Array.from(activeSessions.values()).filter((s) => s.userId === u.id);
    const expired = isUserExpired(u);
    const quotaExceeded = isUserQuotaExceeded(u);
    const maxIpsReached = u.maxIps > 0 && activeIps.length >= u.maxIps;

    let percent = 0;
    if (u.quotaBytes > 0) {
      percent = Math.min(100, Math.round((u.usedBytes / u.quotaBytes) * 100));
    }

    return {
      ...u,
      isOnline: activeConns.length > 0,
      activeConnectionsCount: activeConns.length,
      activeIpsCount: activeIps.length,
      activeIps,
      isExpired: expired,
      isQuotaExceeded: quotaExceeded,
      isMaxIpsReached: maxIpsReached,
      percentQuotaUsed: percent,
      readableQuota: u.quotaBytes > 0 ? formatBytes(u.quotaBytes) : 'Illimité',
      readableUsed: formatBytes(u.usedBytes),
    };
  });
}

export function parseVlessUuidFromWsFrame(buffer: Buffer): string | null {
  if (buffer.length < 24) return null;
  const firstByte = buffer[0];
  const isWs = (firstByte & 0x0f) === 2 || (firstByte & 0x0f) === 1;
  const isMasked = (buffer[1] & 0x80) !== 0;
  if (!isWs && buffer[0] === 0x00 && buffer.length >= 17) {
    // Raw VLESS without WS frame wrapper
    const hex = buffer.slice(1, 17).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    offset = 10;
  }

  if (!isMasked || buffer.length < offset + 4 + 17) return null;
  const mask = buffer.slice(offset, offset + 4);
  offset += 4;

  const payload = Buffer.alloc(17);
  for (let i = 0; i < 17; i++) {
    payload[i] = buffer[offset + i] ^ mask[i % 4];
  }

  if (payload[0] !== 0x00) return null;
  const hex = payload.slice(1, 17).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function addTrafficToUser(userId: string, bytes: number) {
  if (bytes <= 0) return;
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (user) {
    user.usedBytes += bytes;
    user.lastSeenAt = new Date().toISOString();
    saveUsers(users);
  }
}

export async function generateClientConfigs(
  user: UserAccount,
  host: string,
  port: number,
  wsPath: string
) {
  const remark = `Nexus-${user.name.replace(/\s+/g, '_')}`;
  const isHttps = true;
  const targetPort = isHttps ? 443 : port;

  const params = new URLSearchParams({
    type: 'ws',
    security: isHttps ? 'tls' : 'none',
    path: wsPath,
    sni: host,
  });

  const vlessUrl = `vless://${user.uuid}@${host}:${targetPort}?${params.toString()}#${encodeURIComponent(remark)}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(vlessUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    });
  } catch (e) {
    console.error('Failed generating QR code for user:', e);
  }

  const clashConfig = `
proxies:
  - name: "${remark}"
    type: vless
    server: ${host}
    port: 443
    uuid: ${user.uuid}
    network: ws
    tls: true
    udp: true
    servername: ${host}
    ws-opts:
      path: "${wsPath}"
      headers:
        Host: ${host}
`.trim();

  const singboxConfig = {
    type: 'vless',
    tag: remark,
    server: host,
    server_port: 443,
    uuid: user.uuid,
    packet_encoding: 'xudp',
    tls: {
      enabled: true,
      server_name: host,
      insecure: false,
    },
    transport: {
      type: 'ws',
      path: wsPath,
      headers: {
        Host: host,
      },
    },
  };

  const v2rayNConfig = {
    v: '2',
    ps: remark,
    add: host,
    port: '443',
    id: user.uuid,
    aid: '0',
    scy: 'none',
    net: 'ws',
    type: 'none',
    host: host,
    path: wsPath,
    tls: 'tls',
    sni: host,
    alpn: '',
  };

  return {
    user,
    vlessUrl,
    qrCodeDataUrl,
    remark,
    formats: {
      clash: clashConfig,
      singbox: JSON.stringify(singboxConfig, null, 2),
      v2rayN: JSON.stringify(v2rayNConfig, null, 2),
    },
  };
}
