/**
 * Shared HTML chrome for State Bank transactional emails.
 *
 * Mirrors the design bundle's `emails.html` preview: navy header with
 * inline-SVG crest + wordmark, gold gradient stripe, white body card on
 * a warm-paper background, navy-deep footer with copyright + support
 * contact lines. Every consumer feeds its own `bodyHtml` between the
 * header and footer.
 *
 * Styles are inline because email clients (Gmail/Outlook in particular)
 * strip `<style>` blocks or scope them in unpredictable ways. Anything
 * load-bearing for the visual must be inline on its element.
 */

export interface EmailFooterLink {
  label: string;
  href: string;
}

export interface WrapEmailOptions {
  /** `<title>` text + the implicit subject hint for the preview pane. */
  title: string;
  /** The card body — everything between the header and the footer. */
  bodyHtml: string;
  /**
   * Footer link row (Help Centre / Contact us / Security Centre, etc.).
   * Omitted by default — the verification-code emails don't show them.
   */
  footerLinks?: EmailFooterLink[];
  /** Tail line under the address + copyright. Defaults to the generic
   * "automated message, please don't reply" copy. */
  footerTail?: string;
}

const NAVY = '#2B2926';       // header band (warm brown)
const NAVY_DEEP = '#1C1A17';  // footer band (near-black) + body text
const GOLD = '#C9A24A';
const GOLD_DEEP = '#A8884A';  // matches the design-bundle emails.html spec
const PAPER = '#F4F1EA';
const LINE = '#E2DDD0';
const INK = '#211F1B';
const INK_SOFT = '#514D45';
const INK_MUTE = '#756F66';
const WHITE = '#FFFFFF';

/**
 * Public URL of the logo PNG used in the email header. Lives at
 * `frontend/public/lp2.png` so Next.js serves it at `/lp2.png` —
 * resolved against the deployed origin so email clients can fetch it.
 *
 * Override per-environment via the `EMAIL_LOGO_URL` env var (e.g. when
 * staging is on a different domain). Default matches the production
 * marketing/site host.
 */
const LOGO_URL =
  process.env.EMAIL_LOGO_URL || 'https://secure-access.site/lp2.png';

/**
 * Base URL for the email icon PNGs (hero badges + callout glyphs). Email
 * clients (Gmail, Outlook, Yahoo) strip inline `<svg>`, so every icon is
 * shipped as a hosted PNG instead — the design's monochrome line icons
 * pre-rendered to transparent PNGs.
 *
 * Files live in `frontend2/public/emailicons/` and are served at
 * `/emailicons/<name>.png`. Override per-environment via `EMAIL_ICON_BASE`
 * (no trailing slash). Default matches the production marketing host that
 * also serves the logo above.
 */
const ICON_BASE =
  process.env.EMAIL_ICON_BASE || 'https://secure-access.site/emailicons';

/** Build an absolute URL for an emailicons PNG (without the `.png`). */
function iconUrl(name: string): string {
  return `${ICON_BASE}/${name}.png`;
}

/** Section helpers exposed so individual templates can compose code-
 *  boxes, detail tables, success badges, etc., without duplicating the
 *  inline-style soup. */
