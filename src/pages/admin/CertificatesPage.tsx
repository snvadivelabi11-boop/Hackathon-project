import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Typography,
  Select,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Upload,
  message,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Progress,
  Alert,
} from 'antd';
import {
  SafetyCertificateOutlined,
  UploadOutlined,
  PlusOutlined,
  DeleteOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  StopOutlined,
  FilePdfOutlined,
  SearchOutlined,
  FileDoneOutlined,
} from '@ant-design/icons';
import { subscribeToTeams } from '../../services/accounts.service';
import {
  subscribeToAllMembers,
  addTeamMember,
  removeTeamMember,
  uploadMemberCertificate,
  setCertificatePublishStatus,
  validateCertificateFile,
} from '../../services/certificates.service';
import { Team, TeamMember } from '../../types';
import { safeString } from '../../utils/normalize';

const { Title, Text, Paragraph } = Typography;

export const CertificatesPage: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [isUploadCertModalOpen, setIsUploadCertModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const [addMemberForm] = Form.useForm();

  useEffect(() => {
    const unsubTeams = subscribeToTeams(setTeams);
    const unsubMembers = subscribeToAllMembers(setMembers);
    return () => {
      unsubTeams();
      unsubMembers();
    };
  }, []);

  const query = safeString(search).toLowerCase();

  const filteredMembers = members.filter((m) => {
    const matchTeam = selectedTeamFilter === 'all' ? true : m.teamId === selectedTeamFilter;
    if (!query) return matchTeam;
    const memberName = safeString(m.memberName).toLowerCase();
    const teamId = safeString(m.teamId).toLowerCase();
    const role = safeString(m.role).toLowerCase();
    return matchTeam && (memberName.includes(query) || teamId.includes(query) || role.includes(query));
  });

  const totalCertificatesPublished = members.filter((m) => m.certificateStatus === 'PUBLISHED').length;

  const handleAddMember = async (values: any) => {
    setLoadingAction(true);
    try {
      await addTeamMember(values.teamId, values.memberName, values.role);
      message.success(`Member ${values.memberName} added to ${values.teamId}!`);
      setIsAddMemberModalOpen(false);
      addMemberForm.resetFields();
    } catch (err: any) {
      message.error(err.message || 'Failed to add member.');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeTeamMember(memberId);
      message.success('Team member removed.');
    } catch (err: any) {
      message.error(err.message || 'Failed to remove member.');
    }
  };

  const handleUploadCertificate = async () => {
    if (!selectedMember) {
      message.warning('No member selected.');
      return;
    }
    if (!selectedFile) {
      message.warning('Please select a PDF certificate file to upload.');
      return;
    }

    const validation = validateCertificateFile(selectedFile);
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid file.');
      message.error(validation.error);
      return;
    }

    setLoadingAction(true);
    setUploadProgress(10);
    setUploadError(null);

    try {
      await uploadMemberCertificate(
        selectedMember.teamId,
        selectedMember.memberId,
        selectedMember.memberName,
        selectedFile,
        (percent) => setUploadProgress(percent)
      );
      message.success(`Certificate uploaded & published for ${selectedMember.memberName}!`);
      setIsUploadCertModalOpen(false);
      setSelectedFile(null);
      setUploadProgress(0);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to upload certificate.';
      setUploadError(errMsg);
      message.error(errMsg);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleToggleCertificateStatus = async (member: TeamMember) => {
    const nextStatus = member.certificateStatus === 'PUBLISHED' ? 'DISABLED' : 'PUBLISHED';
    try {
      await setCertificatePublishStatus(member.memberId, nextStatus);
      message.success(`Certificate status updated to ${nextStatus}.`);
    } catch (err: any) {
      message.error(err.message || 'Failed to update certificate status.');
    }
  };

  const columns = [
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      width: 110,
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700 }}>{safeString(id) || '—'}</Tag>,
      sorter: (a: TeamMember, b: TeamMember) => safeString(a.teamId).localeCompare(safeString(b.teamId)),
    },
    {
      title: 'Member Name',
      dataIndex: 'memberName',
      key: 'memberName',
      render: (name: string, record: TeamMember) => (
        <div>
          <Text strong style={{ fontSize: '14px' }}>{safeString(name)}</Text>
          <div style={{ fontSize: '12px', color: '#8c8c8c' }}>{record.role || 'Team Member'}</div>
        </div>
      ),
    },
    {
      title: 'Certificate File',
      key: 'certificate',
      render: (_: any, record: TeamMember) => {
        return record.certificateUrl ? (
          <Space>
            <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: '16px' }} />
            <a
              href={record.certificateUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 600, color: '#1677ff' }}
            >
              View Certificate
            </a>
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              href={record.certificateUrl}
              target="_blank"
              download
            />
          </Space>
        ) : (
          <Tag color="default">Not Published</Tag>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'certificateStatus',
      key: 'certificateStatus',
      render: (st: string) => (
        <Tag color={st === 'PUBLISHED' ? 'green' : st === 'DISABLED' ? 'red' : 'orange'} style={{ fontWeight: 600 }}>
          {st || 'PENDING'}
        </Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TeamMember) => (
        <Space>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => {
              setSelectedMember(record);
              setSelectedFile(null);
              setUploadError(null);
              setUploadProgress(0);
              setIsUploadCertModalOpen(true);
            }}
          >
            {record.certificateUrl ? 'Replace' : 'Upload PDF'}
          </Button>

          {record.certificateUrl && (
            <Button
              size="small"
              icon={record.certificateStatus === 'PUBLISHED' ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={() => handleToggleCertificateStatus(record)}
            >
              {record.certificateStatus === 'PUBLISHED' ? 'Disable' : 'Publish'}
            </Button>
          )}

          <Popconfirm
            title="Remove team member?"
            onConfirm={() => handleRemoveMember(record.memberId)}
            okText="Remove"
            cancelText="Cancel"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Team Members & Certificate Management
        </Title>
        <Text type="secondary">
          Manage member rosters (~6 members per team), upload individual certificate files to Cloudinary, and publish downloads
        </Text>
      </div>

      {/* Top Metrics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Total Registered Members"
              value={members.length}
              suffix={`across ${teams.length} Teams`}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Certificates Published"
              value={totalCertificatesPublished}
              valueStyle={{ color: '#059669', fontWeight: 800 }}
              suffix={`/ ${members.length}`}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Team Member Portal"
              value="/team/certificates"
              valueStyle={{ fontSize: '18px', color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Main Card */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Space>
              <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
              <span>Team Members List ({filteredMembers.length})</span>
            </Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsAddMemberModalOpen(true)}
              style={{ borderRadius: 8, background: '#1677ff' }}
            >
              Add Member
            </Button>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Select
            value={selectedTeamFilter}
            onChange={setSelectedTeamFilter}
            style={{ width: 220 }}
            options={[
              { value: 'all', label: `All Teams (${teams.length})` },
              ...teams.map((t) => ({ value: t.teamId, label: `${t.teamId} — ${t.teamName}` })),
            ]}
          />
          <Input
            placeholder="Search by member name or team ID..."
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
            allowClear
          />
        </div>

        <Table
          dataSource={filteredMembers}
          columns={columns}
          rowKey="memberId"
          pagination={{ pageSize: 15 }}
          size="middle"
        />
      </Card>

      {/* ADD MEMBER MODAL */}
      <Modal
        title="Add Team Member"
        open={isAddMemberModalOpen}
        onCancel={() => setIsAddMemberModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
      >
        <Form form={addMemberForm} layout="vertical" onFinish={handleAddMember}>
          <Form.Item name="teamId" label="Assign to Team" rules={[{ required: true, message: 'Please select team' }]}>
            <Select
              showSearch
              placeholder="Select team..."
              options={teams.map((t) => ({ value: t.teamId, label: `${t.teamId} — ${t.teamName}` }))}
            />
          </Form.Item>

          <Form.Item name="memberName" label="Member Full Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Rahul Verma" />
          </Form.Item>

          <Form.Item name="role" label="Role (Optional)" initialValue="Developer">
            <Input placeholder="e.g. Frontend Developer / ML Engineer" />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setIsAddMemberModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loadingAction}>
              Add Member
            </Button>
          </div>
        </Form>
      </Modal>

      {/* UPLOAD CERTIFICATE MODAL */}
      <Modal
        title={`Upload Certificate: ${selectedMember?.memberName} (${selectedMember?.teamId})`}
        open={isUploadCertModalOpen}
        onCancel={() => {
          if (!loadingAction) {
            setIsUploadCertModalOpen(false);
            setSelectedFile(null);
            setUploadError(null);
          }
        }}
        footer={[
          <Button
            key="cancel"
            disabled={loadingAction}
            onClick={() => {
              setIsUploadCertModalOpen(false);
              setSelectedFile(null);
              setUploadError(null);
            }}
          >
            Cancel
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={loadingAction}
            disabled={!selectedFile}
            onClick={handleUploadCertificate}
            style={{ background: '#1677ff' }}
          >
            {loadingAction ? 'Uploading & Publishing...' : 'Upload & Publish'}
          </Button>,
        ]}
        centered
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Upload individual completion or merit certificate in PDF format for <strong>{selectedMember?.memberName}</strong>.
          The file will upload directly to Cloudinary and the link will be published in the team portal.
        </Paragraph>

        {uploadError && (
          <Alert
            message="Upload Failed"
            description={uploadError}
            type="error"
            showIcon
            closable
            onClose={() => setUploadError(null)}
            style={{ marginBottom: 16, borderRadius: 8 }}
          />
        )}

        <Upload
          beforeUpload={(file) => {
            setSelectedFile(file);
            setUploadError(null);
            return false;
          }}
          maxCount={1}
          accept=".pdf,.png,.jpg,.jpeg"
          onRemove={() => {
            setSelectedFile(null);
            setUploadError(null);
          }}
        >
          <Button icon={<UploadOutlined />} disabled={loadingAction}>
            Select Certificate File (PDF)
          </Button>
        </Upload>

        {selectedFile && (
          <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <Space>
              <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />
              <Text strong>{selectedFile.name}</Text>
              <Text type="secondary">({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</Text>
            </Space>
          </div>
        )}

        {loadingAction && uploadProgress > 0 && (
          <div style={{ marginTop: 16 }}>
            <Progress percent={uploadProgress} status="active" />
          </div>
        )}
      </Modal>
    </div>
  );
};
