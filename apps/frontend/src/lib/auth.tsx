import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onForcedLogout, tokenStore } from './api';
import type { LoginResponse, User, UserRole } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  canEdit: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    if (!tokenStore.access) {
      setLoading(false);
      return;
    }
    api
      .get<User>('/auth/me')
      .then((me) => active && setUser(me))
      .catch(() => {
        tokenStore.clear();
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      onForcedLogout(() => {
        setUser(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    tokenStore.set(res.accessToken, res.refreshToken);
    const me = await api.get<User>('/auth/me');
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* токен мог истечь */
    }
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      hasRole: (...roles) => !!user && roles.includes(user.role),
      canEdit: !!user && (user.role === 'ADMIN' || user.role === 'DISPATCHER'),
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
