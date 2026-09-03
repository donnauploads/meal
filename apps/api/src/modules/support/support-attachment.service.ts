import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { STORAGE_DRIVER, StorageDriver } from '../documents/storage/storage.interface';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ProcessedAttachment {
  key: string;
  /** Sanitized display / download filename. */
  name: string;
  /** Normalized content type actually stored (never the raw client value). */
  type: string;
  size: number;
  kind: 'image' | 'file';
}

export interface IncomingFile {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
}

/**
 * Turns an untrusted uploaded chat file into a safe stored object.
 *
 * Threat model & defenses (the "malicious file" loophole):
 *  - Images are **re-encoded through sharp** into a clean raster (JPEG/PNG).
 *    This is the strongest defense: it drops EXIF, ICC junk, trailing bytes,
 *    and any script/HTML/polyglot payload smuggled into the original — the
 *    stored bytes are freshly emitted pixels, not the attacker's file. SVG is
 *    rejected outright (it's scriptable XML, not a raster image).
 *  - Documents (PDF / DOC / DOCX) can't be neutralized, so they're validated
 *    by **magic bytes** (not the client's Content-Type or filename), capped in
 *    size, stored verbatim, and served **download-only** (never rendered in
 *    the browser) via an authenticated, participant-scoped endpoint.
 *  - Everything is size-capped and stored under a random UUID key (no
 *    attacker-controlled path), and libvips' input-pixel limit guards against
 *    decompression bombs.
 */
@Injectable()
export class SupportAttachmentService {
  private readonly logger = new Logger(SupportAttachmentService.name);
  private readonly maxBytes: number;

  constructor(
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    config: ConfigService,
  ) {
    this.maxBytes = Number(
      config.get('SUPPORT_ATTACH_MAX_BYTES') ?? 10 * 1024 * 1024,
    );
  }

  async process(threadId: string, file: IncomingFile): Promise<ProcessedAttachment> {
    const buf = file.buffer;
    if (!buf || buf.length === 0) throw new BadRequestException('Empty file');
    if (buf.length > this.maxBytes) {
      throw new BadRequestException(
        `File exceeds the ${Math.round(this.maxBytes / (1024 * 1024))}MB limit`,
      );
    }
    const displayName = sanitizeName(file.originalname);

    // 1) Image path — a successful sharp re-encode is BOTH the validation and
    //    the sanitization. If sharp can't decode it, it's not a real image and
    //    we fall through to the document check.
    const image = await this.tryProcessImage(buf);
    if (image) {
      const key = `support/${threadId}/${randomUUID()}.${image.ext}`;
      await this.storage.put({ key, body: image.body, contentType: image.type });
      return {
        key,
        name: `${stripExt(displayName)}.${image.ext}`,
        type: image.type,
        size: image.body.length,
        kind: 'image',
      };
    }

    // 2) Document path — magic-byte validated, stored as-is, download-only.
    const doc = this.matchDocument(buf, file.mimetype, displayName);
    if (doc) {
      const key = `support/${threadId}/${randomUUID()}.${doc.ext}`;
      await this.storage.put({ key, body: buf, contentType: doc.type });
      return {
        key,
        name: ensureExt(displayName, doc.ext),
        type: doc.type,
        size: buf.length,
        kind: 'file',
      };
    }

    throw new BadRequestException(
      'Unsupported file. Allowed: images (PNG, JPG, WebP, GIF), PDF, or Word (.doc/.docx).',
    );
  }

  /**
   * Decode + re-encode an image, returning clean bytes, or null if the buffer
   * isn't a supported raster image. SVG is explicitly refused.
   */
  private async tryProcessImage(
    buf: Buffer,
  ): Promise<{ body: Buffer; type: string; ext: string } | null> {
    try {
      const sharp = (await import('sharp')).default;
      // limitInputPixels guards against decompression-bomb images.
      const opts = { limitInputPixels: 50_000_000 };
      const meta = await sharp(buf, opts).metadata();
      const format = meta.format;
      const RASTER = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff']);
      // svg / unknown / non-image → not an allowed image (caller falls
      // through to the document check).
      if (!format || format === 'svg' || !RASTER.has(format)) return null;

      const pipeline = sharp(buf, opts)
        // Honor EXIF orientation, then drop all metadata by re-emitting.
        .rotate()
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });
      if (meta.hasAlpha) {
        const body = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        return { body, type: 'image/png', ext: 'png' };
      }
      const body = await pipeline.jpeg({ quality: 85 }).toBuffer();
      return { body, type: 'image/jpeg', ext: 'jpg' };
    } catch (e) {
      // Not a decodable image (or sharp unavailable) — do NOT store raw.
      this.logger.warn(`image not processed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Identify an allowed document by magic bytes. DOCX/DOC additionally require
   * the client's declared type or filename extension to match, so we don't
   * accept an arbitrary ZIP or OLE container.
   */
  private matchDocument(
    buf: Buffer,
    mimetype: string | undefined,
    name: string,
  ): { type: string; ext: string } | null {
    const mt = (mimetype ?? '').toLowerCase();
    const lname = name.toLowerCase();

    // PDF: "%PDF-"
    if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') {
      return { type: 'application/pdf', ext: 'pdf' };
    }
    // DOCX (OOXML) is a ZIP: 50 4B 03/05/07 04/06/08
    const isZip =
      buf.length >= 4 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
    if (isZip && (mt === DOCX_MIME || lname.endsWith('.docx'))) {
      return { type: DOCX_MIME, ext: 'docx' };
    }
    // Legacy .doc (OLE compound): D0 CF 11 E0 A1 B1 1A E1
    const isOle =
      buf.length >= 8 &&
      buf[0] === 0xd0 &&
      buf[1] === 0xcf &&
      buf[2] === 0x11 &&
      buf[3] === 0xe0 &&
      buf[4] === 0xa1 &&
      buf[5] === 0xb1 &&
      buf[6] === 0x1a &&
      buf[7] === 0xe1;
    if (isOle && (mt === 'application/msword' || lname.endsWith('.doc'))) {
      return { type: 'application/msword', ext: 'doc' };
    }
    return null;
  }

  fetchBytes(key: string): Promise<Buffer> {
    return this.storage.get(key);
  }
}

/** Strip any path, keep a short safe basename. Never trusted for storage keys. */
function sanitizeName(name?: string): string {
  const base = (name ?? 'file').split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name;
}

function ensureExt(name: string, ext: string): string {
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}
