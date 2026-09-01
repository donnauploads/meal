import { randomInt } from 'crypto';

export function generatePan(bin: string): string {
  if (!/^\d{6}$/.test(bin)) throw new Error('BIN must be 6 digits');
  let body = '';
  for (let i = 0; i < 9; i++) body += randomInt(0, 10).toString();
  const partial = bin + body;
  const check = luhnCheckDigit(partial);
  return partial + check.toString();
}

export function generateCvv(): string {
  return String(randomInt(0, 1000)).padStart(3, '0');
}

export function generateExpiry(): { expMonth: number; expYear: number } {
  const now = new Date();
  return { expMonth: now.getUTCMonth() + 1, expYear: now.getUTCFullYear() + 4 };
}

function luhnCheckDigit(partial: string): number {
  let sum = 0;
  for (let i = partial.length - 1, doubled = true; i >= 0; i--, doubled = !doubled) {
    let d = Number(partial[i]);
    if (doubled) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}
