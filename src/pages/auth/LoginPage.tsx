import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, Alert } from 'antd';
import { UserOutlined, LockOutlined, LoginOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

export const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { loginTeam } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      await loginTeam(values.username, values.password);
      navigate('/team/dashboard', { replace: true });
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid Team ID or Password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: '24px',
              boxShadow: '0 8px 20px rgba(37, 99, 235, 0.35)',
              marginBottom: 16,
            }}
          >
            H
          </div>
          <Title level={2} style={{ color: '#ffffff', margin: 0, fontWeight: 800, letterSpacing: '-0.5px' }}>
            Hackathon Portal
          </Title>
          <Text style={{ color: '#94a3b8', fontSize: '14px', marginTop: 4, display: 'block' }}>
            Team Login
          </Text>
        </div>

        {/* Login Card */}
        <Card
          bordered={false}
          style={{
            borderRadius: 16,
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            background: '#ffffff',
          }}
          bodyStyle={{ padding: '32px 28px' }}
        >
          {errorMessage && (
            <Alert
              message={errorMessage}
              type="error"
              showIcon
              closable
              onClose={() => setErrorMessage(null)}
              style={{ marginBottom: 20, borderRadius: 8 }}
            />
          )}

          <Form layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
            <Form.Item
              name="username"
              label={<Text strong style={{ fontSize: '13px' }}>Team ID / Username</Text>}
              rules={[{ required: true, message: 'Please enter your Team ID or Username' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Team ID / Username"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<Text strong style={{ fontSize: '13px' }}>Password</Text>}
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Password"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginTop: 28, marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                icon={<LoginOutlined />}
                block
                style={{
                  height: 48,
                  fontSize: '15px',
                  fontWeight: 600,
                  borderRadius: 8,
                  background: '#2563eb',
                }}
              >
                Sign In
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {/* Single Session Footer Note */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Text style={{ color: '#64748b', fontSize: '12px' }}>
            <SafetyCertificateOutlined style={{ marginRight: 4 }} />
            Official Hackathon Portal • Secure Session
          </Text>
        </div>
      </div>
    </div>
  );
};