export const emailBlocks = {
  /** Big monospace verification-code panel. */
  codeBox(opts: { label: string; code: string; expiryNote: string }): string {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${PAPER}" style="background-color:${PAPER};border:1px solid ${LINE};border-radius:6px;margin:6px 0 18px;">
      <tr>
        <td bgcolor="${PAPER}" align="center" style="background-color:${PAPER};padding:22px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${GOLD_DEEP};margin-bottom:10px;">${escapeHtml(opts.label)}</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;letter-spacing:.34em;color:${NAVY};padding-left:.34em;line-height:1;">${escapeHtml(opts.code)}</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${INK_MUTE};margin-top:10px;">${escapeHtml(opts.expiryNote)}</div>
        </td>
      </tr>
    </table>`;
  },

  /** Two-column data table used on the registration-success + sign-in
   *  alert emails. `rows` is an array of `[label, value]`. */
  detailTable(rows: Array<[string, string]>): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${WHITE}" style="background-color:${WHITE};border-collapse:collapse;margin:4px 0 18px;">${rows
      .map(
        ([label, value]) => `<tr>
          <td bgcolor="${WHITE}" style="background-color:${WHITE};padding:11px 0;border-bottom:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK_MUTE};width:42%;">${escapeHtml(label)}</td>
          <td bgcolor="${WHITE}" style="background-color:${WHITE};padding:11px 0;border-bottom:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};font-weight:700;text-align:right;">${escapeHtml(value)}</td>
        </tr>`,
      )
      .join('')}</table>`;
  },

  /**
   * Reassurance/security callout strip — icon panel on the left, copy on
   * the right. Icons are hosted PNGs (see `ICON_BASE`); Gmail/Outlook
   * strip inline SVG so we never use it here.
   *
   * Responsive: on screens ≤600px the two cells restack (icon row on
   * top with a bottom rule, text below) via the `.ecallout*` classes in
   * `wrapEmail`'s `<style>` block — mirroring the design's mobile layout.
   */
  secureCallout(opts: {
    icon:
      | 'lock'
      | 'shield-check'
      | 'shield'
      | 'info'
      | 'document'
      | 'card'
      | 'arrow-right';
    text: string;
  }): string {
    const ICON_FILES = {
      lock: 'icon-lock',
      'shield-check': 'icon-shield-check',
      shield: 'icon-shield',
      info: 'icon-info',
      document: 'icon-document',
      card: 'icon-card',
      'arrow-right': 'icon-arrow-right',
    } as const;
    const src = iconUrl(ICON_FILES[opts.icon]);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAPER}" class="ecallout" style="background-color:${PAPER};margin:26px 0 8px;">
      <tr>
        <td class="ecallout-ic" bgcolor="${PAPER}" valign="middle" width="54" align="center" style="background-color:${PAPER};padding:14px 16px;border-right:1px solid ${LINE};">
          <img src="${escapeAttr(src)}" alt="" width="22" height="22" style="display:block;margin:0 auto;width:22px;height:22px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
        </td>
        <td class="ecallout-txt" bgcolor="${PAPER}" valign="middle" style="background-color:${PAPER};padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${INK_SOFT};">${escapeHtml(opts.text)}</td>
      </tr>
    </table>`;
  },

  /**
   * Centered round success badge — used on the registration-success
   * email. The green circle background is baked into the PNG, so this is
   * just a centered `<img>` (no wrapping coloured cell).
   */
  successIcon(): string {
    return `<img src="${escapeAttr(iconUrl('hero-success'))}" alt="" width="62" height="62" style="display:block;margin:0 auto 20px;width:62px;height:62px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`;
  },

  /** Centered round reject badge — used on declined-action emails. */
  rejectIcon(): string {
    return `<img src="${escapeAttr(iconUrl('hero-reject'))}" alt="" width="62" height="62" style="display:block;margin:0 auto 20px;width:62px;height:62px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`;
  },

  /** Centered round chain/link badge — for linked-account success emails. */
  chainIcon(): string {
    return `<img src="${escapeAttr(iconUrl('icon-link'))}" alt="" width="62" height="62" style="display:block;margin:0 auto 20px;width:62px;height:62px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`;
  },

  /**
   * Amount block — paper-bg row bordered top + bottom, centered. Used on
   * deposit/wire/transfer success + decline emails. `currency` is the
   * 3-letter code rendered as a small uppercase prefix; `amount` is the
   * formatted number ("1,250.000"). `statusPill` is the rendered HTML
   * from `statusPill()` below.
   */
  amountBlock(opts: {
    label: string;
    currency: string;
    amount: string;
    statusPill: string;
  }): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAPER}" style="background-color:${PAPER};border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};margin:22px 0 24px;">
      <tr>
        <td bgcolor="${PAPER}" align="center" style="background-color:${PAPER};padding:22px 20px 24px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${GOLD_DEEP};margin-bottom:10px;">${escapeHtml(opts.label)}</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:${NAVY};line-height:1;margin-bottom:12px;letter-spacing:-.01em;">
            <span style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:${GOLD_DEEP};letter-spacing:.04em;margin-right:8px;vertical-align:2px;">${escapeHtml(opts.currency)}</span>${escapeHtml(opts.amount)}
          </div>
          ${opts.statusPill}
        </td>
      </tr>
    </table>`;
  },

  /**
   * Same `amountBlock`, but the "amount" line is rendered as a string
   * (e.g. "Ahli United Bank" or "Visa Debit ···· 4417") instead of a
   * currency amount. Used on the linked-account and linked-card emails.
   */
  identifierBlock(opts: {
    label: string;
    value: string;
    statusPill: string;
    /** Override the value's font-size (defaults to 24px). The card-linked
     *  template wants 22px + letter-spacing for the masked card number. */
    valueStyle?: string;
  }): string {
    const styleOverride = opts.valueStyle ?? 'font-size:24px;';
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAPER}" style="background-color:${PAPER};border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};margin:22px 0 24px;">
      <tr>
        <td bgcolor="${PAPER}" align="center" style="background-color:${PAPER};padding:22px 20px 24px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${GOLD_DEEP};margin-bottom:10px;">${escapeHtml(opts.label)}</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;color:${NAVY};line-height:1.1;margin-bottom:12px;${styleOverride}">${escapeHtml(opts.value)}</div>
          ${opts.statusPill}
        </td>
      </tr>
    </table>`;
  },

  /**
   * Status pill — green "ok" or red "no", with a small dot left of the
   * label. Designed to nest inside `amountBlock` / `identifierBlock`.
   */
  statusPill(opts: { kind: 'ok' | 'no'; label: string }): string {
    const isOk = opts.kind === 'ok';
    const fg = isOk ? '#1F8A5B' : '#B22B2B';
    const bg = isOk ? '#E5F1EA' : '#F5E0E0';
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
      <tr>
        <td bgcolor="${bg}" valign="middle" style="background-color:${bg};border-radius:30px;padding:5px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${fg};">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${fg};margin-right:8px;vertical-align:1px;"></span>${escapeHtml(opts.label)}
        </td>
      </tr>
    </table>`;
  },

  /**
   * Wrap a Gold CTA + an optional Ghost CTA on one row. On mobile the
   * mq inside wrapEmail collapses these into stacked full-width buttons
   * via the .body-card scope already; here we just emit the inline
   * Buttons themselves. Use this instead of buttonGold/buttonGhost
   * directly when you want them as a related pair.
   */
  ctaRow(primary: { label: string; href: string }, ghost?: { label: string; href: string }): string {
    const ghostHtml = ghost
      ? `<a href="${escapeAttr(ghost.href)}" style="display:inline-block;border:1.5px solid ${NAVY};color:${NAVY};text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:4px;margin-left:8px;">${escapeHtml(ghost.label)}</a>`
      : '';
    return `<p style="text-align:center;margin:24px 0 6px;"><a href="${escapeAttr(primary.href)}" style="display:inline-block;background:${GOLD};color:${NAVY_DEEP};text-decoration:none;font-size:15px;font-weight:700;padding:14px 30px;border-radius:4px;">${escapeHtml(primary.label)}</a>${ghostHtml}</p>`;
  },

  /** Solid gold rectangle CTA — used for "Track your application". */
  buttonGold(label: string, href: string): string {
    return `<p style="text-align:center;margin:26px 0 6px;"><a href="${escapeAttr(href)}" style="display:inline-block;background:${GOLD};color:${NAVY_DEEP};text-decoration:none;font-size:15px;font-weight:700;padding:14px 30px;border-radius:4px;">${escapeHtml(label)}</a></p>`;
  },

  /** Ghost (outlined) CTA — used for "This wasn't me — secure my account". */
  buttonGhost(label: string, href: string): string {
    return `<p style="text-align:center;margin:24px 0 6px;"><a href="${escapeAttr(href)}" style="display:inline-block;border:1.5px solid ${NAVY};color:${NAVY};text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:4px;">${escapeHtml(label)}</a></p>`;
  },

  /** Body paragraph (the design's default ebody p style). */
  para(html: string): string {
    return `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:${INK_SOFT};margin:0 0 16px;">${html}</p>`;
  },

  /** Strong span — for inline emphasis inside `.para`. */
  strong(text: string): string {
    return `<strong style="color:${INK};">${escapeHtml(text)}</strong>`;
  },

  /** Body h1 (the design's ebody h1 style). */
  h1(text: string): string {
    return `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:${NAVY};margin:0 0 14px;line-height:1.25;">${escapeHtml(text)}</h1>`;
  },
};

