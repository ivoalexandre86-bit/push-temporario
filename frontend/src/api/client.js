// Thin fetch wrapper: cookie-based session auth, CSRF header, JSON in/out,
// consistent error shape ({ status, code, message, details }).
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, isForm = false, headers = {} } = {}) {
  const opts = {
    method,
    credentials: 'include',
    headers: {
      'X-Requested-With': 'ProjetosApp',
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  };
  if (body !== undefined) {
    opts.body = isForm ? body : JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, opts);

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', 'Ocorreu um erro inesperado.');
    return res; // caller handles binary/blob responses (exports)
  }

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data.error, data.message || 'Ocorreu um erro.', data.details);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  postForm: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true }),
};

export async function downloadFile(path, filenameFallback) {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'ProjetosApp' },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error, data.message || 'Falha ao gerar exportação.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : filenameFallback;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export { ApiError, BASE_URL };
