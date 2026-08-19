import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ProtectedRoute } from '../components/common/ProtectedRoute';
import { AdminProtectedRoute } from '../components/common/AdminProtectedRoute';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { LoginPage } from '../pages/auth/LoginPage';
import { AdminLoginPage } from '../pages/auth/AdminLoginPage';
import { PublicSelectionPage } from '../pages/public/PublicSelectionPage';

// Admin Pages
import { AdminLayout } from '../components/admin/AdminLayout';
import { AdminDashboard } from '../pages/admin/AdminDashboard';
import { TeamsPage } from '../pages/admin/TeamsPage';
import { ProblemStatementsPage } from '../pages/admin/ProblemStatementsPage';
import { RoundsPage } from '../pages/admin/RoundsPage';
import { SubmissionsPage } from '../pages/admin/SubmissionsPage';
import { EvaluationsPage } from '../pages/admin/EvaluationsPage';
import { AIAnalyticsPage } from '../pages/admin/AIAnalyticsPage';
import { SelectionPage } from '../pages/admin/SelectionPage';
import { CertificatesPage } from '../pages/admin/CertificatesPage';
import { ResultsPage } from '../pages/admin/ResultsPage';
import { AuditLogsPage } from '../pages/admin/AuditLogsPage';
import { SettingsPage } from '../pages/admin/SettingsPage';

// Team Pages
import { TeamLayout } from '../components/team/TeamLayout';
import { TeamDashboard } from '../pages/team/TeamDashboard';
import { TeamProblemStatementPage } from '../pages/team/TeamProblemStatementPage';
import { Round1Page } from '../pages/team/Round1Page';
import { Round2Page } from '../pages/team/Round2Page';
import { Round3Page } from '../pages/team/Round3Page';
import { TeamScoresPage } from '../pages/team/TeamScoresPage';
import { TeamSelectionStatusPage } from '../pages/team/TeamSelectionStatusPage';
import { TeamCertificatesPage } from '../pages/team/TeamCertificatesPage';

export const AppRoutes: React.FC = () => {
  const { user, isAdmin, isTeam, authLoading } = useAuth();

  return (
    <Routes>
      {/* Public Selection Announcement */}
      <Route path="/selection" element={<PublicSelectionPage />} />

      {/* Public Team Login Route */}
      <Route
        path="/login"
        element={
          authLoading ? (
            <LoadingSpinner tip="Authenticating..." minHeight="100vh" />
          ) : user ? (
            isAdmin ? (
              <Navigate to="/admin/dashboard" replace />
            ) : (
              <Navigate to="/team/dashboard" replace />
            )
          ) : (
            <LoginPage />
          )
        }
      />

      {/* Admin Route Hierarchy */}
      <Route path="/admin">
        {/* Unauthenticated: Dedicated Admin Login / Authenticated: Auto-redirect */}
        <Route
          index
          element={
            authLoading ? (
              <LoadingSpinner tip="Verifying Administrator Authorization..." minHeight="100vh" />
            ) : user && isAdmin ? (
              <Navigate to="/admin/dashboard" replace />
            ) : (
              <AdminLoginPage />
            )
          }
        />

        {/* Protected Admin Console Routes */}
        <Route
          element={
            <AdminProtectedRoute>
              <AdminLayout />
            </AdminProtectedRoute>
          }
        >
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="problems" element={<ProblemStatementsPage />} />
          <Route path="rounds" element={<RoundsPage />} />
          <Route path="submissions" element={<SubmissionsPage />} />
          <Route path="evaluations" element={<EvaluationsPage />} />
          <Route path="analytics" element={<AIAnalyticsPage />} />
          <Route path="selection" element={<SelectionPage />} />
          <Route path="certificates" element={<CertificatesPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>
      </Route>

      {/* Team Route Hierarchy */}
      <Route path="/team">
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          element={
            <ProtectedRoute allowedRoles={['team']}>
              <TeamLayout />
            </ProtectedRoute>
          }
        >
          <Route path="dashboard" element={<TeamDashboard />} />
          <Route path="problem-statement" element={<TeamProblemStatementPage />} />
          <Route path="round1" element={<Round1Page />} />
          <Route path="round2" element={<Round2Page />} />
          <Route path="round3" element={<Round3Page />} />
          <Route path="scores" element={<TeamScoresPage />} />
          <Route path="selection" element={<TeamSelectionStatusPage />} />
          <Route path="certificates" element={<TeamCertificatesPage />} />
          <Route path="*" element={<Navigate to="/team/dashboard" replace />} />
        </Route>
      </Route>

      {/* Root redirection based on role */}
      <Route
        path="/"
        element={
          authLoading ? (
            <LoadingSpinner tip="Authenticating..." minHeight="100vh" />
          ) : user ? (
            isAdmin ? (
              <Navigate to="/admin/dashboard" replace />
            ) : (
              <Navigate to="/team/dashboard" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Catch-all fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
