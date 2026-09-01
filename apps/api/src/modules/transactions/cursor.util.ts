export interface TxCursor {
  occurredAt: string;
  id: string;
}

export function encodeCursor(c: TxCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): TxCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<TxCursor>;
    if (!parsed.occurredAt || !parsed.id) return null;
    if (Number.isNaN(Date.parse(parsed.occurredAt))) return null;
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    return null;
  }
}
