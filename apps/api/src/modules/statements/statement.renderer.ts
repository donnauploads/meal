import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument = require('pdfkit');

/** Official State Bank logo (emblem + wordmark) — same asset the homepage uses. */
const SB_LOGO_PATH = join(process.cwd(), 'assets', 'sb-logo.png');

export interface StatementVars {
  accountLabel: string;
  accountNumberMasked: string;
  routingNumber: string;
  userFullName: string;
  periodStart: Date;
  periodEnd: Date;
  openingBalanceCents: bigint;
  closingBalanceCents: bigint;
  totalInCents: bigint;
  totalOutCents: bigint;
  transactions: {
    occurredAt: Date;
    description: string;
    amountCents: bigint;
    runningBalanceCents: bigint;
  }[];
}

// State Bank editorial palette — pulled from frontend globals.css so the PDF
// reads as the same brand the customer sees in the app.
const BRAND = {
  ink: '#1C1A17',        // near-black (--navy-deep)
  inkSoft: '#5C5648',    // warm muted ink
  inkMuted: '#8E8674',   // warm muted gray
  gold: '#C9A24A',       // --gold (primary accent)
  goldSoft: '#DCC07E',   // --gold-soft (card fills + softer accents)
  goldDeep: '#97793A',   // --gold-deep
  hairline: '#E7E1D3',   // --paper-line
  paper: '#F4F1EA',      // --paper (page tint)
  cream: '#FBF8F0',      // card surface (a hair warmer than #FFF)
  zebra: '#F7F1E3',      // warm zebra
  positive: '#2F8A5B',   // forest green
  negative: '#B23A3A',   // brand red
};

