import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Typography,
  Row,
  Col,
  Alert,
  Tag,
  Space,
  message,
} from 'antd';
import {
  UserAddOutlined,
  LockOutlined,
  TeamOutlined,
  UserOutlined,
  CheckCircleOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
  createTeamAccount,
  getNextTeamPreview,
  generateLocalUsername,
  formatTeamCreationError,
} from '../../services/accounts.service';
import {
  getComprehensiveOccupiedStatementIds,
  isStatementOccupied,
} from '../../services/problemAssignment.service';
import { ProblemStatement } from '../../types';

const { Title, Text, Paragraph } = Typography;

interface AddTeamModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (createdTeam: { teamId: string; username: string; teamName: string; leaderName: string }) => void;
}

export const AddTeamModal: React.FC<AddTeamModalProps> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loadingProblems, setLoadingProblems] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewTeamId, setPreviewTeamId] = useState<string>('TEAM001');
  const [previewUsername, setPreviewUsername] = useState<string>('');
  const [autoAssignedProblem, setAutoAssignedProblem] = useState<{
    statementId: string;
    orderNum: number;
    title: string;
    category?: string;
  } | null>(null);

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

      const loadInitial = async () => {
        const generatedId = await fetchPreview();
        await fetchProblemStatements(generatedId);
      };
      loadInitial();

      // Real-time snapshot listeners while modal is open
      const unsubPS = onSnapshot(collection(db, 'problemStatements'), () => {
        fetchProblemStatements(previewTeamId);
      });
      const unsubTPA = onSnapshot(collection(db, 'teamProblemAssignments'), () => {
        fetchProblemStatements(previewTeamId);
      });

      return () => {
        unsubPS();
        unsubTPA();
      };
    }
  }, [open]);

  const fetchPreview = async (leaderNameVal?: string): Promise<string> => {
    try {
      const res = await getNextTeamPreview(leaderNameVal);
      const newId = res.generatedTeamId || 'TEAM001';
      setPreviewTeamId(newId);
      if (leaderNameVal) {
        setPreviewUsername(res.generatedUsername || generateLocalUsername(leaderNameVal));
      } else {
        setPreviewUsername('');
      }
      return newId;
    } catch (err) {
      console.warn('[AddTeamModal] Preview calculation error:', err);
      return 'TEAM001';
    }
  };

  const fetchProblemStatements = async (teamIdHint?: string) => {
    setLoadingProblems(true);
    try {
      const [psSnap, occupiedSet] = await Promise.all([
        getDocs(collection(db, 'problemStatements')),
        getComprehensiveOccupiedStatementIds(),
      ]);

      const rawList: ProblemStatement[] = [];
      psSnap.forEach((doc) => {
        rawList.push({ statementId: doc.id, ...doc.data() } as ProblemStatement);
      });

      rawList.sort((a, b) => {
        const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence !== undefined && a.sequence !== null ? a.sequence : 0);
        const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence !== undefined && b.sequence !== null ? b.sequence : 0);
        if (ordA !== ordB) return ordA - ordB;
        return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
      });

      const currentTeamId = teamIdHint || previewTeamId || 'TEAM001';
      const numMatch = currentTeamId.match(/\d+/);
      const targetTeamNum = numMatch ? parseInt(numMatch[0], 10) : 1;

      const exactMatch = rawList.find((p) => {
        const ord = p.order !== undefined && p.order !== null ? p.order : (p.sequence || 1);
        const isPub = p.status === 'PUBLISHED' || p.status === 'published' || p.status === 'active';
        return ord === targetTeamNum && !isPub && !isStatementOccupied(p, occupiedSet);
      });

      const nextAscendingFree = rawList.find((p) => {
        const ord = p.order !== undefined && p.order !== null ? p.order : (p.sequence || 1);
        const isPub = p.status === 'PUBLISHED' || p.status === 'published' || p.status === 'active';
        return ord >= targetTeamNum && !isPub && !isStatementOccupied(p, occupiedSet);
      });

      const fallbackLowestFree = rawList.find((p) => {
        const isPub = p.status === 'PUBLISHED' || p.status === 'published' || p.status === 'active';
        return !isPub && !isStatementOccupied(p, occupiedSet);
      });

      const selected = exactMatch || nextAscendingFree || fallbackLowestFree || null;

      if (selected) {
        const ord = selected.order !== undefined && selected.order !== null ? selected.order : (selected.sequence || 1);
        setAutoAssignedProblem({
          statementId: selected.statementId,
          orderNum: ord,
          title: selected.title || 'Untitled Problem',
          category: selected.category || 'General',
        });
      } else {
        setAutoAssignedProblem(null);
      }
    } catch (err) {
      console.warn('[AddTeamModal] Error loading problem statements:', err);
      setAutoAssignedProblem(null);
    } finally {
      setLoadingProblems(false);
    }
  };

  const handleLeaderNameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setErrorMessage(null);
    const nextId = await fetchPreview(val);
    await fetchProblemStatements(nextId);
  };

  const handleFinish = async (values: any) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await createTeamAccount({
        teamName: values.teamName.trim(),
        leaderName: values.leaderName.trim(),
        password: values.password,
        selectedStatementId: autoAssignedProblem?.statementId || undefined,
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
      const nextId = await fetchPreview();
      await fetchProblemStatements(nextId);
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
      width={580}
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
            The team account and auto-assigned problem statement have been permanently saved in Firestore.
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
                  {createdSuccessData.assignedProblemSequence
                    ? `Problem #${createdSuccessData.assignedProblemSequence} (${createdSuccessData.assignedStatementId})`
                    : createdSuccessData.assignedStatementId}
                </Tag>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Team Name:</Text>
              <Text strong>{createdSuccessData.teamName}</Text>
            </div>
          </div>

          <Space size="middle">
            <Button onClick={() => { setCreatedSuccessData(null); fetchProblemStatements(); }}>
              Create Another Team
            </Button>
            <Button type="primary" onClick={onClose} style={{ background: '#1677ff' }}>
              Done
            </Button>
          </Space>
        </div>
      ) : (
        <div>
          <Paragraph type="secondary" style={{ fontSize: '13px', marginBottom: 20 }}>
            Enter Team Name, Leader Name, and Password. The Problem Statement is assigned automatically based on team sequence.
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

            <Row gutter={12} style={{ marginBottom: 16 }}>
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

            <div
              style={{
                background: '#f8fafc',
                padding: 16,
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Space size={8}>
                  <BookOutlined style={{ color: '#1677ff', fontSize: '15px' }} />
                  <Text strong style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1e293b' }}>
                    Auto-Assigned Problem Statement
                  </Text>
                </Space>
                <Tag color="cyan" style={{ fontWeight: 700, fontSize: '11px', margin: 0 }}>
                  Automatic / Sequential
                </Tag>
              </div>

              {loadingProblems ? (
                <div style={{ padding: '12px 0', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  Loading auto-assigned problem statement...
                </div>
              ) : autoAssignedProblem ? (
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Space size={8}>
                      <Tag color="blue" style={{ fontSize: '12px', fontWeight: 800, margin: 0 }}>
                        Problem #{autoAssignedProblem.orderNum}
                      </Tag>
                      <Text code style={{ fontSize: '12px', fontWeight: 700, color: '#1d39c4' }}>
                        {autoAssignedProblem.statementId}
                      </Text>
                    </Space>
                    <Tag color="green" style={{ fontSize: '11px', fontWeight: 700, margin: 0 }}>
                      FREE
                    </Tag>
                  </div>
                  <Text strong style={{ fontSize: '13px', color: '#0f172a', display: 'block', lineHeight: 1.4 }}>
                    {autoAssignedProblem.title}
                  </Text>
                  {autoAssignedProblem.category && (
                    <Text type="secondary" style={{ fontSize: '11px', marginTop: 4, display: 'block' }}>
                      Category: {autoAssignedProblem.category}
                    </Text>
                  )}
                </div>
              ) : (
                <Alert
                  type="warning"
                  message="No unassigned problem statements are available in the catalog."
                  showIcon
                  style={{ borderRadius: 8, fontSize: '12px' }}
                />
              )}
            </div>

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
                disabled={loading || loadingProblems || !autoAssignedProblem}
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
