import { toB64 } from './crypto';

const enc = new TextEncoder();

function wrap76(s: string): string {
  return s.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
}

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  // Split on code points so no encoded word cuts a multi-byte character; keep each word short.
  const words: string[] = [];
  let cur = '';
  for (const ch of value) {
    if (enc.encode(cur + ch).length > 40) {
      words.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${toB64(enc.encode(w))}?=`).join('\r\n ');
}

export interface MimeInput {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachment?: { filename: string; mime: string; b64: string };
  boundary?: string;
}

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

/** Builds an RFC 822 message. The attachment must already be base64 (stored that way in D1). */
export function buildMime(m: MimeInput): string {
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
  ];
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references) headers.push(`References: ${m.references}`);

  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(toB64(enc.encode(crlf(m.body)))),
  ].join('\r\n');

  if (!m.attachment) return [...headers, textPart].join('\r\n');

  const boundary = m.boundary ?? `=_cold_${crypto.randomUUID()}`;
  const safeName = m.attachment.filename.replace(/["\r\n]/g, '');
  const attPart = [
    `Content-Type: ${m.attachment.mime}; name="${encodeHeader(safeName)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${encodeHeader(safeName)}"`,
    '',
    m.attachment.b64,
  ].join('\r\n');

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    textPart,
    `--${boundary}`,
    attPart,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
