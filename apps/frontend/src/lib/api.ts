/** HTTP-клиент API с автоматическим обновлением токена доступа */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const ACCESS_KEY = 'sm.accessToken';
const REFRESH_KEY = 'sm.refreshToken';

export class ApiError extends Error {
  status: number;
  errors: string[];
  details: unknown;

  constructor(status: number, message: string, errors: string[] = [], details?: unknown) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.details = details;
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно */
  }
}

export const tokenStore = {
  get access() {
    return safeGet(ACCESS_KEY);
  },
  get refresh() {
    return safeGet(REFRESH_KEY);
  },
  set(access: string | null, refresh: string | null) {
    safeSet(ACCESS_KEY, access);
    safeSet(REFRESH_KEY, refresh);
  },
  clear() {
    safeSet(ACCESS_KEY, null);
    safeSet(REFRESH_KEY, null);
  },
};

type Listener = () => void;
const logoutListeners = new Set<Listener>();
export function onForcedLogout(listener: Listener) {
  logoutListeners.add(listener);
  return () => {
    logoutListeners.delete(listener);
  };
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        tokenStore.set(body.accessToken, body.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  let body: { message?: string; errors?: string[]; details?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    /* ответ без тела */
  }
  const fallback =
    res.status === 0 || res.status >= 500
      ? 'Сервер недоступен или произошла внутренняя ошибка. Повторите попытку позже'
      : 'Не удалось выполнить запрос';
  return new ApiError(res.status, body.message || fallback, body.errors ?? [], body.details);
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
  signal?: AbortSignal;
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const token = tokenStore.access;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Нет соединения с сервером. Проверьте подключение к сети');
  }
  if (res.status === 401 && retry && path !== '/auth/login' && path !== '/auth/refresh') {
    const ok = await refreshTokens();
    if (ok) return request<T>(method, path, body, options, false);
    tokenStore.clear();
    logoutListeners.forEach((l) => l());
  }
  if (!res.ok) throw await toError(res);
  if (options.raw) return (await res.blob()) as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], options: RequestOptions = {}) =>
    request<T>('GET', path, undefined, { ...options, query }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body ?? {}, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body ?? {}, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body ?? {}, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
  upload: <T>(path: string, file: File, field = 'file') => {
    const form = new FormData();
    form.append(field, file);
    return request<T>('POST', path, form);
  },
};

/** Скачивание файла (PDF/Excel) с авторизацией */
export async function downloadFile(path: string, query?: RequestOptions['query'], fallbackName = 'файл') {
  const token = tokenStore.access;
  let res = await fetch(buildUrl(path, query), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401 && (await refreshTokens())) {
    res = await fetch(buildUrl(path, query), { headers: { Authorization: `Bearer ${tokenStore.access}` } });
  }
  if (!res.ok) throw await toError(res);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Неизвестная ошибка';
}
