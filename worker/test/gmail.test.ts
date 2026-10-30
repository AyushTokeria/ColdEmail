import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkThread, sendMessage } from '../src/gmail';

afterEach(() => vi.unstubAllGlobals());

describe('sendMessage', () => {
  it('uploads multipart/related with threadId metadata and the raw RFC 822 message', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'm1', threadId: 't1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await sendMessage({
      token: 'tok',
      from: 'me@x.com',
      to: 'jane@y.com',
      subject: 'Re: Hello',
      body: 'Hi Jane',
      threadId: 't0',
      inReplyTo: '<abc@mail.gmail.com>',
      attachment: { filename: 'cv.pdf', mime: 'application/pdf', b64: 'QUJD' },
    });
    expect(r).toEqual({ id: 'm1', threadId: 't1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    const boundary = /boundary=(.+)$/.exec(headers['content-type'])![1];
    const body = init.body as string;
    expect(body.startsWith(`--${boundary}\r\nContent-Type: application/json`)).toBe(true);
    expect(body).toContain('{"threadId":"t0"}');
    expect(body).toContain('Content-Type: message/rfc822');
    expect(body).toContain('In-Reply-To: <abc@mail.gmail.com>');
    expect(body).toContain('References: <abc@mail.gmail.com>');
    expect(body).toContain('To: jane@y.com');
    expect(body.endsWith(`--${boundary}--`)).toBe(true);
  });

  it('throws a readable error on API failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 429 })));
    await expect(sendMessage({ token: 't', from: 'a@b', to: 'c@d', subject: 's', body: 'b' })).rejects.toThrow(/429/);
  });
});

describe('checkThread', () => {
  const thread = (froms: string[]) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: froms.map((f) => ({ payload: { headers: [{ name: 'From', value: f }] } })) }), { status: 200 })));

  it('ignores my own messages', async () => {
    thread(['Me <me@x.com>']);
    expect(await checkThread('t', 'th', 'me@x.com')).toBe('none');
  });
  it('detects a reply', async () => {
    thread(['Me <me@x.com>', 'Jane <jane@y.com>']);
    expect(await checkThread('t', 'th', 'ME@x.com')).toBe('replied');
  });
  it('detects a bounce', async () => {
    thread(['Me <me@x.com>', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>']);
    expect(await checkThread('t', 'th', 'me@x.com')).toBe('bounced');
  });
});
