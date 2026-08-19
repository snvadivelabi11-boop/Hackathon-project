import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Typography,
  Tag,
  Button,
  Space,
  Row,
  Col,
  Alert,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Statistic,
} from 'antd';
import {
  SafetyCertificateOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  UserOutlined,
  UserAddOutlined,
  DeleteOutlined,
  CrownOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeToTeamMembers, addTeamMember, removeTeamMember } from '../../services/certificates.service';
import { TeamMember } from '../../types';
import { safeString } from '../../utils/normalize';

const { Title, Text, Paragraph } = Typography;

const MAX_TEAM_MEMBERS = 6;

export const TeamCertificatesPage: React.FC = () => {
  const { user } = useAuth();
  const teamId = user?.teamId || '';
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!teamId) return;
    const unsub = subscribeToTeamMembers(teamId, setMembers);
    return () => unsub();
  }, [teamId]);

  const publishedCount = members.filter((m) => m.certificateStatus === 'PUBLISHED' && m.certificateUrl).length;

  const handleAddMember = async (values: any) => {
    if (members.length >= MAX_TEAM_MEMBERS) {
      message.error(`Maximum team capacity reached (${MAX_TEAM_MEMBERS} members).`);
      return;
    }

    setSubmitting(true);
    try {
      await addTeamMember(teamId, values.memberName, values.role || 'Member');
      message.success(`${values.memberName} added to your team roster!`);
      setIsAddModalOpen(false);
      form.resetFields();
    } catch (err: any) {
      message.error(err.message || 'Failed to add member.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    try {
      await removeTeamMember(memberId);
      message.success(`${memberName} removed from team roster.`);
    } catch (err: any) {
      message.error(err.message || 'Failed to remove member.');
    }
  };

  const columns = [
    {
      title: 'Team Member',
      dataIndex: 'memberName',
      key: 'memberName',
      render: (name: string, record: TeamMember) => {
        const isLeader = record.role?.toLowerCase().includes('leader') || record.memberId?.endsWith('_M01');
        return (
          <Space orientation="horizontal" size={12}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: isLeader ? '#fef3c7' : '#e6f4ff',
                color: isLeader ? '#d97706' : '#1677ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {isLeader ? <CrownOutlined /> : <UserOutlined />}
            </div>
            <div>
              <Space>
                <Text strong style={{ fontSize: '14px' }}>
                  {safeString(name)}
                </Text>
                {isLeader && (
                  <Tag color="gold" style={{ fontSize: '11px', fontWeight: 700 }}>
                    LEADER
                  </Tag>
                )}
              </Space>
              <div style={{ fontSize: '12px', color: '#64748b' }}>{record.role || 'Developer'}</div>
            </div>
          </Space>
        );
      },
    },
    {
      title: 'Certificate Status',
      key: 'status',
      render: (_: any, record: TeamMember) => {
        const isPublished = record.certificateStatus === 'PUBLISHED' && Boolean(record.certificateUrl);
        return isPublished ? (
          <Space>
            <Tag color="green" style={{ fontWeight: 700 }}>
              Published
            </Tag>
            <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
          </Space>
        ) : (
          <Space>
            <Tag color="default" icon={<ClockCircleOutlined />}>
              Certificate not published yet
            </Tag>
          </Space>
        );
      },
    },
    {
      title: 'Actions',
      key: 'action',
      render: (_: any, record: TeamMember) => {
        const isPublished = record.certificateStatus === 'PUBLISHED' && Boolean(record.certificateUrl);
        const isLeader = record.role?.toLowerCase().includes('leader') || record.memberId?.endsWith('_M01');

        return (
          <Space wrap>
            {isPublished ? (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<EyeOutlined />}
                  href={record.certificateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: '#1677ff' }}
                >
                  View Certificate
                </Button>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  href={record.certificateUrl}
                  target="_blank"
                  download
                >
                  Download
                </Button>
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: '13px' }}>
                Pending admin evaluation
              </Text>
            )}

            {!isLeader && !isPublished && (
              <Popconfirm
                title={`Remove ${record.memberName} from team?`}
                onConfirm={() => handleRemoveMember(record.memberId, record.memberName)}
                okText="Remove"
                cancelText="Cancel"
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
            My Certificate & Team Members
          </Title>
          <Text type="secondary">
            Manage your team roster (up to {MAX_TEAM_MEMBERS} members) and download official verified certificates
          </Text>
        </div>

        <Button
          type="primary"
          icon={<UserAddOutlined />}
          onClick={() => setIsAddModalOpen(true)}
          disabled={members.length >= MAX_TEAM_MEMBERS}
          style={{ borderRadius: 8, background: '#1677ff' }}
        >
          Add Team Member ({members.length}/{MAX_TEAM_MEMBERS})
        </Button>
      </div>

      {/* Top Metrics Bar */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Team ID / Name"
              value={teamId}
              formatter={() => (
                <Text strong style={{ fontSize: '18px', color: '#1e3a8a' }}>
                  {user?.displayName || teamId}
                </Text>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Registered Members"
              value={members.length}
              suffix={`/ ${MAX_TEAM_MEMBERS} Max`}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Certificates Published"
              value={publishedCount}
              suffix={`/ ${members.length}`}
              valueStyle={{ color: publishedCount > 0 ? '#059669' : '#64748b', fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Instruction Banner */}
      <Alert
        message="Official Verified Certificates Portal"
        description={
          <span>
            The Team Leader is registered automatically. You can add up to {MAX_TEAM_MEMBERS - members.length} more teammates.
            Once the judging panel evaluates your project and uploads certificates, you can view and download individual PDF certificates below.
          </span>
        }
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        style={{ marginBottom: 24, borderRadius: 10 }}
      />

      {/* Members Table */}
      <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <Table
          dataSource={members}
          columns={columns}
          rowKey="memberId"
          pagination={false}
          size="middle"
        />
      </Card>

      {/* Add Member Modal */}
      <Modal
        title={`Add Team Member (${members.length + 1} of ${MAX_TEAM_MEMBERS})`}
        open={isAddModalOpen}
        onCancel={() => setIsAddModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
      >
        <Form form={form} layout="vertical" onFinish={handleAddMember}>
          <Form.Item
            name="memberName"
            label="Member Full Name"
            rules={[
              { required: true, message: 'Please enter member name' },
              { min: 2, message: 'Name must be at least 2 characters' },
            ]}
          >
            <Input placeholder="e.g. Priya Sharma" size="large" />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role in Team (Optional)"
            initialValue="Developer"
            rules={[{ required: true, message: 'Please specify role' }]}
          >
            <Input placeholder="e.g. Frontend Developer, Backend Developer, AI Engineer, UI/UX Designer" size="large" />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1677ff' }}>
              Add Member
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};
