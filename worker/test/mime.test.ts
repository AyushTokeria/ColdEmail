import { describe, expect, it } from 'vitest';
import { buildMime, encodeHeader } from '../src/mime';
import { decrypt, encrypt, signState, verifyState } from '../src/crypto';

describe('encodeHeader', () => {
  it('leaves ASCII alone and encodes the rest', () => {
    expect(encodeHeader('Hello there')).toBe('Hello there');
    expect(encodeHeader('Café — chat?')).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
});

describe('buildMime', () => {
  it('builds a threaded plain message', () => {
    const raw = buildMime({
      from: 'me@x.com',
      to: 'you@y.com',
      subject: 'Re: Hi',
      body: 'line1\nline2',
      inReplyTo: '<a@b>',
      references: '<a@b>',
    });
    expect(raw).toContain('In-Reply-To: <a@b>');
    expect(raw).toContain('References: <a@b>');
    expect(raw).not.toContain('multipart');
    const b64 = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(atob(b64)).toBe('line1\r\nline2');
  });

  it('adds an attachment part with a closed boundary', () => {
    const raw = buildMime({
      from: 'me@x.com',
      to: 'you@y.com',
      subject: 'Hi',
      body: 'hello',
      boundary: 'BOUND',
      attachment: { filename: 'Résumé.pdf', mime: 'application/pdf', b64: 'QUJD' },
    });
    expect(raw).toContain('multipart/mixed; boundary="BOUND"');
    expect(raw.match(/--BOUND\r\n/g)).toHaveLength(2);
    expect(raw.trimEnd().endsWith('--BOUND--')).toBe(true);
    expect(raw).toContain('QUJD');
  });
});

describe('crypto', () => {
  it('round-trips AES-GCM and rejects the wrong key', async () => {
    const blob = await encrypt('secret', 'refresh-token-123');
    expect(await decrypt('secret', blob)).toBe('refresh-token-123');
    await expect(decrypt('other', blob)).rejects.toThrow();
  });
  it('verifies signed state and rejects tampering', async () => {
    const s = await signState('k');
    expect(await verifyState('k', s)).toBe(true);
    expect(await verifyState('k2', s)).toBe(false);
    expect(await verifyState('k', 'x' + s)).toBe(false);
    expect(await verifyState('k', await signState('k', -1))).toBe(false);
  });
});
