import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Tag,
  Alert,
  Form,
  Input,
  Button,
  Space,
  message,
  Divider,
  Row,
  Col,
  Popconfirm,
} from 'antd';
import {
  CodeOutlined,
  GithubOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  SaveOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { subscribeToRounds } from '../../services/rounds.service';
import {
  subscribeToTeamSubmissions,
  submitGithubRecord,
  removeSubmissionRecord,
} from '../../services/submissions.service';
import {
  subscribeToTimingConfig,
  calculateRoundTimingEvaluation,
} from '../../services/timing.service';
import { Round, Submission, HackathonTimingConfig } from '../../types';
import { CountdownTimer } from '../../components/common/CountdownTimer';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export const Round3Page: React.FC = () => {
  const { user } = useAuth();
  const { round3MaxMarks } = useScoring();
  const teamId = user?.teamId || '';
  const teamName = user?.displayName || 'Team';

  const [round, setRound] = useState<Round | null>(null);
  const [timingConfig, setTimingConfig] = useState<HackathonTimingConfig | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [form] = Form.useForm();

  useEffect(() => {
    const unsubRound = subscribeToRounds((rounds) => {
      const r3 = rounds.find((r) => r.id === 'round3') || rounds[2];
      setRound(r3 || null);
    });

    const unsubTiming = subscribeToTimingConfig(setTimingConfig);

    const unsubSub = subscribeToTeamSubmissions(teamId, (subs) => {
      const sub = subs.find((s) => (s.roundId || '').includes('3') || s.round === 3);
      setSubmission(sub || null);
      if (sub) {
        form.setFieldsValue({
          githubUrl: sub.githubUrl || sub.repositoryUrl,
          prototypeUrl: sub.prototypeUrl,
          notes: sub.notes,
        });
      }
    });

    return () => {
      unsubRound();
      unsubTiming();
      unsubSub();
    };
  }, [teamId, form]);

  const timingEval = calculateRoundTimingEvaluation('round3', timingConfig, round);
  const isUploadAllowed = timingEval.isUploadAllowed;
  const maxMarks = round?.maxMarks || round3MaxMarks;

  const handleSubmit = async (values: any) => {
    if (!isUploadAllowed) {
      if (timingEval.state === 'UPCOMING') {
        message.error('Round 3 has not started yet. Submissions are not open.');
      } else if (timingEval.state === 'ENDED') {
        message.error('Submission period has ended. Uploads are closed.');
      } else {
        message.error('Round 3 is currently closed for submissions.');
      }
      return;
    }

    const githubUrl = values.githubUrl?.trim();
    if (!githubUrl || !githubUrl.startsWith('https://github.com/')) {
      message.error('Please enter a valid GitHub repository URL (https://github.com/owner/repo)');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitGithubRecord(teamId, teamName, 'round3', {
        githubUrl,
        prototypeUrl: values.prototypeUrl?.trim() || '',
        notes: values.notes?.trim() || '',
      });

      message.success('Round 3 Prototype & Repository submission successfully recorded!');
    } catch (err: any) {
      message.error(err.message || 'Failed to submit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveSubmission = async () => {
    setIsRemoving(true);
    try {
      await removeSubmissionRecord(teamId, 'round3');
      message.success('Round 3 submission removed successfully.');
      setSubmission(null);
      form.resetFields();
    } catch (err: any) {
      console.error('Round 3 Remove failed:', err);
      message.error(err.message || 'Failed to remove submission.');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ marginBottom: 8 }}>
          <Tag color="purple" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            ROUND 3
          </Tag>
          <Tag color="purple" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            MAX {maxMarks} MARKS
          </Tag>
        </Space>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Round 3 — Prototype & Code Repository Submission
        </Title>
        <Text type="secondary">
          Submit your public GitHub repository link, prototype deployment URL, and setup documentation
        </Text>
      </div>

      {/* Round Timing Status Banners */}
      {(timingEval.state === 'SCHEDULED' || timingEval.state === 'UPCOMING' || timingEval.state === 'NOT_STARTED') && (
        <Alert
          message="Waiting for Admin to start this round."
          description={`Scheduled: ${formatISTDateTime(timingEval.startTime)} → ${formatISTDateTime(timingEval.endTime)}. Submissions will open immediately when Administrator clicks START ROUND.`}
          type="info"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {timingEval.state === 'PAUSED' && (
        <Alert
          message="Round 3 is currently PAUSED by Administrator."
          description="Submissions are temporarily suspended until the round is resumed."
          type="warning"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {(timingEval.state === 'ACTIVE' || timingEval.state === 'LIVE') && (
        <Card
          bordered={false}
          style={{
            borderRadius: 12,
            marginBottom: 24,
            background: '#f9f0ff',
            borderColor: '#d3adf7',
            boxShadow: '0 2px 8px rgba(114, 46, 209, 0.08)',
          }}
        >
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} md={14}>
              <Text strong style={{ color: '#531dab', fontSize: '15px' }}>
                🟢 Round 3 is LIVE and accepting submissions
              </Text>
              <div style={{ fontSize: '13px', color: '#722ed1', marginTop: 4 }}>
                Submissions close: {formatISTDateTime(timingEval.endTime)}
              </div>
            </Col>
            <Col xs={24} md={10}>
              <CountdownTimer
                endTime={timingEval.endTime}
                status="ACTIVE"
                title="Time Remaining"
              />
            </Col>
          </Row>
        </Card>
      )}

      {timingEval.state === 'ENDED' && (
        <Alert
          message="Round 3 has ended."
          description="The Round 3 deadline has passed. New submissions and modifications are now blocked. Existing repository records remain available for evaluation."
          type="error"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {timingEval.state === 'LOCKED' && (
        <Alert
          message="Round 3 is locked by Administrator."
          description="Submissions are not currently open."
          type="info"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {/* Guidelines */}
      <Card
        title="Prototype & Repository Guidelines"
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Paragraph style={{ fontSize: '14px', lineHeight: 1.8 }}>
          Provide the link to your functional GitHub code repository and deployed web/mobile application.
        </Paragraph>
        <ul style={{ paddingLeft: 20, fontSize: '13px', lineHeight: 2, color: '#4b5563' }}>
          <li>Repository must be publicly accessible on GitHub (<Text code>https://github.com/username/repository</Text>).</li>
          <li>Include README with build and deployment instructions.</li>
          <li>Manual scoring rubric: Maximum {maxMarks} Marks.</li>
        </ul>
      </Card>

      {/* Submission Form */}
      <Card
        title={
          <Space>
            <CodeOutlined style={{ color: '#722ed1' }} />
            <span>Round 3 Submission Workspace</span>
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        {submission && (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: 20, borderRadius: 10, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <CheckCircleOutlined style={{ fontSize: '28px', color: '#52c41a' }} />
              <div>
                <Title level={4} style={{ margin: 0, color: '#237804' }}>
                  Prototype Submission Received ✓
                </Title>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Submitted on {formatISTDateTime(submission.submittedAt)} (Version {submission.version})
                </Text>
              </div>
            </div>

            <Divider style={{ margin: '16px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <Text strong>Repository: </Text>
                  <a href={submission.githubUrl} target="_blank" rel="noopener noreferrer">
                    {submission.githubUrl}
                  </a>
                </div>
                {submission.prototypeUrl && (
                  <div>
                    <Text strong>Live Application: </Text>
                    <a href={submission.prototypeUrl} target="_blank" rel="noopener noreferrer">
                      {submission.prototypeUrl}
                    </a>
                  </div>
                )}
                {submission.notes && (
                  <div>
                    <Text strong>Setup Notes: </Text>
                    <Text type="secondary">{submission.notes}</Text>
                  </div>
                )}
              </div>

              <Popconfirm
                title="Remove Submission"
                description="Are you sure you want to remove this submission file? This action cannot be undone."
                onConfirm={handleRemoveSubmission}
                okText="Yes, Remove"
                cancelText="Cancel"
                okButtonProps={{ danger: true, loading: isRemoving }}
              >
                <Button danger icon={<DeleteOutlined />} loading={isRemoving}>
                  Remove
                </Button>
              </Popconfirm>
            </div>
          </div>
        )}

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="githubUrl"
            label={<Text strong>GitHub Repository URL</Text>}
            rules={[
              { required: true, message: 'Please enter public GitHub repository URL' },
              {
                pattern: /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/,
                message: 'Must be a valid GitHub URL (https://github.com/owner/repo)',
              },
            ]}
          >
            <Input
              prefix={<GithubOutlined />}
              placeholder="https://github.com/organization/project-name"
              size="large"
              disabled={!isUploadAllowed || isSubmitting}
            />
          </Form.Item>

          <Form.Item
            name="prototypeUrl"
            label={<Text strong>Live Application / Prototype URL (Optional)</Text>}
          >
            <Input
              prefix={<LinkOutlined />}
              placeholder="https://my-hackathon-project.vercel.app"
              size="large"
              disabled={!isUploadAllowed || isSubmitting}
            />
          </Form.Item>

          <Form.Item
            name="notes"
            label={<Text strong>Architecture Highlights & Setup Instructions</Text>}
          >
            <TextArea
              rows={4}
              placeholder="Describe environment setup, key architectural decisions, test accounts, or Docker instructions..."
              disabled={!isUploadAllowed || isSubmitting}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              icon={<SaveOutlined />}
              disabled={!isUploadAllowed || isSubmitting}
              loading={isSubmitting}
              style={{ background: '#722ed1', borderColor: '#722ed1' }}
            >
              {submission ? 'UPDATE REPOSITORY SUBMISSION' : `SUBMIT ROUND 3 (${maxMarks} MARKS)`}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};
