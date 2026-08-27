import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import ToastHost from './components/common/Toast';

function Protected({ children, admin = false }) {
  const { user, booting } = useAuth();
  if (booting) return <div className="boot-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route path="/verify-email" element={<AuthPage mode="verify-email" />} />

        <Route
          path="/app/*"
          element={
            <Protected>
              <ChatPage />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <SettingsPage />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected admin>
              <AdminPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
      <ToastHost />
    </>
  );
}
