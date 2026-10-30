const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const KEY = 'coldemails.token';

export const getToken = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
};

export const loginUrl = () => `${BASE}/auth/login`;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; json?: unknown; text?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.text !== undefined) {
    headers['content-type'] = 'text/plain';
    body = init.text;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { method: init.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError('Could not reach the server. Is the Worker running and is VITE_API_URL correct?', 0);
  }
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('coldemails:logout'));
    throw new ApiError('Signed out', 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
