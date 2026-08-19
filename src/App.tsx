import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import { AuthProvider } from './contexts/AuthContext';
import { SessionProvider } from './contexts/SessionContext';
import { ScoringProvider } from './contexts/ScoringContext';
import { AppRoutes } from './routes/AppRoutes';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#1677ff',
            colorInfo: '#1677ff',
            colorSuccess: '#16a34a',
            colorWarning: '#d97706',
            colorError: '#dc2626',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            borderRadius: 8,
            wireframe: false,
          },
          components: {
            Button: {
              controlHeight: 38,
              borderRadius: 8,
            },
            Card: {
              headerFontSize: 16,
              headerHeight: 52,
            },
            Table: {
              headerBg: '#fafafa',
              headerColor: '#1e293b',
              rowHoverBg: '#f8fafc',
            },
          },
        }}
      >
        <AntdApp>
          <BrowserRouter>
            <AuthProvider>
              <SessionProvider>
                <ScoringProvider>
                  <AppRoutes />
                </ScoringProvider>
              </SessionProvider>
            </AuthProvider>
          </BrowserRouter>
        </AntdApp>
      </ConfigProvider>
    </ErrorBoundary>
  );
};

export default App;
