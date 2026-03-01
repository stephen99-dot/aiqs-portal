import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, getToken, setToken, clearToken } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
