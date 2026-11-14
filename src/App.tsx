import { useEffect, type ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import AppLayout from './components/layout/AppLayout';
import ToastViewport from './components/ui/Toast';
import DashboardPage from './pages/DashboardPage';
import ExpensesPage from './pages/ExpensesPage';
import GroupsPage from './pages/GroupsPage';
import LoginPage from './pages/LoginPage';
import PaymentsPage from './pages/PaymentsPage';
import SettingsPage from './pages/SettingsPage';
import StudentDetailPage from './pages/StudentDetailPage';
import StudentsPage from './pages/StudentsPage';
import TeacherDetailPage from './pages/TeacherDetailPage';
import TeachersPage from './pages/TeachersPage';
import TimetablePage from './pages/TimetablePage';
import TrashPage from './pages/TrashPage';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAuthStore } from './stores/authStore';

/**
 * Guards the app shell.
 *
 * - Setup not completed -> /login (which renders the setup card).
 * - Not authenticated    -> /login.
 * - Locked               -> the route stays mounted and `LockScreen` overlays
 *                           it from within AppLayout (no redirect, so unlocking
 *                           restores the same page).
 */
function ProtectedRoute({ children }: { children: ReactElement }) {
  const isSetup = useAuthStore((state) => state.isSetup);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isSetup) return <Navigate to="/login" replace />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/** Shown while the database is being consulted on startup. */
function BootSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <img src="/logo.svg" alt="" className="h-14 w-14" aria-hidden="true" />
      <Loader2 className="h-5 w-5 animate-spin text-muted" aria-hidden="true" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

export function App() {
  const initialized = useAuthStore((state) => state.initialized);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  // Ctrl+K / Ctrl+L / Escape, registered once for the whole app.
  useKeyboardShortcuts();

  // Ask the backend once: setup done? what is the centre name?
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!initialized) return <BootSplash />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public route — no app shell */}
        <Route path="/login" element={<LoginPage />} />

        {/* Authenticated routes wrapped in the sidebar/header shell */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          {/* Every screen is isolated: a rendering error in one page must not
              take the sidebar, the header or the data of the others with it. */}
          <Route
            path="/"
            element={
              <ErrorBoundary key="dashboard" scope="dashboard">
                <DashboardPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/students"
            element={
              <ErrorBoundary key="students" scope="students">
                <StudentsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/students/:id"
            element={
              <ErrorBoundary key="student-detail" scope="student-detail">
                <StudentDetailPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/groups"
            element={
              <ErrorBoundary key="groups" scope="groups">
                <GroupsPage />
              </ErrorBoundary>
            }
          />
          {/* Phase 13 — the weekly timetable, right after the groups it draws. */}
          <Route
            path="/timetable"
            element={
              <ErrorBoundary key="timetable" scope="timetable">
                <TimetablePage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/teachers"
            element={
              <ErrorBoundary key="teachers" scope="teachers">
                <TeachersPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/teachers/:id"
            element={
              <ErrorBoundary key="teacher-detail" scope="teacher-detail">
                <TeacherDetailPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/payments"
            element={
              <ErrorBoundary key="payments" scope="payments">
                <PaymentsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/expenses"
            element={
              <ErrorBoundary key="expenses" scope="expenses">
                <ExpensesPage />
              </ErrorBoundary>
            }
          />
          <Route path="/trash" element={<ErrorBoundary key="trash" scope="trash"><TrashPage /></ErrorBoundary>} />
          <Route
            path="/settings"
            element={
              <ErrorBoundary key="settings" scope="settings">
                <SettingsPage />
              </ErrorBoundary>
            }
          />

        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ToastViewport />
    </BrowserRouter>
  );
}

export default App;
