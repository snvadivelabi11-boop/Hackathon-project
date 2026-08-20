import React, { useState, useEffect, useMemo } from 'react';
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
  Select,
  Segmented,
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

interface ProblemOptionItem {
  statementId: string;
  orderNum: number;
  title: string;
  category: string;
  isFree: boolean;
  statusType: 'FREE' | 'ASSIGNED' | 'PUBLISHED';
  statusLabel: string;
  assignedTeam?: string;
}

export const AddTeamModal: React.FC<AddTeamModalProps> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loadingProblems, setLoadingProblems] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewTeamId, setPreviewTeamId] = useState<string>('TEAM001');
  const [previewUsername, setPreviewUsername] = useState<string>('');
  const [problemOptions, setProblemOptions] = useState<ProblemOptionItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'FREE' | 'ASSIGNED'>('ALL');
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);

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
      setSelectedStatementId(null);
      form.resetFields();
      fetchPreview();
      fetchProblemStatements();

      // Real-time snapshot listeners while modal is open to ensure instant reflection of database assignments
      const unsubPS = onSnapshot(collection(db, 'problemStatements'), () => {
        fetchProblemStatements();
      });
      const unsubTPA = onSnapshot(collection(db, 'teamProblemAssignments'), () => {
        fetchProblemStatements();
      });

      return () => {
        unsubPS();
        unsubTPA();
      };
    }
  }, [open]);

  const fetchPreview = async (leaderNameVal?: string) => {
    try {
      const res = await getNextTeamPreview(leaderNameVal);
      if (res.generatedTeamId) setPreviewTeamId(res.generatedTeamId);
      if (leaderNameVal) {
        setPreviewUsername(res.generatedUsername || generateLocalUsername(leaderNameVal));
      } else {
        setPreviewUsername('');
      }
    } catch (err) {
      console.warn('[AddTeamModal] Preview calculation error:', err);
    }
  };

  const fetchProblemStatements = async () => {
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

      // Sort deterministically by order / sequence / statementId
      rawList.sort((a, b) => {
        const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence !== undefined && a.sequence !== null ? a.sequence : 0);
        const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence !== undefined && b.sequence !== null ? b.sequence : 0);
        if (ordA !== ordB) return ordA - ordB;
        return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
      });

      const options: ProblemOptionItem[] = rawList.map((ps) => {
        const ord = ps.order !== undefined && ps.order !== null ? ps.order : (ps.sequence || 1);
        const isPub = ps.status === 'PUBLISHED' || ps.status === 'published' || ps.status === 'active';
        const isOcc = isStatementOccupied(ps, occupiedSet);
        const assignedTeam = ps.assignedTeamId || (Array.isArray(ps.assignedTeamIds) && ps.assignedTeamIds[0]) || ps.team || undefined;

        let statusType: 'FREE' | 'ASSIGNED' | 'PUBLISHED' = 'FREE';
        let statusLabel = 'FREE';
        let isFree = true;

        if (isPub) {
          statusType = 'PUBLISHED';
          statusLabel = assignedTeam ? `PUBLISHED — ${assignedTeam}` : 'PUBLISHED';
          isFree = false;
        } else if (isOcc) {
          statusType = 'ASSIGNED';
          statusLabel = assignedTeam ? `ASSIGNED — ${assignedTeam}` : 'ASSIGNED';
          isFree = false;
        }

        return {
          statementId: ps.statementId,
          orderNum: ord,
          title: ps.title || 'Untitled Problem',
          category: ps.category || 'General',
          isFree,
          statusType,
          statusLabel,
          assignedTeam,
        };
      });

      setProblemOptions(options);

      // Automatically select the first genuinely FREE problem statement in order by default
      const firstFree = options.find((p) => p.isFree);
      if (firstFree) {
        setSelectedStatementId((prev) => {
          if (prev) {
            const currentSelected = options.find((o) => o.statementId === prev);
            if (currentSelected && currentSelected.isFree) {
              return prev;
            }
          }
          form.setFieldsValue({ selectedStatementId: firstFree.statementId });
          return firstFree.statementId;
        });
      }
    } catch (err) {
      console.warn('[AddTeamModal] Error loading problem statements:', err);
    } finally {
      setLoadingProblems(false);
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
    if (!values.selectedStatementId) {
      setErrorMessage('Please select a FREE problem statement before creating the team.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await createTeamAccount({
        teamName: values.teamName.trim(),
        leaderName: values.leaderName.trim(),
        password: values.password,
        selectedStatementId: values.selectedStatementId,
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
      setSelectedStatementId(null);
      fetchPreview();
      fetchProblemStatements();
    } catch (err: any) {
      const safeMsg = formatTeamCreationError(err);
      setErrorMessage(safeMsg);
      message.error(safeMsg);
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => {
    const total = problemOptions.length;
    const free = problemOptions.filter((p) => p.isFree).length;
    const assigned = total - free;
    return { total, free, assigned };
  }, [problemOptions]);

  const displayedOptions = useMemo(() => {
    if (statusFilter === 'FREE') {
      return problemOptions.filter((p) => p.isFree);
    }
    if (statusFilter === 'ASSIGNED') {
      return problemOptions.filter((p) => !p.isFree);
    }
    return problemOptions;
  }, [problemOptions, statusFilter]);

  const selectedProblem = useMemo(() => {
    if (!selectedStatementId) return null;
    return problemOptions.find((p) => p.statementId === selectedStatementId) || null;
  }, [selectedStatementId, problemOptions]);

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
      width={600}
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
            The team account and problem statement assignment have been provisioned in Firestore.
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
            {createdSuccessData.assignedStatementTitle && (
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Problem Title:</Text>
                <Text strong style={{ textAlign: 'right', maxWidth: 300 }}>{createdSuccessData.assignedStatementTitle}</Text>
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
            Enter Team Name, Leader Name, select a FREE Problem Statement, and set a Password.
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

            {/* ASSIGN PROBLEM STATEMENT SECTION */}
            <div style={{ background: '#f8fafc', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Space size={6}>
                  <BookOutlined style={{ color: '#1677ff' }} />
                  <Text strong style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Assign Problem Statement
                  </Text>
                  <Text type="danger" style={{ fontWeight: 700 }}>*</Text>
                </Space>

                <Segmented
                  size="small"
                  value={statusFilter}
                  onChange={(val) => setStatusFilter(val as any)}
                  options={[
                    { label: `All (${counts.total})`, value: 'ALL' },
                    { label: `FREE (${counts.free})`, value: 'FREE' },
                    { label: `Assigned (${counts.assigned})`, value: 'ASSIGNED' },
                  ]}
                />
              </div>

              <Form.Item
                name="selectedStatementId"
                style={{ marginBottom: 0 }}
                rules={[{ required: true, message: 'Please select a FREE problem statement before creating the team.' }]}
              >
                <Select
                  showSearch
                  placeholder="Select a FREE problem statement..."
                  loading={loadingProblems}
                  disabled={loading}
                  onChange={(val) => setSelectedStatementId(val)}
                  filterOption={(input, option) => {
                    if (!option) return false;
                    const searchStr = String((option as any).searchValue || '').toLowerCase();
                    return searchStr.includes(input.toLowerCase());
                  }}
                  style={{ width: '100%' }}
                >
                  {displayedOptions.map((p) => {
                    const isFree = p.isFree;
                    let tagColor = 'green';
                    if (p.statusType === 'ASSIGNED') tagColor = 'purple';
                    if (p.statusType === 'PUBLISHED') tagColor = 'gold';

                    return (
                      <Select.Option
                        key={p.statementId}
                        value={p.statementId}
                        disabled={!isFree}
                        searchValue={`Problem #${p.orderNum} ${p.statementId} ${p.title} ${p.category}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: isFree ? 1 : 0.6 }}>
                          <Space size={8} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                            <Tag color="blue" style={{ fontWeight: 800, fontSize: '11px', margin: 0 }}>
                              #{p.orderNum}
                            </Tag>
                            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1d39c4', fontSize: '12px' }}>
                              {p.statementId}
                            </span>
                            <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '13px' }}>
                              {p.title}
                            </span>
                          </Space>
                          <Tag color={tagColor} style={{ fontSize: '10px', fontWeight: 700, margin: 0 }}>
                            {p.statusLabel}
                          </Tag>
                        </div>
                      </Select.Option>
                    );
                  })}
                </Select>
              </Form.Item>

              {/* Selected Problem Details Box */}
              {selectedProblem && (
                <div style={{ background: '#f0fdf4', padding: '10px 14px', borderRadius: 8, border: '1px solid #bbf7d0', marginTop: 10 }}>
                  <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', display: 'block', fontWeight: 600, color: '#166534' }}>
                    Selected Problem Statement (Will be Assigned)
                  </Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Tag color="green" style={{ fontSize: '13px', fontWeight: 800, margin: 0 }}>
                      Problem #{selectedProblem.orderNum} ({selectedProblem.statementId})
                    </Tag>
                    <Text ellipsis strong style={{ fontSize: '13px', color: '#14532d', maxWidth: 320 }}>
                      {selectedProblem.title}
                    </Text>
                  </div>
                </div>
              )}
            </div>

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
                disabled={loading || !selectedStatementId || !selectedProblem?.isFree}
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
