import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument = require('pdfkit');

/** Official State Bank logo (emblem + wordmark), same asset the homepage header
 *  uses. Loaded from apps/api/assets at runtime. */
const SB_LOGO_PATH = join(process.cwd(), 'assets', 'sb-logo.png');

export interface PolicyPdfVars {
  title: string;
  version: string;
  effectiveAt: Date;
  bodyMd: string;
}

const BRAND = {
  ink: '#1C1A17',
  inkSoft: '#475467',
  inkMuted: '#98A2B3',
  fern: '#C9A24A',
  hairline: '#E4E7EC',
  zebraBorder: '#D0D5DD',
  tableHeader: '#F7F1E3',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const fmtDate = (d: Date): string =>
  `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

@Injectable()
export class PolicyRenderer {
  render(vars: PolicyPdfVars): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 56, bottom: 64, left: 56, right: 56 },
        bufferPages: true,
        info: {
          Title: `State Bank — ${vars.title}`,
          Author: 'State Bank',
          Subject: vars.title,
          Creator: 'State Bank',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = 56;
      const right = doc.page.width - 56;

      this.drawHeader(doc, vars, left, right);
      doc.y = 160;
      this.drawBody(doc, vars.bodyMd, left, right);

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        // The footer sits below the content margin; without this PDFKit
        // treats each footer text() as an overflow and appends blank pages.
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        this.drawFooter(doc, vars, i + 1, range.count, left, right);
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    });
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    vars: PolicyPdfVars,
    left: number,
    right: number,
  ) {
    const height = 104;
    doc.save();
    // White header — mirrors the homepage nav (light, hairline bottom).
    doc.rect(0, 0, doc.page.width, height).fill('#FFFFFF');

    // Official State Bank logo (emblem + wordmark) on the left, vertically centred —
    // same asset the site header uses. Text fallback if the file is missing.
    const logoH = 42;
    const logoY = Math.round((height - logoH) / 2);
    if (existsSync(SB_LOGO_PATH)) {
      doc.image(SB_LOGO_PATH, left, logoY, { height: logoH });
    } else {
      doc
        .fillColor(BRAND.ink)
        .font('Helvetica-Bold')
        .fontSize(17)
        .text('State Bank', left, height / 2 - 9, {
          lineBreak: false,
        });
    }

    // Document title + meta on the right, dark on white.
    doc
      .fillColor(BRAND.ink)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(vars.title, right - 240, 36, {
        width: 240,
        align: 'right',
        lineBreak: false,
      });
    doc
      .fillColor(BRAND.inkMuted)
      .font('Helvetica')
      .fontSize(9)
      .text(`Version ${vars.version}`, right - 240, 57, {
        width: 240,
        align: 'right',
        lineBreak: false,
      });
    doc
      .fillColor(BRAND.fern)
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Effective ${fmtDate(vars.effectiveAt)}`, right - 240, 71, {
        width: 240,
        align: 'right',
        lineBreak: false,
      });

    // Hairline + thin gold accent rule, like the homepage nav border.
    doc.rect(0, height - 1, doc.page.width, 1).fill(BRAND.hairline);
    doc.rect(0, height, doc.page.width, 2.5).fill(BRAND.fern);
    doc.restore();
  }

  /**
   * Minimal Markdown renderer — enough for our seeded policy bodies:
   *   #, ##, ### headings; paragraphs; - bullet lists; pipe tables; **bold**.
   * Anything fancier (links, images, code blocks) is treated as plain text.
   */
  private drawBody(doc: PDFKit.PDFDocument, md: string, left: number, right: number) {
    const width = right - left;
    const bottom = doc.page.height - 90;

    const ensureSpace = (need: number) => {
      if (doc.y + need > bottom) doc.addPage();
    };

    const lines = md.replace(/\r\n/g, '\n').split('\n');

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Skip blank lines (but use them as paragraph breaks).
      if (line.trim() === '') {
        doc.moveDown(0.4);
        i++;
        continue;
      }

      // Headings
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) {
        const level = h[1].length;
        const text = h[2].trim();
        ensureSpace(40);
        if (level === 1) {
          doc.moveDown(0.2);
          doc
            .fillColor(BRAND.ink)
            .font('Helvetica-Bold')
            .fontSize(22)
            .text(text, left, doc.y, { width });
          doc.moveDown(0.4);
        } else if (level === 2) {
          doc.moveDown(0.5);
          doc
            .fillColor(BRAND.ink)
            .font('Helvetica-Bold')
            .fontSize(14)
            .text(text, left, doc.y, { width });
          doc.moveDown(0.4);
        } else {
          doc.moveDown(0.4);
          doc
            .fillColor(BRAND.ink)
            .font('Helvetica-Bold')
            .fontSize(11)
            .text(text, left, doc.y, { width });
          doc.moveDown(0.2);
        }
        i++;
        continue;
      }

      // Pipe table — gather consecutive table lines.
      if (/^\|.+\|\s*$/.test(line)) {
        const tableLines: string[] = [];
        while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) {
          tableLines.push(lines[i]);
          i++;
        }
        this.drawTable(doc, tableLines, left, width, ensureSpace);
        continue;
      }

      // Bullet list — gather consecutive list lines.
      if (/^[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*]\s+/, ''));
          i++;
        }
        for (const item of items) {
          ensureSpace(18);
          const y = doc.y + 5;
          doc.save().circle(left + 3, y, 1.6).fill(BRAND.fern).restore();
          doc.fillColor(BRAND.ink).font('Helvetica').fontSize(10.5);
          this.writeInline(doc, item, left + 14, doc.y, width - 14);
          doc.moveDown(0.25);
        }
        doc.moveDown(0.2);
        continue;
      }

      // Plain paragraph — gather consecutive non-blank, non-special lines.
      const paragraph: string[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\|.+\|\s*$/.test(lines[i])
      ) {
        paragraph.push(lines[i]);
        i++;
      }
      ensureSpace(28);
      doc.fillColor(BRAND.ink).font('Helvetica').fontSize(10.5);
      this.writeInline(doc, paragraph.join(' '), left, doc.y, width);
      doc.moveDown(0.5);
    }
  }

  /**
   * Render a single string with **bold** spans. PDFKit doesn't ship a
   * markdown layer, so we tokenize on `**` and stream each chunk with
   * `continued: true` until the final piece.
   */
  private writeInline(
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    y: number,
    width: number,
  ) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
    if (parts.length === 0) {
      doc.text('', x, y, { width });
      return;
    }
    doc.x = x;
    doc.y = y;
    parts.forEach((p, idx) => {
      const isLast = idx === parts.length - 1;
      if (/^\*\*[^*]+\*\*$/.test(p)) {
        doc
          .font('Helvetica-Bold')
          .text(p.slice(2, -2), { width, continued: !isLast, lineGap: 2 });
      } else {
        doc
          .font('Helvetica')
          .text(p, { width, continued: !isLast, lineGap: 2 });
      }
    });
  }

  private drawTable(
    doc: PDFKit.PDFDocument,
    rows: string[],
    left: number,
    width: number,
    ensureSpace: (n: number) => void,
  ) {
    // First row is header; second row (if all dashes) is divider — skip.
    const cells = rows.map((r) =>
      r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()),
    );
    const isDivider = (i: number) =>
      cells[i].every((c) => /^:?-+:?$/.test(c));

    const headerRow = cells[0];
    const bodyStart = cells[1] && isDivider(1) ? 2 : 1;
    const bodyRows = cells.slice(bodyStart);
    const cols = headerRow.length;
    const colW = width / cols;
    const rowH = 22;

    ensureSpace(rowH * 2);

    // Track the row baseline in a local — doc.text() mutates doc.y, so we
    // must NOT use doc.y to position cells within a row (that made each row
    // consume ~3× its height and pushed the table onto blank pages).
    let y = doc.y;
    const bottom = doc.page.height - 90;

    const drawRow = (
      rowCells: string[],
      opts: { header?: boolean; zebra?: boolean },
    ) => {
      if (opts.header) {
        doc.save().rect(left, y, width, rowH).fill(BRAND.ink).restore();
      } else if (opts.zebra) {
        doc.save().rect(left, y, width, rowH).fill('#F7F8FA').restore();
      }
      rowCells.forEach((c, idx) => {
        doc
          .fillColor(opts.header ? '#FFFFFF' : BRAND.ink)
          .font(opts.header ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(opts.header ? 9 : 9.5)
          .text(c, left + idx * colW + 8, y + 7, {
            width: colW - 16,
            lineBreak: false,
            ellipsis: true,
            ...(opts.header ? { characterSpacing: 0.5 } : {}),
          });
      });
      y += rowH;
    };

    drawRow(headerRow, { header: true });
    bodyRows.forEach((row, rIdx) => {
      if (y + rowH > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      drawRow(row, { zebra: rIdx % 2 === 1 });
    });

    // Bottom border
    doc.y = y;
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.5)
      .stroke(BRAND.hairline);
    doc.moveDown(0.6);
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    vars: PolicyPdfVars,
    page: number,
    total: number,
    left: number,
    right: number,
  ) {
    const y = doc.page.height - 48;
    doc.save();
    doc
      .moveTo(left, y - 12)
      .lineTo(right, y - 12)
      .lineWidth(0.5)
      .stroke(BRAND.hairline);
    doc
      .fillColor(BRAND.inkMuted)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `State Bank · ${vars.title} · v${vars.version} · Effective ${fmtDate(vars.effectiveAt)}`,
        left,
        y,
        { width: right - left - 80, lineBreak: false },
      );
    doc
      .fillColor(BRAND.inkSoft)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(`Page ${page} of ${total}`, right - 80, y, {
        width: 80,
        align: 'right',
        lineBreak: false,
      });
    doc.restore();
  }
}
