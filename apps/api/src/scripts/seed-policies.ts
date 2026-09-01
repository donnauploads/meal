import { PrismaClient } from '@prisma/client';

const POLICIES = [
  {
    slug: 'deposit-account-agreement',
    title: 'Deposit Account Agreement',
    version: '2026.01',
    bodyMd: `# Deposit Account Agreement

## 1. About this agreement
This Deposit Account Agreement ("Agreement") governs your State Bank deposit account ("Account") and the relationship between you and State Bank with respect to that Account.

## 2. Opening your account
To open an Account you must complete identity verification (KYC) and accept this Agreement. You authorize State Bank to verify your identity using third-party data providers.

## 3. Deposits
You may fund your Account by ACH transfer, mobile check deposit, or transfer from another State Bank account. Mobile check deposits are subject to review and may be held for up to two business days.

## 4. Withdrawals and transfers
You may withdraw funds by ACH transfer, wire transfer, debit card purchase, or peer-to-peer transfer. Transfers may be subject to daily and monthly limits described in the in-app Limits screen.

## 5. Fees
Fees applicable to your Account are governed by the Fee Schedule, which is incorporated into this Agreement. The current Fee Schedule is available in the Documents section of the app.

## 6. Interest
Eligible balances earn interest at the APY shown on the account dashboard. Interest accrues daily and is credited monthly.

## 7. Statements
Monthly statements are made available in the Documents section of the app within five business days after month-end. You may also generate statements for custom date ranges at any time.

## 8. Errors and unauthorized transactions
If you believe a transaction is unauthorized or in error, contact State Bank Support through the in-app chat within sixty (60) days of the statement on which it appears.

## 9. Changes to this agreement
State Bank may amend this Agreement from time to time. The "effective date" shown at the bottom of this document is the date of the most recent revision.

## 10. Governing law
This Agreement is governed by the laws of the State of Delaware, without regard to its conflict of laws principles.
`,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    version: '2026.01',
    bodyMd: `# Privacy Policy

## What this policy covers
This Privacy Policy explains how State Bank collects, uses, and shares your personal information when you use the State Bank banking product.

## Information we collect
- **Identity information:** name, date of birth, government ID number, and address provided during onboarding.
- **Financial information:** account balances, transaction history, linked external accounts, and beneficiary details you enter.
- **Device and usage information:** device identifiers, IP address, browser type, and how you interact with the product.
- **Communications:** the contents of messages you send through in-app chat and any support correspondence.

## How we use your information
- To open and service your Account.
- To detect and prevent fraud and unauthorized access.
- To comply with legal obligations such as anti-money-laundering (AML) and Know-Your-Customer (KYC) requirements.
- To improve product features and personalize your experience.

## How we share your information
We share information only with service providers necessary to operate the product (identity verification, payment rails, customer support tooling) and with regulators when required by law. **We do not sell your personal information.**

## Your choices
You may control marketing communications, analytics, and contact-sharing preferences from the Privacy controls in the Profile section of the app.

## Data retention
We retain your information for as long as your Account is open and for a reasonable period afterward to satisfy legal and audit requirements.

## Contact us
Questions about this policy can be sent via in-app chat to State Bank Support.
`,
  },
  {
    slug: 'electronic-communications',
    title: 'E-Sign Consent',
    version: '2026.01',
    bodyMd: `# E-Sign Consent

## Consent to electronic delivery
By accepting this consent you agree that State Bank may provide all account communications, disclosures, agreements, statements, tax forms, and legal notices electronically rather than on paper.

## How we deliver communications
We will deliver communications through any of:
- The Documents section of the State Bank app
- Email to the address on file
- SMS or push notification for short transactional alerts

## System requirements
To access and retain electronic communications you need a modern web browser or current State Bank mobile app, an active email address, and the ability to view and save PDF files.

## Updating your contact information
Keep your email address and phone number current in the Profile section. If we cannot deliver a communication electronically we may suspend your Account until we can re-establish contact.

## Withdrawing consent
You may withdraw this consent by contacting State Bank Support. If you withdraw consent, State Bank may be required to close the Account.

## Paper copies
You may request a paper copy of any specific communication via in-app chat. Fees for paper copies, if any, are set out in the Fee Schedule.
`,
  },
  {
    slug: 'cardholder-agreement',
    title: 'Cardholder Agreement',
    version: '2026.01',
    bodyMd: `# Cardholder Agreement

## 1. Your card
Your State Bank debit card is linked to your State Bank checking Account and allows you to make point-of-sale purchases, ATM withdrawals, and online transactions in U.S. dollars.

## 2. Card activation
Your physical card must be activated through the Cards screen in the app before it can be used. Virtual cards are active on creation.

## 3. PIN and security
You are responsible for keeping your card number, PIN, and login credentials confidential. Notify State Bank immediately if you believe your card has been lost, stolen, or used without your authorization.

## 4. Transaction limits
Daily and monthly card limits are shown in the in-app Limits screen and may be adjusted by State Bank in response to risk signals.

## 5. Authorization holds
Merchants may place temporary authorization holds on your card that exceed the final transaction amount. These holds typically release within three business days.

## 6. International transactions
Transactions in foreign currencies are converted to U.S. dollars at a network-published reference rate. Any applicable foreign-transaction fee is set out in the Fee Schedule.

## 7. Disputes
If you believe a card transaction is unauthorized or incorrect, open a dispute from the transaction's details screen within sixty (60) days of the statement on which the transaction appears.

## 8. Cancellation
You may freeze or cancel your card at any time from the Cards screen. State Bank may cancel a card for security reasons after notifying you.
`,
  },
  {
    slug: 'wire-transfer-agreement',
    title: 'Wire Transfer Agreement',
    version: '2026.01',
    bodyMd: `# Wire Transfer Agreement

## Scope
This Agreement governs your use of domestic and international wire transfers initiated through State Bank.

## Eligible recipients
You may send wires only to beneficiaries that appear on State Bank's approved beneficiary list, curated by State Bank's compliance team. To request that a new beneficiary be added, submit the request via in-app support.

## Cut-off times
Wires submitted before 3:00 PM Eastern on a business day are processed the same day. Submissions after the cut-off, on weekends, or on Federal Reserve holidays are processed the next business day.

## Information you provide
You must provide accurate beneficiary name, account number, routing number (for domestic wires), SWIFT/BIC, IBAN, and country (for international wires). Wires sent based on incorrect information may be unrecoverable.

## Fees and limits
Wire fees and limits are shown at quote time before you confirm a wire, in accordance with the Fee Schedule.

## Reversals
Outbound wires that have not yet settled may be cancelled by State Bank Support. Settled wires can be reversed only at the discretion of the receiving bank.

## Indemnification
You agree to indemnify State Bank for any loss arising from your provision of incorrect beneficiary information or your authorization of a fraudulent transfer.
`,
  },
  {
    slug: 'fee-schedule',
    title: 'Fee Schedule',
    version: '2026.01',
    bodyMd: `# Fee Schedule

| Item | Fee |
| --- | --- |
| Monthly maintenance | $0.00 |
| Domestic ACH transfer | $0.00 |
| Domestic wire transfer | $25.00 |
| International wire transfer | $45.00 |
| Outbound check deposit | $0.00 |
| Card replacement (standard) | $0.00 |
| Card replacement (expedited) | $15.00 |
| Stop payment | $25.00 |
| Paper statement | $5.00 |

This Fee Schedule applies to State Bank Accounts. State Bank may update these fees from time to time; the effective date below reflects the most recent revision.
`,
  },
  {
    slug: 'terms-of-service',
    title: 'Terms of Service',
    version: '2026.01',
    bodyMd: `# Terms of Service

## 1. Acceptance
By creating a State Bank Account or accessing the State Bank application you agree to these Terms of Service.

## 2. Eligibility
You must be at least eighteen (18) years old and a resident of the United States to open an Account.

## 3. The service
State Bank provides digital banking services including deposit accounts, transfers, cards, and related features. Your use of these services is subject to this Agreement and the other policies referenced in it.

## 4. Acceptable use
You agree not to use the service to violate any law, infringe any third-party right, attempt to reverse-engineer State Bank's services, or transmit malware or other harmful code.

## 5. Account security
You are responsible for safeguarding your credentials and for all activity performed under your Account. Enable multi-factor authentication and a transaction PIN in the Security settings to reduce the risk of unauthorized use.

## 6. Limitation of liability
To the maximum extent permitted by law, State Bank is not liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the service.

## 7. Termination
State Bank may suspend or terminate your access to the service at any time, with or without notice, including for violation of these Terms.

## 8. Changes
State Bank may update these Terms from time to time. The "effective date" at the bottom of this document indicates the date of the most recent revision.
`,
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    let inserted = 0;
    for (const p of POLICIES) {
      await prisma.policyDoc.upsert({
        where: { slug_version: { slug: p.slug, version: p.version } },
        update: { title: p.title, bodyMd: p.bodyMd },
        create: { ...p, effectiveAt: new Date('2026-01-01T00:00:00Z') },
      });
      inserted++;
    }
    console.log(`Seeded ${inserted} policy docs.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
