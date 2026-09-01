import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize admin-authored (Tiptap) HTML before it is sent as an email and
 * stored. Although the author is a trusted admin, we still strip scripts,
 * event handlers, and dangerous URL schemes — an admin account could be
 * compromised, and the same HTML is later rendered back into the dashboard
 * thread view. Allows the formatting Tiptap emits plus images and links.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'span', 'div',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'a', 'img',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4',
    'blockquote', 'pre', 'code',
    'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    span: ['style'],
    div: ['style'],
    p: ['style'],
    td: ['style', 'colspan', 'rowspan'],
    th: ['style', 'colspan', 'rowspan'],
  },
  // Only safe URL schemes; `cid:` lets inline images reference attachments.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
  // Constrain inline styles to a harmless subset (colour / weight / align).
  allowedStyles: {
    '*': {
      color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z-]+$/i],
      'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z-]+$/i],
      'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
      'font-weight': [/^\d+$/, /^bold$/, /^normal$/],
      'font-style': [/^italic$/, /^normal$/],
      'text-decoration': [/^underline$/, /^line-through$/, /^none$/],
      width: [/^\d+(?:px|%)$/],
      height: [/^\d+(?:px|%)$/],
    },
  },
  // Force external links to open safely.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html ?? '', OPTIONS);
}

/** Best-effort plain-text fallback derived from the sanitized HTML. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
