import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Result, Button, Typography, Space, Collapse } from 'antd';
import { ReloadOutlined, HomeOutlined, WarningOutlined, ClearOutlined, LoginOutlined } from '@ant-design/icons';

const { Paragraph, Text } = Typography;

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught runtime exception:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleClearCacheAndRetry = () => {
    try {
      localStorage.removeItem('hackathon_user');
      localStorage.removeItem('hackathon_active_session_id');
      sessionStorage.clear();
    } catch {}
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/login';
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  private handleGoLogin = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/login';
  };

  public render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'An unexpected runtime error occurred.';

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8fafc',
            padding: 24,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              padding: 40,
              borderRadius: 16,
              boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              maxWidth: 680,
              width: '100%',
              textAlign: 'center',
            }}
          >
            <Result
              status="error"
              icon={<WarningOutlined style={{ color: '#ef4444', fontSize: 64 }} />}
              title={<span style={{ fontSize: 24, fontWeight: 700 }}>Something went wrong</span>}
              subTitle={
                <span style={{ color: '#64748b', fontSize: 15 }}>
                  The application encountered a recoverable error. You can retry the action, reset your session cache, or return to login.
                </span>
              }
              extra={
                <Space size="middle" wrap style={{ justifyContent: 'center' }}>
                  <Button
                    type="primary"
                    icon={<ReloadOutlined />}
                    onClick={this.handleRetry}
                    size="large"
                    style={{ background: '#1677ff', borderRadius: 8, fontWeight: 600 }}
                  >
                    Try Again
                  </Button>
                  <Button
                    icon={<ClearOutlined />}
                    onClick={this.handleClearCacheAndRetry}
                    size="large"
                    style={{ borderRadius: 8 }}
                  >
                    Clear Session & Login
                  </Button>
                  <Button
                    icon={<HomeOutlined />}
                    onClick={this.handleGoHome}
                    size="large"
                    style={{ borderRadius: 8 }}
                  >
                    Return to Home
                  </Button>
                </Space>
              }
            >
              {this.state.error && (
                <div style={{ marginTop: 24, textAlign: 'left' }}>
                  <Collapse
                    ghost
                    items={[
                      {
                        key: '1',
                        label: (
                          <Text type="secondary" style={{ fontSize: '13px' }}>
                            View Error Diagnostics
                          </Text>
                        ),
                        children: (
                          <div
                            style={{
                              background: '#f1f5f9',
                              padding: 12,
                              borderRadius: 8,
                              fontSize: 12,
                              fontFamily: 'monospace',
                              color: '#b91c1c',
                              maxHeight: 200,
                              overflowY: 'auto',
                              wordBreak: 'break-all',
                            }}
                          >
                            <div><strong>Error:</strong> {errorMessage}</div>
                            {this.state.errorInfo?.componentStack && (
                              <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                                {this.state.errorInfo.componentStack}
                              </pre>
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>
              )}
            </Result>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
