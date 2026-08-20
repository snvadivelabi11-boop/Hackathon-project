import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, Typography, Row, Col, Alert, Tag, Space, message } from 'antd';
import { UserAddOutlined, LockOutlined, TeamOutlined, UserOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { createTeamAccount, getNextTeamPreview, generateLocalUsername, formatTeamCreationError } from '../../services/accounts.service';

const { Title, Text, Paragraph } = Typography;

interface AddTeamModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (createdTeam: { teamId: string; username: string; teamName: string; leaderName: string }) => void;
}

export const AddTeamModal: React.FC<AddTeamModalProps> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewTeamId, setPreviewTeamId] = useState<string>('TEAM001');
  const [previewUsername, setPreviewUsername] = useState<string>('');
  const [previewProblem, setPreviewProblem] = useState<{ statementId: string; sequence?: number; title: string } | null>(null);
  const [createdSuccessData, setCreatedSuccessData] = useState<{
    teamId: string;
    username: string;
    teamName: string;
    leaderName: string;
    assignedStatementId?: string | null;
    assignedStatementTitle?: string | null;
    assignedProblemSequence?: number | null;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setCreatedSuccessData(null);
      form.resetFields();
      fetchPreview();
    }
  }, [open]);

  const fetchPreview = async (leaderNameVal?: string) => {
    try {
      const res = await getNextTeamPreview(leaderNameVal);
      if (res.generatedTeamId) setPreviewTeamId(res.generatedTeamId);
      if (res.defaultProblemStatement) {
        setPreviewProblem(res.defaultProblemStatement);
      } else {
        setPreviewProblem(null);
      }
      if (leaderNameVal) {
        setPreviewUsername(res.generatedUsername || generateLocalUsername(leaderNameVal));
      } else {
        setPreviewUsername('');
      }
    } catch (err) {
      console.warn('[AddTeamModal] Preview calculation error:', err);
    }
  };

  const handleLeaderNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setErrorMessage(null);
    if (val.trim()) {
      setPreviewUsername(generateLocalUsername(val));
    } else {
      setPreviewUsername('');
    }
  };

  const handleFinish = async (values: any) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await createTeamAccount({
        teamName: values.teamName.trim(),
        leaderName: values.leaderName.trim(),
        password: values.password,
      });

      setCreatedSuccessData({
        teamId: res.teamId,
        username: res.username,
        teamName: res.teamName,
        leaderName: res.leaderName,
        assignedStatementId: res.assignedStatementId,
        assignedStatementTitle: res.assignedStatementTitle,
        assignedProblemSequence: res.assignedProblemSequence,
      });

      message.success(`Team ${res.teamId} created successfully!`);
      if (onSuccess) onSuccess(res);

      form.resetFields();
      fetchPreview();
    } catch (err: any) {
      const safeMsg = formatTeamCreationError(err);
      setErrorMessage(safeMsg);
      message.error(safeMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <UserAddOutlined style={{ color: '#1677ff', fontSize: '18px' }} />
          <span style={{ fontWeight: 700 }}>Add New Team</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      centered
      width={520}
    >
      {createdSuccessData ? (
        <div style={{ padding: '16px 0', textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#f6ffed',
              border: '2px solid #52c41a',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#52c41a',
              fontSize: '28px',
              marginBottom: 16,
            }}
          >
            <CheckCircleOutlined />
          </div>
          <Title level={3} style={{ color: '#52c41a', margin: '0 0 8px', fontWeight: 800 }}>
            ✓ Team account created successfully
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 20 }}>
            The team account has been provisioned in Firebase Authentication and Firestore.
          </Paragraph>

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: 20,
              textAlign: 'left',
              marginBottom: 24,
            }}
          >
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary">Team ID:</Text>
              <Tag color="blue" style={{ fontWeight: 800, fontSize: '14px', margin: 0, padding: '2px 10px' }}>
                {createdSuccessData.teamId}
              </Tag>
            </div>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary">Username:</Text>
              <Text code style={{ fontSize: '14px', fontWeight: 700 }}>
                {createdSuccessData.username}
              </Text>
            </div>
            {createdSuccessData.assignedStatementId && (
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary">Assigned Problem:</Text>
                <Tag color="green" style={{ fontWeight: 800, fontSize: '13px', margin: 0 }}>
                  {createdSuccessData.assignedProblemSequence ? `Problem #${createdSuccessData.assignedProblemSequence} (${createdSuccessData.assignedStatementId})` : createdSuccessData.assignedStatementId}
                </Tag>
              </div>
            )}
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Team Name:</Text>
              <Text strong>{createdSuccessData.teamName}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Leader Name:</Text>
              <Text>{createdSuccessData.leaderName}</Text>
            </div>
          </div>

          <Space size="middle">
            <Button onClick={() => setCreatedSuccessData(null)}>Create Another Team</Button>
            <Button type="primary" onClick={onClose} style={{ background: '#1677ff' }}>
              Done
            </Button>
          </Space>
        </div>
      ) : (
        <div>
          <Paragraph type="secondary" style={{ fontSize: '13px', marginBottom: 20 }}>
            Enter Team Name, Leader Name, and Password. Team ID and Username are generated automatically.
          </Paragraph>

          {errorMessage && (
            <Alert
              type="error"
              message={errorMessage}
              showIcon
              closable
              onClose={() => setErrorMessage(null)}
              style={{ marginBottom: 16, borderRadius: 8 }}
            />
          )}

          <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false} size="large">
            {/* Team Name */}
            <Form.Item
              name="teamName"
              label={<Text strong style={{ fontSize: '13px' }}>Team Name</Text>}
              rules={[{ required: true, message: 'Please enter Team Name' }]}
            >
              <Input
                prefix={<TeamOutlined style={{ color: '#94a3b8' }} />}
                placeholder="e.g. AI Innovators"
                disabled={loading}
              />
            </Form.Item>

            {/* Leader Name */}
            <Form.Item
              name="leaderName"
              label={<Text strong style={{ fontSize: '13px' }}>Leader Name</Text>}
              rules={[{ required: true, message: 'Please enter Leader Name' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                placeholder="e.g. Abhishek"
                onChange={handleLeaderNameChange}
                disabled={loading}
              />
            </Form.Item>

            {/* Generated Fields (Auto) */}
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <div style={{ background: '#f1f5f9', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>
                    Generated Team ID
                  </Text>
                  <Tag color="blue" style={{ fontSize: '14px', fontWeight: 800, marginTop: 4, margin: 0 }}>
                    {previewTeamId}
                  </Tag>
                </div>
              </Col>

              <Col span={12}>
                <div style={{ background: '#f1f5f9', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>
                    Generated Username
                  </Text>
                  <Text code style={{ fontSize: '13px', fontWeight: 700, marginTop: 4, display: 'inline-block' }}>
                    {previewUsername || 'abhishek'}
                  </Text>
                </div>
              </Col>
            </Row>

            {/* Default Problem Statement Preview (Auto Sequential) */}
            {previewProblem ? (
              <div style={{ background: '#f0fdf4', padding: '10px 14px', borderRadius: 8, border: '1px solid #bbf7d0', marginBottom: 16 }}>
                <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', display: 'block', fontWeight: 600, color: '#166534' }}>
                  Default Problem Statement (Auto Sequential)
                </Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Tag color="green" style={{ fontSize: '13px', fontWeight: 800, margin: 0 }}>
                    Problem #{previewProblem.sequence || 1} ({previewProblem.statementId})
                  </Tag>
                  <Text ellipsis strong style={{ fontSize: '13px', color: '#14532d', maxWidth: 260 }}>
                    {previewProblem.title}
                  </Text>
                </div>
              </div>
            ) : (
              <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
                <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', display: 'block', fontWeight: 600, color: '#64748b' }}>
                  Default Problem Statement (Auto Sequential)
                </Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Tag color="default" style={{ fontSize: '12px', fontWeight: 700, margin: 0 }}>
                    No unassigned problem statements available
                  </Tag>
                </div>
              </div>
            )}

            {/* Password */}
            <Form.Item
              name="password"
              label={<Text strong style={{ fontSize: '13px' }}>Team Password</Text>}
              rules={[
                { required: true, message: 'Please enter a password' },
                { min: 6, message: 'Password must be at least 6 characters' },
              ]}
              extra={
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  Password is used exclusively for Firebase Authentication and is never stored in Firestore.
                </Text>
              }
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Enter team password (min 6 chars)"
                disabled={loading}
              />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <Button onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                icon={<UserAddOutlined />}
                style={{ background: '#1677ff', borderRadius: 8, fontWeight: 700 }}
              >
                CREATE ACCOUNT
              </Button>
            </div>
          </Form>
        </div>
      )}
    </Modal>
  );
};
