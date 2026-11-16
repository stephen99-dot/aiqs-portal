import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, getToken, setToken, clearToken } from '../utils/api';
import { setPriceViewer } from '../utils/planPrice';
import { disablePushForUser } from '../native/push';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Plan prices read the viewer's currency (see utils/planPrice.js). Set
  // during render so the first paint after sign-in already has it.
  setPriceViewer(user);

  useEffect(() => {
    const token = getToken();
    if (token) {
      apiFetch('/auth/me')
        .then(setUser)
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function refreshUser() {
    try {
      const freshUser = await apiFetch('/auth/me');
      setUser(freshUser);
      return freshUser;
    } catch (err) {
      console.error('Failed to refresh user:', err);
      return null;
    }
  }

  async function login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function loginWithToken(token, userData) {
    setToken(token);
    setUser(userData);
  }

  async function register(fields) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(fields),
    });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    // In the app: stop this phone getting the account's notifications. Called
    // (not awaited) before the token is cleared — the request picks the token
    // up synchronously as it starts.
    disablePushForUser();
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, loginWithToken, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
