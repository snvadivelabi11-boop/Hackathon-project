import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, Alert, Tag, Space } from 'antd';
import { LockOutlined, MailOutlined, SafetyCertificateOutlined, KeyOutlined, LoginOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

export const AdminLoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { loginAdmin } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const onFinish = async (values: any) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      await loginAdmin(values.email, values.password);
      navigate('/admin/dashboard', { replace: true });
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid email or password.');
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
        background: 'linear-gradient(135deg, #0b0f19 0%, #111827 100%)',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: '22px',
              boxShadow: '0 8px 24px rgba(220, 38, 38, 0.35)',
              marginBottom: 16,
            }}
          >
            <KeyOutlined />
          </div>
          <Title level={2} style={{ color: '#ffffff', margin: 0, fontWeight: 800, letterSpacing: '-0.5px' }}>
            Administrator Portal
          </Title>
          <Text style={{ color: '#9ca3af', fontSize: '14px', marginTop: 4, display: 'block' }}>
            Authorized Administrator Access Only
          </Text>
        </div>

        {/* Login Card */}
        <Card
          bordered={false}
          style={{
            borderRadius: 16,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            background: '#1f2937',
            borderColor: '#374151',
          }}
          bodyStyle={{ padding: '32px 28px' }}
        >
          {errorMessage && (
            <div role="alert" style={{ marginBottom: 20 }}>
              <Alert
                message="Sign In Failed"
                description={errorMessage}
                type="error"
                showIcon
                closable
                onClose={() => setErrorMessage(null)}
                style={{
                  borderRadius: 8,
                  background: '#450a0a',
                  borderColor: '#991b1b',
                  color: '#fecaca',
                }}
              />
            </div>
          )}

          <Form form={form} layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
            <Form.Item
              name="email"
              label={<Text style={{ fontSize: '13px', color: '#e5e7eb', fontWeight: 600 }}>Admin Email</Text>}
              rules={[{ required: true, message: 'Please enter your Admin Email' }]}
            >
              <Input
                prefix={<MailOutlined style={{ color: '#9ca3af' }} />}
                placeholder="admin@example.com"
                autoComplete="email"
                disabled={loading}
                style={{ background: '#111827', borderColor: '#374151', color: '#fff' }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<Text style={{ fontSize: '13px', color: '#e5e7eb', fontWeight: 600 }}>Password</Text>}
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#9ca3af' }} />}
                placeholder="Password"
                autoComplete="current-password"
                disabled={loading}
                style={{ background: '#111827', borderColor: '#374151', color: '#fff' }}
              />
            </Form.Item>

            <Form.Item style={{ marginTop: 28, marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                disabled={loading}
                icon={<LoginOutlined />}
                block
                style={{
                  height: 48,
                  fontSize: '15px',
                  fontWeight: 700,
                  borderRadius: 8,
                  background: '#dc2626',
                  borderColor: '#dc2626',
                }}
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {/* Security Footer Note */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Text style={{ color: '#6b7280', fontSize: '12px' }}>
            <SafetyCertificateOutlined style={{ marginRight: 4 }} />
            Protected by Firebase Authentication & Server-Side Security Rules
          </Text>
        </div>
      </div>
    </div>
  );
};
