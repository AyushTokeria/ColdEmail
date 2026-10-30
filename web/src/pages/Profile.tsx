import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { ProfileResult, parseWith } from '../ai/parse';
import { INDUSTRY_LIST } from '../ai/industries';
import { extractProfilePrompt } from '../ai/prompts';
import { CopyPasteFlow } from '../components/CopyPaste';
import { Alert, Field, Page, TagInput } from '../components/ui';
import { useProfile } from '../hooks';
import type { Activity, IndustryKey, ProfileData } from '../types';

const MAX_PDF_BYTES = 1_400_000;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function Profile() {
  const { data, isLoading } = useProfile();
  const qc = useQueryClient();
  const [p, setP] = useState<ProfileData>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (data && !dirty) setP(data.data);
  }, [data, dirty]);

  const set = <K extends keyof ProfileData>(k: K, v: ProfileData[K]) => {
    setP((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => api('/profile', { method: 'PUT', json: { data: p } }),
    onSuccess: () => {
      setDirty(false);
      setMsg({ kind: 'ok', text: 'Profile saved.' });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (e) => setMsg({ kind: 'error', text: errMsg(e) }),
  });

  const upload = useMutation({
    mutationFn: async (f: File) => {
      if (f.type !== 'application/pdf') throw new Error('Please choose a PDF file.');
      if (f.size > MAX_PDF_BYTES) throw new Error('That PDF is over 1.4 MB. Export a smaller one (no embedded images).');
      return api(`/profile/resume?filename=${encodeURIComponent(f.name)}`, { method: 'PUT', text: await toBase64(f) });
    },
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Resume uploaded. It will be attached to first emails.' });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (e) => setMsg({ kind: 'error', text: errMsg(e) }),
  });

  const removeResume = useMutation({
    mutationFn: () => api('/profile/resume', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  const activities = p.activities ?? [];
  const exps = p.experiences ?? [];

  return (
    <Page
      title="Your profile"
      actions={
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      }
    >
      {msg && (
        <div className="mb-4">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Resume</h2>
          {data?.resume ? (
            <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
              <span>
                {data.resume.filename} <span className="text-slate-500">({Math.round(data.resume.size / 1024)} KB)</span>
              </span>
              <button className="btn btn-danger" onClick={() => removeResume.mutate()}>
                Remove
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No resume uploaded yet.</p>
          )}
          <input type="file" accept="application/pdf" className="text-sm" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <p className="text-xs text-slate-500">PDF only, max 1.4 MB. Stored in your own database and attached to first emails if you leave that on.</p>

          <hr />
          <CopyPasteFlow
            title="Fill this form from your resume"
            help="Free: Claude reads your resume in the chat, you paste the result back, and the form below fills in. Check it before saving."
            attachNote="Attach your resume PDF to the claude.ai chat before sending."
            prompt={extractProfilePrompt(p)}
            onReply={(text) => {
              const r = parseWith(ProfileResult, text);
              if (!r.ok) return r.error;
              const v = r.value;
              setP((x) => ({
                ...x,
                name: v.name || x.name,
                schools: v.schools.length ? v.schools : x.schools,
                gradYear: v.gradYear || x.gradYear,
                major: v.major || x.major,
                highSchool: v.highSchool || x.highSchool,
                hometown: v.hometown || x.hometown,
                languages: v.languages.length ? v.languages : x.languages,
                experiences: v.experiences.length ? v.experiences : x.experiences,
                activities: v.activities.length ? v.activities : x.activities,
                interests: v.interests.length ? v.interests : x.interests,
              }));
              setDirty(true);
              setMsg({ kind: 'ok', text: 'Filled in from your resume. Review the fields, then click Save.' });
              return null;
            }}
          />
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">What we know about you</h2>
          <p className="text-xs text-slate-500">Shared connections are found by comparing these fields with each contact, so the unusual ones (high school, hometown, languages) matter most.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name" className="col-span-2">
              <input className="input" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Schools (main one first)" className="col-span-2">
              <TagInput value={p.schools ?? []} onChange={(v) => set('schools', v)} placeholder="New York University…" />
            </Field>
            <Field label="Grad year">
              <input className="input" value={p.gradYear ?? ''} onChange={(e) => set('gradYear', e.target.value)} />
            </Field>
            <Field label="Major">
              <input className="input" value={p.major ?? ''} onChange={(e) => set('major', e.target.value)} />
            </Field>
            <Field label="High school">
              <input className="input" value={p.highSchool ?? ''} onChange={(e) => set('highSchool', e.target.value)} />
            </Field>
            <Field label="Hometown (City, Region)">
              <input className="input" value={p.hometown ?? ''} onChange={(e) => set('hometown', e.target.value)} />
            </Field>
            <Field label="Languages" className="col-span-2">
              <TagInput value={p.languages ?? []} onChange={(v) => set('languages', v)} placeholder="Hindi, Spanish…" />
            </Field>
            <Field label="Interests" className="col-span-2">
              <TagInput value={p.interests ?? []} onChange={(v) => set('interests', v)} placeholder="Chess, running…" />
            </Field>
          </div>

          <div>
            <span className="label">Experience</span>
            <div className="space-y-2">
              {exps.map((e, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input className="input" placeholder="Company" value={e.org} onChange={(ev) => set('experiences', exps.map((x, j) => (j === i ? { ...x, org: ev.target.value } : x)))} />
                  <input className="input" placeholder="Role" value={e.role ?? ''} onChange={(ev) => set('experiences', exps.map((x, j) => (j === i ? { ...x, role: ev.target.value } : x)))} />
                  <button className="btn" onClick={() => set('experiences', exps.filter((_, j) => j !== i))} aria-label="Remove">
                    ×
                  </button>
                </div>
              ))}
              <button className="btn" onClick={() => set('experiences', [...exps, { org: '', role: '' }])}>
                + Add experience
              </button>
            </div>
          </div>

          <div>
            <span className="label">Clubs, teams and organizations</span>
            <div className="space-y-2">
              {activities.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                  <input className="input" placeholder="Name" value={a.name} onChange={(ev) => set('activities', activities.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
                  <select className="input" value={a.kind} onChange={(ev) => set('activities', activities.map((x, j) => (j === i ? { ...x, kind: ev.target.value as Activity['kind'] } : x)))}>
                    <option value="club">Club</option>
                    <option value="sport">Sport</option>
                    <option value="other">Other</option>
                  </select>
                  <button className="btn" onClick={() => set('activities', activities.filter((_, j) => j !== i))} aria-label="Remove">
                    ×
                  </button>
                </div>
              ))}
              <button className="btn" onClick={() => set('activities', [...activities, { name: '', kind: 'club' }])}>
                + Add activity
              </button>
            </div>
          </div>

          <div>
            <span className="label">Industries you are recruiting for</span>
            <div className="flex flex-wrap gap-3 text-sm">
              {INDUSTRY_LIST.map((i) => (
                <label key={i.key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={(p.targetIndustries ?? []).includes(i.key)}
                    onChange={(e) => set('targetIndustries', e.target.checked ? [...(p.targetIndustries ?? []), i.key as IndustryKey] : (p.targetIndustries ?? []).filter((k) => k !== i.key))}
                  />
                  {i.label}
                </label>
              ))}
            </div>
          </div>

          <Field label="Email signature (optional)">
            <textarea className="input h-20" placeholder={'Best,\nAyush Tokeria\nNYU \'27 | 555-123-4567'} value={p.signature ?? ''} onChange={(e) => set('signature', e.target.value)} />
          </Field>
        </section>
      </div>
    </Page>
  );
}
