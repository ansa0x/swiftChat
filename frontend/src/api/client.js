import axios from "axios";

export const API_BASE_URL = "http://localhost:5000/api";
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
