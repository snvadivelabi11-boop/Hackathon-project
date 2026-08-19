import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingSpinner } from './LoadingSpinner';
import { Result, Button } from 'antd';

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export const AdminProtectedRoute: React.FC<AdminProtectedRouteProps> = ({ children }) => {
  const { user, isAdmin, authLoading } = useAuth();
  const location = useLocation();

  // 1. While authentication or role verification is initializing, show loading screen (DO NOT REDIRECT)
  if (authLoading) {
    return <LoadingSpinner tip="Verifying Administrator Authorization..." />;
  }

  // 2. If unauthenticated, redirect to dedicated Admin Login page
  if (!user) {
    return <Navigate to="/admin" state={{ from: location }} replace />;
  }

  // 3. If authenticated as a non-admin account (e.g. Team participant), block access with 403 Forbidden
  if (!isAdmin) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          padding: 24,
        }}
      >
        <div style={{ background: '#1e293b', padding: 32, borderRadius: 16, maxWidth: 500, width: '100%', textAlign: 'center' }}>
          <Result
            status="403"
            title={<span style={{ color: '#f87171', fontWeight: 800 }}>403 — ACCESS FORBIDDEN</span>}
            subTitle={
              <span style={{ color: '#94a3b8' }}>
                Your account does not possess Administrator authorization. Normal team participants cannot access the Administrator Console.
              </span>
            }
            extra={
              <Button
                type="primary"
                onClick={() => window.location.replace('/team/dashboard')}
                style={{ background: '#2563eb', borderRadius: 8 }}
              >
                Return to Team Dashboard
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // 4. If account disabled, redirect to login
  if (user.status === 'disabled') {
    return <Navigate to="/admin" replace />;
  }

  // 5. Authorized Admin: render protected dashboard layout and child routes
  return <>{children}</>;
};
