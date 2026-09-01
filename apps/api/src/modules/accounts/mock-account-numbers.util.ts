import { randomInt } from 'crypto';

export function generateMockRoutingNumber(): string {
  // 021000000-prefixed with deliberately invalid ABA checksum so it's obviously demo.
  return '021000099';
}

export function generateMockAccountNumber(): string {
  let n = '';
  for (let i = 0; i < 12; i++) n += randomInt(0, 10).toString();
  return n;
}
