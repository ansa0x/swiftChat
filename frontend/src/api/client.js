import axios from "axios";

/**
 * Origin of the backend, e.g. https://swiftchat-api.onrender.com.
 *
 * VITE_API_URL holds the origin only, with no /api suffix, because the socket
 * connection needs the bare origin while REST calls need the prefix. Trailing
 * slashes are trimmed so a value like "http://host:5000/" doesn't produce a
 * double slash.
 */
export const API_ORIGIN = (
  import.meta.env.VITE_API_URL ?? "http://localhost:5000"
).replace(/\/+$/, "");

export const API_BASE_URL = `${API_ORIGIN}/api`;
export const TOKEN_STORAGE_KEY = "swiftchat_token";
export const USER_STORAGE_KEY = "swiftchat_user";

const client = axios.create({
  baseURL: API_BASE_URL,
});

export const getStoredToken = () => localStorage.getItem(TOKEN_STORAGE_KEY);

// Read from localStorage per request rather than capturing it once, so a login
// or logout in another tab is picked up without reloading the page.
client.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default client;
