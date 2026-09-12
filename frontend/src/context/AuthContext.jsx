import { createContext, useCallback, useContext, useMemo, useState } from "react";

import client, { TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from "../api/client.js";

const AuthContext = createContext(null);

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupt entry — treat it as logged out rather than crashing on boot.
    return null;
  }
};

// The backend returns { message } on failure, plus { field } on a 409 conflict.
// Both are carried through so forms can show the message and flag the input.
const toAuthError = (error, fallback) => {
  const data = error?.response?.data;
  const authError = new Error(data?.message ?? error?.message ?? fallback);

  authError.status = error?.response?.status ?? null;
  authError.field = data?.field ?? null;

  return authError;
};

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState(readStoredUser);

  const persistSession = useCallback((nextToken, nextUser) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email, password) => {
      try {
        const { data } = await client.post("/auth/login", { email, password });
        persistSession(data.token, data.user);
        return data.user;
      } catch (error) {
        throw toAuthError(error, "Could not log in.");
      }
    },
    [persistSession]
  );

  const register = useCallback(
    async (username, email, password) => {
      try {
        const { data } = await client.post("/auth/register", {
          username,
          email,
          password,
        });
        persistSession(data.token, data.user);
        return data.user;
      } catch (error) {
        throw toAuthError(error, "Could not register.");
      }
    },
    [persistSession]
  );

  // Merges a partial update into the cached user (e.g. a new profile photo)
  // and keeps localStorage in step so it survives a refresh.
  const updateUser = useCallback((patch) => {
    setUser((current) => {
      const next = { ...(current ?? {}), ...patch };
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      login,
      register,
      logout,
      updateUser,
    }),
    [user, token, login, register, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }

  return context;
};

export default AuthContext;