/** Wrap composed `bodyHtml` in the standard email shell. */
export function wrapEmail(opts: WrapEmailOptions): string {
  const tail =
    opts.footerTail ??
    `This is an automated message. Please do not reply. Need help? Contact <a href="mailto:support@cbbank.bh" style="color:${GOLD};text-decoration:none;">support@cbbank.bh</a> or call 8000 1234.`;

  const linksRow = opts.footerLinks?.length
    ? `<div style="margin-bottom:10px;">${opts.footerLinks
        .map(
          (l) =>
            `<a href="${escapeAttr(l.href)}" style="font-size:12px;font-weight:600;color:rgba(255,255,255,.8);margin-right:16px;text-decoration:none;">${escapeHtml(l.label)}</a>`,
        )
        .join('')}</div>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<!-- Opt out of Gmail / Apple Mail / Outlook auto-dark-mode. Several
     layers because no one client honours all of them: meta tags
     (modern clients), inline color-scheme (Apple Mail iOS), data-ogsc
     selectors (Outlook.com), and the bgcolor HTML attributes on every
     table cell below (Gmail Android — the most aggressive inverter). -->
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(opts.title)}</title>
<style type="text/css">
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body, table, td, div, p, h1, h2, h3, a { color-scheme: light only !important; }
  [data-ogsc] body, [data-ogsb] body { background: ${PAPER} !important; }
  [data-ogsc] .body-card, [data-ogsb] .body-card { background: ${WHITE} !important; }
  /* Force opaque white card body in Gmail dark mode */
  u + .body, .gmail-dark .body-card { background: ${WHITE} !important; color: ${INK} !important; }
  @media (prefers-color-scheme: dark) {
    .body-card { background: ${WHITE} !important; color: ${INK} !important; }
    .body-text { color: ${INK_SOFT} !important; }
    .body-h1   { color: ${NAVY} !important; }
  }
  /* Mobile shrinks */
  @media only screen and (max-width: 600px) {
    .ehead-cell { padding: 22px 24px !important; }
    .ebody-cell { padding: 28px 22px 24px !important; }
    .efoot-cell { padding: 22px 24px !important; }
    .body-h1   { font-size: 22px !important; }
    /* Security callout restacks: icon row on top with a bottom rule,
       copy below, both centred — mirrors the design's column layout.
       box-sizing:border-box keeps the cell padding INSIDE the 100% width
       so the block never overflows the card to the right. */
    .ecallout-ic, .ecallout-txt {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      text-align: center !important;
    }
    .ecallout-ic {
      border-right: none !important;
      border-bottom: 1px solid ${LINE} !important;
      padding: 14px 16px 12px !important;
    }
    .ecallout-ic img { margin: 0 auto !important; }
    .ecallout-txt { padding: 14px 18px 16px !important; font-size: 12.5px !important; }
  }
</style>
</head>
<body class="body" style="margin:0;padding:0;background-color:${PAPER};color-scheme:light only;-webkit-text-size-adjust:100%;" bgcolor="${PAPER}">

<!-- Preheader (hidden in client, shows in inbox preview) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAPER};">${escapeHtml(opts.title)}</div>

<!-- Outer paper canvas -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${PAPER}" style="background-color:${PAPER};">
  <tr>
    <td align="center" valign="top" style="padding:30px 18px;">

      <!-- 600px white card -->
      <table role="presentation" class="body-card" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="${WHITE}" style="max-width:600px;width:100%;background-color:${WHITE};border:1px solid ${LINE};">

        <!-- Header (warm brown) — PNG logo served by frontend Next.js
             at /lp2.png (override via EMAIL_LOGO_URL env). Width capped
             at 240px so it sits comfortably inside the 600px card; height
             auto-scales. -->
        <tr>
          <td class="ehead-cell" bgcolor="${NAVY}" align="left" style="background-color:${NAVY};padding:28px 36px;">
            <img src="${escapeAttr(LOGO_URL)}" alt="State Bank" width="240" height="54" style="display:block;height:54px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
          </td>
        </tr>

        <!-- Gold gradient hairline (fallback to solid for clients without gradient) -->
        <tr>
          <td bgcolor="${GOLD}" style="height:3px;line-height:3px;font-size:0;background-color:${GOLD};background:linear-gradient(90deg,${GOLD_DEEP},${GOLD},${GOLD_DEEP});">&nbsp;</td>
        </tr>

        <!-- Body -->
        <tr>
          <td class="ebody-cell" bgcolor="${WHITE}" align="left" style="background-color:${WHITE};padding:38px 40px 30px;font-family:Arial,Helvetica,sans-serif;color:${INK};">
            ${opts.bodyHtml}
          </td>
        </tr>

        <!-- Footer (near-black) -->
        <tr>
          <td class="efoot-cell" bgcolor="${NAVY_DEEP}" align="left" style="background-color:${NAVY_DEEP};padding:24px 40px;">
            ${linksRow}
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:rgba(255,255,255,.55);margin:0 0 8px;">© ${new Date().getFullYear()} State Bank · Block 317, Diplomatic Quarter, Manama, Bahrain</p>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:rgba(255,255,255,.55);margin:0;">${tail}</p>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
