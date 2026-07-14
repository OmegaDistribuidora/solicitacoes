const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

let unauthorizedHandler = null;

async function request(path, { token, headers = {}, body, method = "GET" } = {}) {
  const hasJsonBody = body != null && !(body instanceof FormData);
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body)
  });

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (!response.ok) {
    let message = "Falha na requisicao.";
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch (error) {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  return response.status === 204 ? null : response.json();
}

export function apiJson(path, { token, method = "GET", data } = {}) {
  return request(path, { token, method, body: data });
}

export function apiFormData(path, { token, method = "POST", data } = {}) {
  return request(path, { token, method, body: data });
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}
