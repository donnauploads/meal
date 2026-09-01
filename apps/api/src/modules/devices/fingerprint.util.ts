import { createHash } from 'crypto';

export interface FingerprintInput {
  userAgent: string;
  acceptLanguage: string;
  timezone: string;
  canvasHash?: string;
}

export function computeFingerprint(input: FingerprintInput): string {
  const h = createHash('sha256');
  h.update(input.userAgent || '');
  h.update('|');
  h.update(input.acceptLanguage || '');
  h.update('|');
  h.update(input.timezone || '');
  h.update('|');
  h.update(input.canvasHash || '');
  return h.digest('hex');
}

export function parseUaSummary(ua: string): { os: string; browser: string; name: string } {
  const lower = (ua || '').toLowerCase();
  const os = /windows/.test(lower) ? 'Windows'
    : /mac os x|macintosh/.test(lower) ? 'macOS'
    : /android/.test(lower) ? 'Android'
    : /iphone|ipad|ios/.test(lower) ? 'iOS'
    : /linux/.test(lower) ? 'Linux'
    : 'Unknown';
  const browser = /edg\//.test(lower) ? 'Edge'
    : /chrome\//.test(lower) ? 'Chrome'
    : /safari\//.test(lower) ? 'Safari'
    : /firefox\//.test(lower) ? 'Firefox'
    : 'Unknown';
  return { os, browser, name: `${browser} on ${os}` };
}
