import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from './api';
import i18n from './i18n';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { api.get('/auth/me').then(async ({ data }) => { setUser(data.user); const language = data.user?.language; if (language) { localStorage.setItem('weeware-language', language); await i18n.changeLanguage(language); } }).catch(() => setUser(null)).finally(() => setReady(true)); }, []);
  const value = useMemo(() => ({ user, setUser, ready, async signIn(credentials) { const { data } = await api.post('/auth/login', credentials); setUser(data.user); if (data.user?.language) { localStorage.setItem('weeware-language', data.user.language); await i18n.changeLanguage(data.user.language); } return data.user; }, async signUp(payload) { const { data } = await api.post('/auth/signup', payload); return data; }, async verifySignup(payload) { const { data } = await api.post('/auth/signup/verify', payload); return data; }, async forgotPassword(email) { const { data } = await api.post('/auth/password/forgot', { email }); return data; }, async resetPassword(payload) { const { data } = await api.post('/auth/password/reset', payload); return data; }, async signOut() { try { await api.post('/auth/logout'); } catch { /* Always clear the local session and leave the app even if the API is unavailable. */ } finally { setUser(null); } } }), [user, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);

