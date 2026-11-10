// Windows DPAPI + AES-GCM cookie extraction from Edge/Chrome profile.
// Only runs on Windows (process.platform === 'win32').
// On Linux/macOS this module is a no-op; cookies are kept in the local store (data/publisher.sqlite).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRuntimeDatabaseClient } from './local-store.mjs';

/**
 * 读取并解密账号 profile 里的番茄相关 cookie（仅 Windows）。
 * 浏览器开着时也能读：先复制 Cookies 库再打开。不支持的平台返回 null。
 */
export async function readProfileCookies(account) {
  if (process.platform !== 'win32') return null;

  const cookiesPath = path.join(account.browserDir, 'Default/Network/Cookies');
  const localStatePath = path.join(account.browserDir, 'Local State');
  if (!fs.existsSync(cookiesPath) || !fs.existsSync(localStatePath)) return [];

  const aesKey = await getProfileAesKey(localStatePath);
  if (!aesKey) return [];

  return decryptCookiesFromSqlite(cookiesPath, aesKey);
}

export async function extractAndPersistProfileCookies(account, knownCookies) {
  const cookies = knownCookies ?? await readProfileCookies(account);
  if (!cookies || !cookies.length) return null;

  const db = createRuntimeDatabaseClient();
  const checksum = crypto.createHash('sha256')
    .update(JSON.stringify(cookies)).digest('hex');
  const expiresValues = cookies.map((c) => c.expires).filter((v) => v > 0);
  const payload = {
    schemaVersion: 1,
    kind: 'fanqie.cookies',
    accountId: account.id,
    savedAt: new Date().toISOString(),
    cookieCount: cookies.length,
    checksum,
    expiresSummary: {
      domains: [...new Set(cookies.map((c) => c.domain))].sort(),
      cookieCount: cookies.length,
      maxExpires: expiresValues.length ? Math.max(...expiresValues) : null,
      sessionCookieCount: cookies.length - expiresValues.length,
    },
    cookies,
  };

  await db.publication.recordFanqieAccountSession({
    accountId: account.id,
    accountName: account.name,
    aliases: Array.isArray(account.aliases) ? account.aliases : undefined,
    cookiesPayload: payload,
    cookieChecksum: checksum,
    cookieCount: cookies.length,
    expiresSummary: payload.expiresSummary,
  }, { idempotencyKey: `dpapi:${account.id}:${checksum}` });

  return { cookieCount: cookies.length, checksum, savedAt: payload.savedAt };
}

async function getProfileAesKey(localStatePath) {
  const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  const encryptedKeyB64 = localState?.os_crypt?.encrypted_key;
  if (!encryptedKeyB64) return null;
  const encryptedKey = Buffer.from(encryptedKeyB64, 'base64').subarray(5); // strip 'DPAPI' prefix
  return dpapiDecrypt(encryptedKey);
}

async function decryptCookiesFromSqlite(cookiesPath, aesKey) {
  // Copy the DB to avoid lock conflicts with running Edge
  const tmpPath = `${cookiesPath}.extract-${process.pid}-${Date.now()}.tmp`;
  fs.copyFileSync(cookiesPath, tmpPath);
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    fs.unlinkSync(tmpPath);
    return [];
  }
  const db = new Database(tmpPath, { readonly: true });
  const rows = db.prepare(`
    SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
    FROM cookies
    WHERE host_key LIKE '%fanqie%' OR host_key LIKE '%toutiao%' OR host_key LIKE '%bytedance%'
  `).all();
  db.close();
  fs.unlinkSync(tmpPath);

  const cookies = [];
  for (const row of rows) {
    const enc = row.encrypted_value;
    if (!enc || enc.length < 16) continue;
    try {
      const nonce = enc.subarray(3, 15);
      const ciphertext = enc.subarray(15);
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
      const tagStart = ciphertext.length - 16;
      decipher.setAuthTag(ciphertext.subarray(tagStart));
      const plaintext = Buffer.concat([
        decipher.update(ciphertext.subarray(0, tagStart)),
        decipher.final(),
      ]);
      // Chrome 127+: 32-byte app-bound key prefix before actual value
      const value = plaintext.length > 32
        ? plaintext.subarray(32).toString('utf8')
        : plaintext.toString('utf8');
      if (!value) continue;
      const unixExpires = row.expires_utc > 0
        ? (row.expires_utc / 1000000) - 11644473600
        : -1;
      const sameSite = { 0: 'None', 1: 'Lax', 2: 'Strict' }[row.samesite] || 'None';
      cookies.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        expires: unixExpires,
        httpOnly: Boolean(row.is_httponly),
        secure: Boolean(row.is_secure),
        sameSite,
      });
    } catch { continue; }
  }
  return cookies;
}

async function dpapiDecrypt(encryptedData) {
  try {
    const dpapi = await import('win-dpapi');
    const mod = dpapi.default || dpapi;
    return mod.unprotectData(Buffer.from(encryptedData), null, 'CurrentUser');
  } catch {
    const { execSync } = await import('node:child_process');
    const b64 = Buffer.from(encryptedData).toString('base64');
    const ps = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'),$null,'CurrentUser'))`;
    const result = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' }).trim();
    return Buffer.from(result, 'base64');
  }
}
