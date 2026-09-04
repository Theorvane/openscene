import { safeStorage } from 'electron';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import {
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  type BrowserSessionProviderId,
  type BrowserSessionStatus
} from '../shared/browserSession';
import type { SafeStorageAdapter } from './chatGptOAuthTokenStore';

const storedCookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1),
  hostOnly: z.boolean(),
  path: z.string().min(1),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  session: z.boolean(),
  expirationDate: z.number().positive().optional(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']).optional(),
  sourceUrl: z.url()
}).strict();

const browserSessionRecordSchema = z.object({
  version: z.literal(1),
  providerId: z.enum(['gemini', 'grok']),
  storedAt: z.iso.datetime(),
  cookies: z.array(storedCookieSchema).min(1)
}).strict();

export type BrowserSessionStoredCookie = z.infer<typeof storedCookieSchema>;
export type BrowserSessionSecretRecord = z.infer<typeof browserSessionRecordSchema>;

export class BrowserSessionVaultError extends Error {
  override readonly name = 'BrowserSessionVaultError';
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function assertRecordPolicy(record: BrowserSessionSecretRecord): void {
  for (const cookie of record.cookies) {
    if (!isBrowserSessionCookieDomainAllowed(record.providerId, cookie.domain)) {
      throw new BrowserSessionVaultError(`Cookie domain is not allowed for ${record.providerId}.`);
    }
    const policy = getBrowserSessionProviderPolicy(record.providerId);
    if (!policy.allowedNavigationOrigins.includes(new URL(cookie.sourceUrl).origin)) {
      throw new BrowserSessionVaultError(`Cookie source origin is not allowed for ${record.providerId}.`);
    }
  }
}

function publicStatus(record: BrowserSessionSecretRecord | null, providerId: BrowserSessionProviderId, now: Date): BrowserSessionStatus {
  const policy = getBrowserSessionProviderPolicy(providerId);
  if (record === null) {
    return { providerId, kind: 'disconnected', origin: policy.applicationOrigin };
  }

  const expirations = record.cookies
    .map((cookie) => cookie.expirationDate)
    .filter((value): value is number => value !== undefined);
  const latestExpiration = expirations.length === 0 ? undefined : Math.max(...expirations) * 1_000;
  const hasSessionCookie = record.cookies.some((cookie) => cookie.session || cookie.expirationDate === undefined);
  const expired = !hasSessionCookie && latestExpiration !== undefined && latestExpiration <= now.getTime();
  return {
    providerId,
    kind: expired ? 'expired' : 'stored',
    origin: policy.applicationOrigin,
    storedAt: record.storedAt,
    ...(latestExpiration === undefined ? {} : { expiresAt: new Date(latestExpiration).toISOString() })
  };
}

export class BrowserSessionVault {
  constructor(
    private readonly directory: string,
    private readonly encryption: SafeStorageAdapter = safeStorage
  ) {}

  async loadSecret(providerId: BrowserSessionProviderId): Promise<BrowserSessionSecretRecord | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath(providerId));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw new BrowserSessionVaultError('Could not read encrypted browser session.', { cause: error });
    }

    this.requireEncryption();
    try {
      const record = browserSessionRecordSchema.parse(JSON.parse(this.encryption.decryptString(encrypted)) as unknown);
      if (record.providerId !== providerId) {
        throw new Error('Provider id did not match the vault slot.');
      }
      assertRecordPolicy(record);
      return record;
    } catch (error) {
      if (error instanceof BrowserSessionVaultError) throw error;
      throw new BrowserSessionVaultError('Encrypted browser session was invalid.', { cause: error });
    }
  }

  async getStatus(providerId: BrowserSessionProviderId, now: Date = new Date()): Promise<BrowserSessionStatus> {
    return publicStatus(await this.loadSecret(providerId), providerId, now);
  }

  async save(recordInput: BrowserSessionSecretRecord): Promise<BrowserSessionStatus> {
    this.requireEncryption();
    const record = browserSessionRecordSchema.parse(recordInput);
    assertRecordPolicy(record);
    const encrypted = this.encryption.encryptString(JSON.stringify(record));
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.filePath(record.providerId), encrypted);
    return publicStatus(record, record.providerId, new Date());
  }

  async clear(providerId: BrowserSessionProviderId): Promise<void> {
    try {
      await unlink(this.filePath(providerId));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new BrowserSessionVaultError('Could not remove encrypted browser session.', { cause: error });
      }
    }
  }

  private filePath(providerId: BrowserSessionProviderId): string {
    return join(this.directory, `encrypted_browser_session_${providerId}.bin`);
  }

  private requireEncryption(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new BrowserSessionVaultError('Electron safeStorage encryption is unavailable on this system.');
    }
  }
}
