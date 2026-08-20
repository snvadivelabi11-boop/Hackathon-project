import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Typography,
  Input,
  Tag,
  Space,
  Button,
  Modal,
  Form,
  Row,
  Col,
  message,
  Dropdown,
  Badge,
} from 'antd';
import {
  SearchOutlined,
  UserAddOutlined,
  EditOutlined,
  StopOutlined,
  CheckCircleOutlined,
  LogoutOutlined,
  KeyOutlined,
  EyeOutlined,
  MoreOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import {
  subscribeToTeams,
  disableTeam,
  enableTeam,
  resetTeamPassword,
  forceLogoutTeam,
  updateTeamInfo,
  deleteTeamAccountCascade,
} from '../../services/accounts.service';
import { subscribeToAllSubmissions } from '../../services/submissions.service';
import { subscribeToAllScores } from '../../services/scores.service';
import { subscribeToAllSelections } from '../../services/selection.service';
import { Team, Submission, Score, TeamSelection } from '../../types';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatISTDateTime } from '../../utils/date';
import { AddTeamModal } from '../../components/admin/AddTeamModal';
import { safeString } from '../../utils/normalize';
import { useScoring } from '../../contexts/ScoringContext';

const { Title, Text, Paragraph } = Typography;

export const TeamsPage: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [selections, setSelections] = useState<TeamSelection[]>([]);
  const [search, setSearch] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { totalMaxMarks } = useScoring();

  // Action Modals State
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isResetPassModalOpen, setIsResetPassModalOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

  const [editForm] = Form.useForm();
  const [resetPassForm] = Form.useForm();

  useEffect(() => {
    const unsubTeams = subscribeToTeams(setTeams);
    const unsubSubs = subscribeToAllSubmissions(setSubmissions);
    const unsubScores = subscribeToAllScores(setScores);
    const unsubSelections = subscribeToAllSelections(setSelections);

    return () => {
      unsubTeams();
      unsubSubs();
      unsubScores();
      unsubSelections();
    };
  }, []);

  const getTeamSub = (teamId: string, roundId: string) => {
    return submissions.find((s) => s && s.teamId === teamId && (s.roundId || '').includes(roundId));
  };

  const getTeamScore = (teamId: string, roundId: string) => {
    return scores.find((s) => s && s.teamId === teamId && (s.roundId || '').includes(roundId))?.totalMarks;
  };

  const getTeamTotalScore = (teamId: string) => {
    const s1 = getTeamScore(teamId, '1');
    const s2 = getTeamScore(teamId, '2');
    const s3 = getTeamScore(teamId, '3');
    if (s1 === undefined && s2 === undefined && s3 === undefined) return null;
    return (s1 || 0) + (s2 || 0) + (s3 || 0);
  };

  const getTeamSelection = (teamId: string) => {
    return selections.find((s) => s && s.teamId === teamId)?.status || 'NOT_SELECTED';
  };

  const handleEditTeam = async (values: any) => {
    if (!selectedTeam) return;
    setLoadingAction(true);
    try {
      await updateTeamInfo(selectedTeam.teamId, values.teamName, values.leaderName);
      message.success('Team details updated.');
      setIsEditModalOpen(false);
    } catch (err: any) {
      message.error(err.message || 'Failed to update team.');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleResetPassword = async (values: any) => {
    if (!selectedTeam) return;
    const cleanPassword = (values.newPassword || '').trim();
    if (!cleanPassword || cleanPassword.length < 6) {
      message.error('New password does not meet the required security rules. Must be at least 6 characters.');
      return;
    }

    setLoadingAction(true);
    try {
      await resetTeamPassword(selectedTeam.teamId, cleanPassword);
      message.success('Password updated successfully.');
      setIsResetPassModalOpen(false);
      resetPassForm.resetFields();
    } catch (err: any) {
      message.error(err.message || 'Password reset failed. Please try again.');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleToggleStatus = (team: Team) => {
    const isDisabling = team.status === 'active';
    Modal.confirm({
      title: isDisabling ? `Disable ${team.teamId}?` : `Enable ${team.teamId}?`,
      content: isDisabling
        ? 'Disabling this account will immediately terminate its active login session and block further access.'
        : 'Enabling this account will restore login permissions.',
      okText: isDisabling ? 'Disable Account' : 'Enable Account',
      okType: isDisabling ? 'danger' : 'primary',
      onOk: async () => {
        try {
          if (isDisabling) {
            await disableTeam(team.teamId);
            message.success(`Team ${team.teamId} disabled.`);
          } else {
            await enableTeam(team.teamId);
            message.success(`Team ${team.teamId} enabled.`);
          }
        } catch (err: any) {
          message.error(err.message || 'Action failed.');
        }
      },
    });
  };

  const handleForceLogout = (team: Team) => {
    Modal.confirm({
      title: `Force Logout for ${team.teamId}?`,
      content: 'This will invalidate the active device session immediately. The team will be logged out on their client.',
      okText: 'Force Logout',
      okType: 'danger',
      onOk: async () => {
        try {
          await forceLogoutTeam(team.teamId);
          message.success(`Forced logout applied to ${team.teamId}.`);
        } catch (err: any) {
          message.error(err.message || 'Failed to force logout.');
        }
      },
    });
  };

  const handleDeleteTeam = (team: Team) => {
    Modal.confirm({
      title: (
        <Space>
          <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />
          <span style={{ fontWeight: 700 }}>Delete this team permanently?</span>
        </Space>
      ),
      content: (
        <div style={{ marginTop: 8 }}>
          <Paragraph>
            Are you sure you want to delete <Text strong style={{ color: '#0f172a' }}>{team.teamId} — {team.teamName}</Text>?
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: '13px', lineHeight: 1.6 }}>
            This will permanently delete the team account, all team members, submissions, evaluations, scores, selection status, certificates, and uploaded files. This action cannot be undone.
          </Paragraph>
        </div>
      ),
      okText: 'Delete Permanently',
      okType: 'danger',
      cancelText: 'Cancel',
      centered: true,
      onOk: async () => {
        const hideLoading = message.loading(`Deleting team ${team.teamId}...`, 0);
        try {
          await deleteTeamAccountCascade(team.teamId);
          hideLoading();
          message.success(`Team ${team.teamId} deleted successfully.`);
        } catch (err: any) {
          hideLoading();
          message.error(err.message || 'Unable to delete the team. Please try again.');
        }
      },
    });
  };

  const query = (search || '').trim().toLowerCase();
  const filteredTeams = teams.filter((t) => {
    if (!query) return true;
    const teamId = (t.teamId || '').toLowerCase();
    const teamName = (t.teamName || '').toLowerCase();
    const leaderName = (t.leaderName || '').toLowerCase();
    const username = (t.username || '').toLowerCase();
    return teamId.includes(query) || teamName.includes(query) || leaderName.includes(query) || username.includes(query);
  });

  const columns = [
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      width: 110,
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700 }}>{id}</Tag>,
      sorter: (a: Team, b: Team) => a.teamId.localeCompare(b.teamId),
    },
    {
      title: 'Team Name',
      dataIndex: 'teamName',
      key: 'teamName',
      render: (name: string, record: Team) => (
        <div>
          <Text strong style={{ fontSize: '14px' }}>{name}</Text>
          <div style={{ fontSize: '12px', color: '#8c8c8c' }}>Username: {record.username}</div>
        </div>
      ),
    },
    {
      title: 'Team Leader',
      dataIndex: 'leaderName',
      key: 'leaderName',
    },
    {
      title: 'Assigned Problem',
      key: 'assignedProblem',
      render: (_: any, record: Team) => {
        const psId = record.assignedStatementId || record.problemStatementId || record.assignedProblemId;
        const psTitle = record.assignedStatementTitle || '';
        const psOrder = record.assignedProblemOrder || record.problemStatementOrder;
        if (!psId) {
          return <Tag color="default">UNASSIGNED</Tag>;
        }
        return (
          <div>
            <Space size={4}>
              {psOrder && <Tag color="blue" style={{ fontWeight: 800, fontSize: '11px' }}>#{psOrder}</Tag>}
              <Tag color="green" style={{ fontWeight: 700, fontSize: '11px' }}>{psId}</Tag>
            </Space>
            {psTitle && (
              <div style={{ fontSize: '12px', color: '#475569', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {psTitle}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Submissions',
      key: 'submissions',
      render: (_: any, record: Team) => {
        const r1 = getTeamSub(record.teamId, '1');
        const r2 = getTeamSub(record.teamId, '2');
        const r3 = getTeamSub(record.teamId, '3');
        return (
          <Space size={4}>
            <Tag color={r1 ? 'cyan' : 'default'} style={{ fontSize: '11px' }}>
              R1 {r1 ? '✓' : '—'}
            </Tag>
            <Tag color={r2 ? 'geekblue' : 'default'} style={{ fontSize: '11px' }}>
              R2 {r2 ? '✓' : '—'}
            </Tag>
            <Tag color={r3 ? 'purple' : 'default'} style={{ fontSize: '11px' }}>
              R3 {r3 ? '✓' : '—'}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: 'Selection',
      key: 'selection',
      render: (_: any, record: Team) => {
        const status = getTeamSelection(record.teamId);
        return (
          <Tag color={status === 'SELECTED' ? 'green' : 'default'} style={{ fontWeight: 600 }}>
            {status === 'SELECTED' ? 'SELECTED' : 'NOT SELECTED'}
          </Tag>
        );
      },
      filters: [
        { text: 'Selected', value: 'SELECTED' },
        { text: 'Not Selected', value: 'NOT_SELECTED' },
      ],
      onFilter: (value: any, record: Team) => getTeamSelection(record.teamId) === value,
    },
    {
      title: 'Total Score',
      key: 'score',
      render: (_: any, record: Team) => {
        const total = getTeamTotalScore(record.teamId);
        return (
          <Text strong style={{ color: total !== null ? '#1677ff' : '#8c8c8c', fontSize: '14px' }}>
            {total !== null ? `${total} / ${totalMaxMarks}` : '—'}
          </Text>
        );
      },
      sorter: (a: Team, b: Team) => (getTeamTotalScore(a.teamId) || 0) - (getTeamTotalScore(b.teamId) || 0),
    },
    {
      title: 'Account Status',
      dataIndex: 'status',
      key: 'status',
      render: (st: string) => <StatusBadge status={st} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Team) => {
        const menuItems: any[] = [
          {
            key: 'view',
            icon: <EyeOutlined />,
            label: 'View Details',
            onClick: () => {
              setSelectedTeam(record);
              setIsViewModalOpen(true);
            },
          },
          {
            key: 'edit',
            icon: <EditOutlined />,
            label: 'Edit Team Info',
            onClick: () => {
              setSelectedTeam(record);
              editForm.setFieldsValue({
                teamName: record.teamName,
                leaderName: record.leaderName,
              });
              setIsEditModalOpen(true);
            },
          },
          {
            key: 'reset-pass',
            icon: <KeyOutlined />,
            label: 'Reset Password',
            onClick: () => {
              setSelectedTeam(record);
              resetPassForm.resetFields();
              setIsResetPassModalOpen(true);
            },
          },
          {
            key: 'force-logout',
            icon: <LogoutOutlined />,
            label: 'Force Logout',
            danger: true,
            onClick: () => handleForceLogout(record),
          },
          {
            key: 'toggle-status',
            icon: record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />,
            label: record.status === 'active' ? 'Disable Account' : 'Enable Account',
            danger: record.status === 'active',
            onClick: () => handleToggleStatus(record),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete-team',
            icon: <DeleteOutlined />,
            label: 'Delete Team',
            danger: true,
            onClick: () => handleDeleteTeam(record),
          },
        ];

        return (
          <Space>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setSelectedTeam(record);
                editForm.setFieldsValue({
                  teamName: record.teamName,
                  leaderName: record.leaderName,
                });
                setIsEditModalOpen(true);
              }}
            >
              Edit
            </Button>
            <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
              <Button size="small" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <Title level={3} style={{ margin: 0 }}>
              Team Account Management
            </Title>
            <Text type="secondary">
              Total registered teams: <Text strong>{teams.length}</Text> | Active:{' '}
              <Text strong style={{ color: '#52c41a' }}>
                {teams.filter((t) => t.status === 'active').length}
              </Text>{' '}
              | Disabled:{' '}
              <Text strong style={{ color: '#ff4d4f' }}>
                {teams.filter((t) => t.status === 'disabled').length}
              </Text>
            </Text>
          </div>

          <Space wrap>
            <Input
              placeholder="Search by Team ID, Name, Leader, Username..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 300 }}
              allowClear
            />
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setIsAddModalOpen(true)}
              style={{ borderRadius: 8, background: '#1677ff' }}
            >
              Add New Team
            </Button>
          </Space>
        </div>

        <Table
          dataSource={filteredTeams}
          columns={columns}
          rowKey="teamId"
          pagination={{ pageSize: 15, showSizeChanger: true }}
          size="middle"
        />
      </Card>

      {/* ADD TEAM MODAL */}
      <AddTeamModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          setIsAddModalOpen(false);
        }}
      />

      {/* VIEW TEAM MODAL */}
      <Modal
        title={`Team Details — ${selectedTeam?.teamId}`}
        open={isViewModalOpen}
        onCancel={() => setIsViewModalOpen(false)}
        footer={null}
        width={600}
      >
        {selectedTeam && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Text type="secondary">Team ID:</Text>
                <div><Tag color="blue">{selectedTeam.teamId}</Tag></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Status:</Text>
                <div><StatusBadge status={selectedTeam.status} /></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Team Name:</Text>
                <div><Text strong>{selectedTeam.teamName}</Text></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Leader Name:</Text>
                <div><Text strong>{selectedTeam.leaderName}</Text></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Username:</Text>
                <div><Text code>{selectedTeam.username}</Text></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Selection Status:</Text>
                <div><Tag color={getTeamSelection(selectedTeam.teamId) === 'SELECTED' ? 'green' : 'default'}>{getTeamSelection(selectedTeam.teamId)}</Tag></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Registered At:</Text>
                <div><Text>{formatISTDateTime(selectedTeam.createdAt)}</Text></div>
              </Col>
              <Col span={12}>
                <Text type="secondary">Total Score:</Text>
                <div><Text strong style={{ color: '#1677ff' }}>{getTeamTotalScore(selectedTeam.teamId) ?? 'Pending'} / {totalMaxMarks} Marks</Text></div>
              </Col>
              <Col span={24}>
                <Text type="secondary">Assigned Problem Statement:</Text>
                <div style={{ marginTop: 4 }}>
                  {selectedTeam.assignedStatementId || selectedTeam.problemStatementId ? (
                    <Space size={6}>
                      {selectedTeam.assignedProblemOrder && (
                        <Tag color="blue" style={{ fontWeight: 800 }}>
                          Problem #{selectedTeam.assignedProblemOrder}
                        </Tag>
                      )}
                      <Tag color="green" style={{ fontWeight: 700 }}>
                        {selectedTeam.assignedStatementId || selectedTeam.problemStatementId}
                      </Tag>
                      {selectedTeam.assignedStatementTitle && (
                        <Text strong style={{ fontSize: '13px' }}>
                          {selectedTeam.assignedStatementTitle}
                        </Text>
                      )}
                    </Space>
                  ) : (
                    <Tag color="default">UNASSIGNED</Tag>
                  )}
                </div>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* EDIT TEAM MODAL */}
      <Modal
        title={`Edit Details — ${selectedTeam?.teamId}`}
        open={isEditModalOpen}
        onCancel={() => setIsEditModalOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={loadingAction}
        okText="Save Changes"
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditTeam}>
          <Form.Item
            name="teamName"
            label="Team Name"
            rules={[{ required: true, message: 'Please enter team name' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="leaderName"
            label="Leader Full Name"
            rules={[{ required: true, message: 'Please enter leader name' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* RESET PASSWORD MODAL */}
      <Modal
        title={`Reset Password — ${selectedTeam?.teamId}`}
        open={isResetPassModalOpen}
        onCancel={() => setIsResetPassModalOpen(false)}
        onOk={() => resetPassForm.submit()}
        confirmLoading={loadingAction}
        okText="Set New Password"
      >
        <Paragraph type="secondary">
          Enter a new password for <Text strong>{selectedTeam?.username}</Text>. The team will be logged out of existing sessions and must use the new password.
        </Paragraph>
        <Form form={resetPassForm} layout="vertical" onFinish={handleResetPassword}>
          <Form.Item
            name="newPassword"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter new password' },
              { min: 6, message: 'Password must be at least 6 characters' },
            ]}
          >
            <Input.Password placeholder="Min 6 characters..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
