import { randomInt } from 'crypto';

export function generateCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

export function maskPhone(e164: string): string {
  return e164.replace(/.(?=.{4})/g, '•');
}

export function maskDestination(channel: 'email' | 'sms', destination: string): string {
  return channel === 'email' ? maskEmail(destination) : maskPhone(destination);
}
