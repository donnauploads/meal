import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');

export interface DirectDepositPdfVars {
  userFullName: string;
  routingNumber: string;
  accountNumber: string;
  bankName: string;
  employerName?: string;
  asOf: Date;
}

@Injectable()
export class DirectDepositPdfRenderer {
  render(vars: DirectDepositPdfVars): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('Direct Deposit Authorization', { align: 'center' });
      doc.moveDown();
      doc.fontSize(11)
        .text(`Bank: ${vars.bankName}`)
        .text(`Account holder: ${vars.userFullName}`)
        .text(`As of: ${vars.asOf.toISOString().slice(0, 10)}`);
      doc.moveDown();

      doc.fontSize(13).text('Deposit instructions', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11)
        .text(`Routing (ABA) number:  ${vars.routingNumber}`)
        .text(`Account number:        ${vars.accountNumber}`)
        .text(`Account type:          Checking`)
        .text(`Deposit amount:        Full net pay (unless your employer asks for a different split)`);
      doc.moveDown();

      if (vars.employerName) {
        doc.fontSize(13).text('Employer', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).text(vars.employerName);
        doc.moveDown();
      }

      doc.fontSize(11).text(
        'I authorize the above-named employer to initiate credit entries to my account ' +
        'at the financial institution listed above. This authorization remains in effect until ' +
        'I notify the employer in writing to terminate.',
        { align: 'justify' },
      );

      doc.moveDown(2);
      doc.fontSize(11).text('Signature:');
      doc.moveDown(2);
      doc.moveTo(56, doc.y).lineTo(556, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).text(`${vars.userFullName}    Date: ____________________`);

      doc.end();
    });
  }
}
