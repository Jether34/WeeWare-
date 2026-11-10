import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Home from './pages/Home';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/AuthPages';
import PredictionPage from './pages/PredictionPage';
import { HistoryPage, SavedPage } from './pages/HistoryPages';
import SettingsPage from './pages/SettingsPage';
import MessagesPage from './pages/MessagesPage';
import ForumPage from './pages/ForumPage';
import UserProfilePage from './pages/UserProfilePage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import DADashboardPage from './pages/DADashboardPage';
import { FarmerAIPage } from './pages/RoleMockPages';
import ResearcherDashboardPage from './pages/ResearcherDashboardPage';

function Protected({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="loading-screen">Loading WeeWare…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RoleProtected({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <main className="page"><section className="card role-denied"><h1>Dashboard access restricted</h1><p>Your account does not have permission to view this dashboard.</p></section></main>;
  return children;
}

function LegacyRedirect() {
  const { search } = useLocation();
  const page = new URLSearchParams(search).get('page');
  const routes = { map: '/app/prediction', home: '/app/prediction', calendar: '/app/prediction', climate: '/app/prediction', climatedata: '/app/prediction', prediction: '/app/prediction', history: '/app/history', 'saved-predictions': '/app/saved', forum: '/app/messages', actions: '/app/messages', messages: '/app/messages', settings: '/app/settings', login: '/login', signup: '/signup' };
  return <Navigate to={routes[page] || '/'} replace />;
}
// the baddiest bitches are in tech
export default function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/index.php" element={<LegacyRedirect />} />
    <Route path="/dashboard" element={<Navigate to="/app/prediction" replace />} />
    <Route path="/app/map" element={<Navigate to="/app/prediction" replace />} />
    <Route path="/app/home" element={<Navigate to="/app/prediction" replace />} />
    <Route path="/app/dashboard" element={<Navigate to="/app/prediction" replace />} />
    <Route path="/app/predict" element={<Navigate to="/app/prediction" replace />} />
    <Route path="/app" element={<Protected><Layout /></Protected>}>
      <Route index element={<Navigate to="prediction" replace />} />
      <Route path="prediction" element={<PredictionPage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="saved" element={<SavedPage />} />
      <Route path="forum" element={<ForumPage />} />
      <Route path="profile/:id" element={<UserProfilePage />} />
      <Route path="messages" element={<MessagesPage />} />
      <Route path="ai" element={<FarmerAIPage />} />
      <Route path="system-iteration" element={<RoleProtected roles={['researcher']}><ResearcherDashboardPage /></RoleProtected>} />
      <Route path="admin" element={<RoleProtected roles={['admin']}><AdminDashboardPage /></RoleProtected>} />
      <Route path="da" element={<RoleProtected roles={['da', 'admin']}><DADashboardPage /></RoleProtected>} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<main className="page"><h1>Page not found</h1><a href="/">Return home</a></main>} />
  </Routes>;
}

