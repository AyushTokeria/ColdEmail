import { useState } from 'react';
import { tokenEstimate } from '../ai/prompts';
import { Alert, CopyButton } from './ui';

/**
 * The free "AI" step: the user copies a prompt into claude.ai, then pastes the reply back.
 * `onReply` returns an error string to show, or null on success.
 */
export function CopyPasteFlow({
  prompt,
  title,
  help,
  onReply,
  attachNote,
}: {
  prompt: string;
  title: string;
  help?: string;
  attachNote?: string;
  onReply: (reply: string) => string | null | Promise<string | null>;
}) {
  const [reply, setReply] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokens = tokenEstimate(prompt);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {help && <p className="text-sm text-slate-600">{help}</p>}
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={prompt} label="Copy prompt" primary />
            <a className="btn" href="https://claude.ai/new" target="_blank" rel="noreferrer">
              Open claude.ai ↗
            </a>
            <span className="text-xs text-slate-500">~{tokens.toLocaleString()} tokens</span>
          </div>
          {attachNote && <p className="mt-1 text-xs text-amber-700">{attachNote}</p>}
          <details className="mt-1 text-xs text-slate-500">
            <summary className="cursor-pointer">Show prompt</summary>
            <textarea readOnly className="input mt-1 h-40 font-mono text-xs" value={prompt} />
          </details>
        </li>
        <li>Paste it into a new chat and send it.</li>
        <li>
          Paste Claude's full reply here:
          <textarea className="input mt-1 h-32 font-mono text-xs" placeholder="Paste the reply (the JSON code block)…" value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn btn-primary"
              disabled={!reply.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  const e = await onReply(reply);
                  if (e) setErr(e);
                  else setReply('');
                } catch (x) {
                  setErr(x instanceof Error ? x.message : String(x));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Reading…' : 'Read reply'}
            </button>
          </div>
          {err && (
            <div className="mt-2">
              <Alert>{err}</Alert>
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}
