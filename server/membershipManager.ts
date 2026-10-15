import fs from 'fs';
import path from 'path';

export interface MembershipRequest {
  id: string;
  fullName: string;
  country: string;
  countryCode: string;
  channel: string; // "WHATSAPP" | "TELEGRAM" | string
  contactDetail: string;
  deviceId: string;
  deviceModel: string;
  androidVersion: string;
  timestamp: number;
  createdAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedUserId?: string | null;
  assignedToken?: string | null;
  reviewedAt?: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const REQUESTS_FILE_PATH = path.resolve(DATA_DIR, 'membership_requests.json');
const REQUESTS_BACKUP_PATH = path.resolve(process.cwd(), 'membership_requests.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function atomicWrite(filePath: string, data: string) {
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function loadMembershipRequests(): MembershipRequest[] {
  ensureDataDir();
  try {
    if (fs.existsSync(REQUESTS_FILE_PATH)) {
      const content = fs.readFileSync(REQUESTS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('[MembershipManager] Failed to read from data/membership_requests.json, checking backup:', err);
  }

  // Backup check
  try {
    if (fs.existsSync(REQUESTS_BACKUP_PATH)) {
      const content = fs.readFileSync(REQUESTS_BACKUP_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        saveMembershipRequests(parsed);
        return parsed;
      }
    }
  } catch (e) {
    console.error('[MembershipManager] Failed to read backup membership_requests.json:', e);
  }

  return [];
}

export function saveMembershipRequests(requests: MembershipRequest[]): void {
  ensureDataDir();
  const serialized = JSON.stringify(requests, null, 2);
  try {
    atomicWrite(REQUESTS_FILE_PATH, serialized);
  } catch (err) {
    console.error('[MembershipManager] Error writing to data/membership_requests.json:', err);
  }
  try {
    fs.writeFileSync(REQUESTS_BACKUP_PATH, serialized, 'utf-8');
  } catch (err) {
    // ignore
  }
}

export function findRequestByDeviceOrContact(
  deviceId: string,
  contact: string
): MembershipRequest | undefined {
  const requests = loadMembershipRequests();
  const normDevice = deviceId.trim().toLowerCase();
  const normContact = contact.trim().toLowerCase();

  return requests.find((r) => {
    const rDevice = (r.deviceId || '').trim().toLowerCase();
    const rContact = (r.contactDetail || '').trim().toLowerCase();
    return (normDevice && rDevice === normDevice) || (normContact && rContact === normContact);
  });
}

export function addOrUpdateRequest(data: {
  fullName: string;
  country: string;
  countryCode: string;
  channel: string;
  contactDetail: string;
  deviceId: string;
  deviceModel: string;
  androidVersion: string;
  timestamp?: number;
}): { request: MembershipRequest; isNew: boolean } {
  const requests = loadMembershipRequests();
  const existing = findRequestByDeviceOrContact(data.deviceId, data.contactDetail);

  if (existing) {
    existing.fullName = data.fullName.trim() || existing.fullName;
    existing.country = data.country || existing.country;
    existing.countryCode = data.countryCode || existing.countryCode;
    existing.channel = data.channel || existing.channel;
    existing.contactDetail = data.contactDetail.trim() || existing.contactDetail;
    existing.deviceModel = data.deviceModel || existing.deviceModel;
    existing.androidVersion = data.androidVersion || existing.androidVersion;
    existing.timestamp = data.timestamp || Date.now();
    saveMembershipRequests(requests);
    return { request: existing, isNew: false };
  }

  const newReq: MembershipRequest = {
    id: 'req_' + Math.random().toString(36).substring(2, 9),
    fullName: data.fullName.trim(),
    country: data.country || 'Cameroun',
    countryCode: data.countryCode || 'CM',
    channel: data.channel || 'WHATSAPP',
    contactDetail: data.contactDetail.trim(),
    deviceId: data.deviceId.trim(),
    deviceModel: data.deviceModel || 'Android Device',
    androidVersion: data.androidVersion || 'Android',
    timestamp: data.timestamp || Date.now(),
    createdAt: new Date().toISOString(),
    status: 'PENDING',
    approvedUserId: null,
    assignedToken: null,
    reviewedAt: null,
  };

  requests.unshift(newReq);
  saveMembershipRequests(requests);
  return { request: newReq, isNew: true };
}

export function approveRequest(
  requestId: string,
  userId: string,
  token: string
): MembershipRequest | null {
  const requests = loadMembershipRequests();
  const req = requests.find((r) => r.id === requestId);
  if (!req) return null;

  req.status = 'APPROVED';
  req.approvedUserId = userId;
  req.assignedToken = token;
  req.reviewedAt = new Date().toISOString();
  saveMembershipRequests(requests);
  return req;
}

export function rejectRequest(requestId: string): MembershipRequest | null {
  const requests = loadMembershipRequests();
  const req = requests.find((r) => r.id === requestId);
  if (!req) return null;

  req.status = 'REJECTED';
  req.reviewedAt = new Date().toISOString();
  saveMembershipRequests(requests);
  return req;
}

export function deleteRequest(requestId: string): boolean {
  let requests = loadMembershipRequests();
  const initialLen = requests.length;
  requests = requests.filter((r) => r.id !== requestId);
  if (requests.length !== initialLen) {
    saveMembershipRequests(requests);
    return true;
  }
  return false;
}
