import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Input,
  Tag,
  Modal,
  Form,
  Typography,
  message,
  Dropdown,
  Row,
  Col,
  Badge,
  Tooltip,
} from 'antd';
import {
  UserAddOutlined,
  SearchOutlined,
  MoreOutlined,
  EditOutlined,
  StopOutlined,
  CheckCircleOutlined,
  LogoutOutlined,
  KeyOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  subscribeToTeams,
  createTeamAccount,
  disableTeam,
  enableTeam,
  resetTeamPassword,
  forceLogoutTeam,
  updateTeamInfo,
} from '../../services/accounts.service';
import { Team } from '../../types';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;

export const AccountsPage: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isResetPassModalOpen, setIsResetPassModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetPassForm] = Form.useForm();

  useEffect(() => {
    const unsub = subscribeToTeams(setTeams);
    return () => unsub();
  }, []);

  const filteredTeams = teams.filter((t) => {
    const term = searchTerm.toLowerCase();
    return (
      t.teamId.toLowerCase().includes(term) ||
      t.teamName.toLowerCase().includes(term) ||
      t.leaderName.toLowerCase().includes(term) ||
      t.username.toLowerCase().includes(term)
    );
  });

  const handleCreateAccount = async (values: any) => {
    setLoadingAction(true);
    try {
      await createTeamAccount(values);
      message.success(`Team account ${values.teamId} created successfully!`);
      setIsAddModalOpen(false);
      addForm.resetFields();
    } catch (err: any) {
      message.error(err.message || 'Failed to create account.');
    } finally {
      setLoadingAction(false);
    }
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
      content: 'This will invalidate the current active device session immediately. The team will be logged out on their client.',
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

  const columns = [
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700, fontSize: '13px' }}>{id}</Tag>,
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
      sorter: (a: Team, b: Team) => a.teamName.localeCompare(b.teamName),
    },
    {
      title: 'Leader Name',
      dataIndex: 'leaderName',
      key: 'leaderName',
      render: (leader: string) => <Text>{leader}</Text>,
    },
    {
      title: 'Account Status',
      dataIndex: 'status',
      key: 'status',
      render: (st: string) => <StatusBadge status={st} />,
      filters: [
        { text: 'Active', value: 'active' },
        { text: 'Disabled', value: 'disabled' },
      ],
      onFilter: (value: any, record: Team) => record.status === value,
    },
    {
      title: 'Current Session',
      key: 'session',
      render: (_: any, record: Team) => (
        <Badge
          status={record.status === 'disabled' ? 'error' : 'success'}
          text={record.status === 'disabled' ? 'Locked' : 'Single Session'}
        />
      ),
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (time: any) => formatISTDateTime(time),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Team) => {
        const menuItems = [
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
              Team Accounts Management
            </Title>
            <Text type="secondary">
              Directly provision, monitor sessions, reset passwords, or force logout team accounts ({teams.length} total)
            </Text>
          </div>
          <Space>
            <Input
              placeholder="Search team ID, name, leader..."
              prefix={<SearchOutlined />}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: 280, borderRadius: 8 }}
              allowClear
            />
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => {
                addForm.resetFields();
                setIsAddModalOpen(true);
              }}
              style={{ borderRadius: 8 }}
            >
              ADD ACCOUNT
            </Button>
          </Space>
        </div>

        <Table
          dataSource={filteredTeams}
          columns={columns}
          rowKey="teamId"
          pagination={{ pageSize: 10, showSizeChanger: true }}
          size="middle"
        />
      </Card>

      {/* ADD ACCOUNT MODAL */}
      <Modal
        title={
          <Space>
            <UserAddOutlined style={{ color: '#1677ff' }} />
            <span>Create Team Account</span>
          </Space>
        }
        open={isAddModalOpen}
        onCancel={() => setIsAddModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
      >
        <Form form={addForm} layout="vertical" onFinish={handleCreateAccount}>
          <Form.Item name="teamName" label="Team Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. AI Warriors" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="teamId" label="Team ID" rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="e.g. TEAM001" style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="leaderName" label="Leader Name" rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="e.g. Abishek" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. TEAM001" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="password"
                label="Password"
                rules={[{ required: true, message: 'Required' }, { min: 6, message: 'Min 6 chars' }]}
              >
                <Input.Password placeholder="••••••••" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'Required' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('Passwords do not match'));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loadingAction} icon={<UserAddOutlined />}>
              CREATE ACCOUNT
            </Button>
          </div>
        </Form>
      </Modal>

      {/* EDIT TEAM MODAL */}
      <Modal
        title={`Edit Team: ${selectedTeam?.teamId}`}
        open={isEditModalOpen}
        onCancel={() => setIsEditModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditTeam}>
          <Form.Item name="teamName" label="Team Name" rules={[{ required: true, message: 'Required' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="leaderName" label="Leader Name" rules={[{ required: true, message: 'Required' }]}>
            <Input />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loadingAction}>
              Save Changes
            </Button>
          </div>
        </Form>
      </Modal>

      {/* RESET PASSWORD MODAL */}
      <Modal
        title={`Reset Password for ${selectedTeam?.teamId}`}
        open={isResetPassModalOpen}
        onCancel={() => setIsResetPassModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
      >
        <Paragraph type="secondary" style={{ fontSize: '13px' }}>
          This will securely update the password via Firebase Admin SDK and immediately invalidate all current sessions for this team.
        </Paragraph>
        <Form form={resetPassForm} layout="vertical" onFinish={handleResetPassword}>
          <Form.Item
            name="newPassword"
            label="New Password"
            rules={[{ required: true, message: 'Please enter new password' }, { min: 6, message: 'Min 6 characters' }]}
          >
            <Input.Password placeholder="Enter new password" />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setIsResetPassModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loadingAction} icon={<KeyOutlined />}>
              Set New Password
            </Button>
          </div>
        </Form>
      </Modal>

      {/* VIEW TEAM MODAL */}
      <Modal
        title={`Team Profile: ${selectedTeam?.teamId}`}
        open={isViewModalOpen}
        onCancel={() => setIsViewModalOpen(false)}
        footer={<Button onClick={() => setIsViewModalOpen(false)}>Close</Button>}
        centered
      >
        {selectedTeam && (
          <div style={{ lineHeight: 2 }}>
            <div><Text type="secondary">Team ID: </Text><Tag color="blue">{selectedTeam.teamId}</Tag></div>
            <div><Text type="secondary">Team Name: </Text><Text strong>{selectedTeam.teamName}</Text></div>
            <div><Text type="secondary">Leader Name: </Text><Text>{selectedTeam.leaderName}</Text></div>
            <div><Text type="secondary">Login Username: </Text><Text code>{selectedTeam.username}</Text></div>
            <div><Text type="secondary">Account Status: </Text><StatusBadge status={selectedTeam.status} /></div>
            <div><Text type="secondary">Created Timestamp: </Text><Text>{formatISTDateTime(selectedTeam.createdAt)}</Text></div>
          </div>
        )}
      </Modal>
    </div>
  );
};
