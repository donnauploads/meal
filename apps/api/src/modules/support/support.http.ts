import { Response } from 'express';

export interface LoadedAttachment {
  buffer: Buffer;
  name: string;
  type: string;
  kind: 'image' | 'file';
}

/**
 * Stream a chat attachment with hardened headers.
 *  - `X-Content-Type-Options: nosniff` stops the browser from re-sniffing a
 *    file into an executable type.
 *  - Images (already re-encoded to clean raster server-side) are served inline
 *    with their real image type so the chat can render them.
 *  - Documents are forced to `application/octet-stream` + `attachment`
 *    disposition, so the browser downloads them and NEVER opens/executes them
 *    inline (no PDF-JS, no HTML/script interpretation).
 */
export function streamAttachment(res: Response, a: LoadedAttachment): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const filename = safeHeaderName(a.name);
  if (a.kind === 'image') {
    res.setHeader('Content-Type', a.type);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.end(a.buffer);
}

/** Strip characters that could break out of the Content-Disposition header. */
function safeHeaderName(name: string): string {
  return name.replace(/["\r\n\\]/g, '_').slice(0, 120);
}