const fmtCents = (cents: bigint, opts: { sign?: boolean } = {}): string => {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = abs / 100n;
  const c = abs % 100n;
  const groups = dollars
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `$${groups}.${c.toString().padStart(2, '0')}`;
  if (neg) return `-${body}`;
  if (opts.sign && cents > 0n) return `+${body}`;
  return body;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const fmtDate = (d: Date): string => {
  const m = MONTHS[d.getUTCMonth()].slice(0, 3);
  return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

const fmtDateLong = (d: Date): string =>
  `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

@Injectable()
export class StatementRenderer {
  render(vars: StatementVars): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 56, bottom: 64, left: 48, right: 48 },
        bufferPages: true,
        info: {
          Title: `State Bank Statement — ${fmtDate(vars.periodStart)} to ${fmtDate(vars.periodEnd)}`,
          Author: 'State Bank',
          Subject: 'Account Statement',
          Creator: 'State Bank',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Warm paper tint behind every page — gives the PDF the same
      // off-white feel as the State Bank dashboard, instead of clinical white.
      doc.on('pageAdded', () => {
        doc.save();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.paper);
        doc.restore();
      });
      // Tint the first page too — `pageAdded` doesn't fire for it.
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.paper);
      doc.restore();

      const pageWidth = doc.page.width;
      const contentLeft = 48;
      const contentRight = pageWidth - 48;
      const contentWidth = contentRight - contentLeft;

      this.drawHeader(doc, vars, contentLeft, contentRight);
      doc.y = 160;

      this.drawAccountBlock(doc, vars, contentLeft, contentWidth);
      this.drawSummaryCards(doc, vars, contentLeft, contentWidth);
      this.drawTransactionTable(doc, vars, contentLeft, contentRight);

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        // Footer sits below the content margin — drop the bottom margin so
        // its text() calls don't get treated as overflow and append pages.
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        this.drawFooter(doc, i + 1, range.count, contentLeft, contentRight);
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    });
  }

  // ─── Header ─────────────────────────────────────────────────────────────
  private drawHeader(
    doc: PDFKit.PDFDocument,
    vars: StatementVars,
    left: number,
    right: number,
  ) {
    const top = 0;
    const height = 104;

    doc.save();
    // White header — mirrors the homepage nav (light, hairline bottom).
    doc.rect(0, top, doc.page.width, height).fill('#FFFFFF');

    // Official State Bank logo (emblem + wordmark) on the left, vertically centred.
    const logoH = 42;
    const logoY = top + Math.round((height - logoH) / 2);
    if (existsSync(SB_LOGO_PATH)) {
      doc.image(SB_LOGO_PATH, left, logoY, { height: logoH });
    } else {
      doc
        .fillColor(BRAND.ink)
        .font('Helvetica-Bold')
        .fontSize(17)
        .text('State Bank', left, top + height / 2 - 9, {
          lineBreak: false,
        });
    }

    // Right side — document title + period, dark on white.
    doc
      .fillColor(BRAND.ink)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('Account Statement', right - 240, top + 36, {
        width: 240,
        align: 'right',
        lineBreak: false,
      });
    doc
      .fillColor(BRAND.inkMuted)
      .font('Helvetica')
      .fontSize(9)
      .text(
        `${fmtDate(vars.periodStart)} — ${fmtDate(vars.periodEnd)}`,
        right - 240,
        top + 57,
        { width: 240, align: 'right', lineBreak: false },
      );
    doc
      .fillColor(BRAND.gold)
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Issued ${fmtDate(new Date())}`, right - 240, top + 71, {
        width: 240,
        align: 'right',
        lineBreak: false,
      });

    // Hairline + thin gold accent rule, like the homepage nav border.
    doc.rect(0, top + height - 1, doc.page.width, 1).fill(BRAND.hairline);
    doc.rect(0, top + height, doc.page.width, 2.5).fill(BRAND.gold);
    doc.restore();
  }

  // ─── Account block ──────────────────────────────────────────────────────
  private drawAccountBlock(
    doc: PDFKit.PDFDocument,
    vars: StatementVars,
    left: number,
    width: number,
  ) {
    const colW = width / 2;
    const startY = doc.y;

    this.drawLabel(doc, 'ACCOUNT HOLDER', left, startY);
    doc
      .fillColor(BRAND.ink)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(vars.userFullName, left, startY + 12, { width: colW - 12 });

    this.drawLabel(doc, 'ACCOUNT', left + colW, startY);
    doc
      .fillColor(BRAND.ink)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(`${vars.accountLabel}  ${vars.accountNumberMasked}`, left + colW, startY + 12, {
        width: colW,
        lineBreak: false,
      });
    doc
      .fillColor(BRAND.inkSoft)
      .font('Helvetica')
      .fontSize(9)
      .text(`Routing · ${vars.routingNumber}`, left + colW, startY + 28, {
        width: colW,
        lineBreak: false,
      });

    doc.y = startY + 56;
  }

  private drawLabel(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
    doc
      .fillColor(BRAND.inkMuted)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(text, x, y, { characterSpacing: 1.2, lineBreak: false });
  }

  // ─── Summary cards ──────────────────────────────────────────────────────
  private drawSummaryCards(
    doc: PDFKit.PDFDocument,
    vars: StatementVars,
    left: number,
    width: number,
  ) {
    const gap = 12;
    const cardW = (width - gap * 3) / 4;
    const cardH = 70;
    const y = doc.y;

    const cards: Array<{
      label: string;
      value: string;
      color: string;
      accent?: boolean;
    }> = [
      {
        label: 'OPENING BALANCE',
        value: fmtCents(vars.openingBalanceCents),
        color: BRAND.ink,
      },
      {
        label: 'MONEY IN',
        value: `+${fmtCents(vars.totalInCents).replace(/^-/, '')}`,
        color: BRAND.positive,
      },
      {
        label: 'MONEY OUT',
        value: `-${fmtCents(vars.totalOutCents).replace(/^-/, '')}`,
        color: BRAND.negative,
      },
      {
        label: 'CLOSING BALANCE',
        value: fmtCents(vars.closingBalanceCents),
        color: BRAND.ink,
        accent: true,
      },
    ];

    cards.forEach((c, i) => {
      const x = left + i * (cardW + gap);
      doc.save();
      if (c.accent) {
        // Gold-filled closing-balance card — replaces the prior dark
        // navy accent which felt too State Bank-fintech against the cream bg.
        doc.roundedRect(x, y, cardW, cardH, 8).fill(BRAND.gold);
      } else {
        // Warm cream cards with a hairline border, NOT pure white —
        // sits cleanly on the paper bg.
        doc.roundedRect(x, y, cardW, cardH, 8).fillAndStroke(BRAND.cream, BRAND.hairline);
      }
      doc.restore();

      doc
        .fillColor(c.accent ? BRAND.goldDeep : BRAND.inkMuted)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(c.label, x + 12, y + 12, {
          width: cardW - 24,
          characterSpacing: 1.2,
          lineBreak: false,
        });
      doc
        .fillColor(c.color)
        .font('Helvetica-Bold')
        .fontSize(15)
        .text(c.value, x + 12, y + 30, { width: cardW - 24, lineBreak: false });
    });

    doc.y = y + cardH + 28;
  }

  // ─── Transactions ───────────────────────────────────────────────────────
  private drawTransactionTable(
    doc: PDFKit.PDFDocument,
    vars: StatementVars,
    left: number,
    right: number,
  ) {
    doc
      .fillColor(BRAND.ink)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('Transactions', left, doc.y, { lineBreak: false });
    doc
      .fillColor(BRAND.inkSoft)
      .font('Helvetica')
      .fontSize(9)
      .text(
        `${vars.transactions.length} posted in this period`,
        left,
        doc.y + 2,
        { width: right - left, align: 'right', lineBreak: false },
      );

    doc.y += 22;

    const colDate = left;
    const colDesc = left + 80;
    const colAmt = right - 180;
    const colBal = right - 80;

    const drawHeaderRow = (y: number) => {
      doc.save();
      // Soft-gold header bar with a thicker gold underline rule —
      // editorial editorial-table look instead of the dark navy bar.
      doc.rect(left, y, right - left, 22).fill(BRAND.goldSoft);
      doc.rect(left, y + 22, right - left, 1.2).fill(BRAND.goldDeep);
      doc.fillColor(BRAND.goldDeep).font('Helvetica-Bold').fontSize(8.5);
      doc.text('DATE', colDate + 8, y + 7, { lineBreak: false, characterSpacing: 0.8 });
      doc.text('DESCRIPTION', colDesc, y + 7, { lineBreak: false, characterSpacing: 0.8 });
      doc.text('AMOUNT', colAmt - 12, y + 7, {
        width: 90,
        align: 'right',
        lineBreak: false,
        characterSpacing: 0.8,
      });
      doc.text('BALANCE', colBal - 12, y + 7, {
        width: 80,
        align: 'right',
        lineBreak: false,
        characterSpacing: 0.8,
      });
      doc.restore();
      return y + 22;
    };

    let y = drawHeaderRow(doc.y);

    if (vars.transactions.length === 0) {
      doc
        .fillColor(BRAND.inkMuted)
        .font('Helvetica-Oblique')
        .fontSize(10)
        .text('No posted transactions in this period.', left, y + 16, {
          width: right - left,
          align: 'center',
        });
      doc.y = y + 36;
      return;
    }

    const rowH = 22;
    const bottomLimit = doc.page.height - 90;

    vars.transactions.forEach((t, idx) => {
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = doc.y;
        y = drawHeaderRow(y);
      }
      if (idx % 2 === 1) {
        doc.save();
        doc.rect(left, y, right - left, rowH).fill(BRAND.zebra);
        doc.restore();
      }

      const isPos = t.amountCents > 0n;
      const dateStr = fmtDate(t.occurredAt);

      doc
        .fillColor(BRAND.inkSoft)
        .font('Helvetica')
        .fontSize(9)
        .text(dateStr, colDate + 8, y + 7, {
          width: colDesc - colDate - 12,
          lineBreak: false,
        });
      doc
        .fillColor(BRAND.ink)
        .font('Helvetica')
        .fontSize(9.5)
        .text(t.description || '—', colDesc, y + 7, {
          width: colAmt - colDesc - 12,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .fillColor(isPos ? BRAND.positive : BRAND.ink)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(fmtCents(t.amountCents, { sign: true }), colAmt - 12, y + 7, {
          width: 90,
          align: 'right',
          lineBreak: false,
        });
      doc
        .fillColor(BRAND.inkSoft)
        .font('Helvetica')
        .fontSize(9)
        .text(fmtCents(t.runningBalanceCents), colBal - 12, y + 7, {
          width: 80,
          align: 'right',
          lineBreak: false,
        });

      y += rowH;
    });

    doc.y = y;
  }

  // ─── Footer ─────────────────────────────────────────────────────────────
  private drawFooter(
    doc: PDFKit.PDFDocument,
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
        'State Bank · This statement is provided for your records. Please review it and report any discrepancies to Support.',
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
