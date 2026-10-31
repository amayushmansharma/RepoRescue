import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../services/api-client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [scopes, setScopes] = useState([]);
  const [hasWriteScope, setHasWriteScope] = useState(false);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [remember, setRemember] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getSession().catch(() => ({ authenticated: false, user: null, scopes: [], hasWriteScope: false, requiresReauth: false, remember: false, expiresAt: null })),
      api.getAuthConfig().catch(() => ({ configured: false, provider: "github", clientId: null })),
    ]).then(([sessionData, configData]) => {
      if (cancelled) return;
      if (sessionData?.authenticated && sessionData.user) {
        setUser(sessionData.user);
        setAuthenticated(true);
        setScopes(sessionData.scopes || []);
        setHasWriteScope(Boolean(sessionData.hasWriteScope));
        setRequiresReauth(Boolean(sessionData.requiresReauth));
        setRemember(Boolean(sessionData.remember));
        setExpiresAt(sessionData.expiresAt ?? null);
      } else {
        setUser(null);
        setAuthenticated(false);
        setScopes([]);
        setHasWriteScope(false);
        setRequiresReauth(false);
        setRemember(false);
        setExpiresAt(null);
      }
      setAuthConfig(configData);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  const refreshSession = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setAuthenticated(false);
      setScopes([]);
      setHasWriteScope(false);
      setRequiresReauth(false);
      setRemember(false);
      setExpiresAt(null);
    }
  }, []);

  const value = {
    user,
    authenticated,
    scopes,
    hasWriteScope,
    requiresReauth,
    remember,
    expiresAt,
    loading,
    authConfig,
    logout,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
