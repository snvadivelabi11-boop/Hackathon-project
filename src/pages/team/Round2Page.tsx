import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Tag,
  Button,
  Space,
  Upload,
  Progress,
  message,
  Divider,
  Alert,
  Row,
  Col,
  Popconfirm,
} from 'antd';
import {
  UploadOutlined,
  CheckCircleOutlined,
  FilePptOutlined,
  FilePdfOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileDoneOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeToRound } from '../../services/rounds.service';
import {
  uploadSubmissionFile,
  submitFileRecord,
  removeSubmissionRecord,
  subscribeToTeamSubmissions,
  validateSubmissionFile,
  getSubmissionViewUrl,
  getSubmissionDownloadUrl,
} from '../../services/submissions.service';
import {
  subscribeToTimingConfig,
  calculateRoundTimingEvaluation,
} from '../../services/timing.service';
import { Round, Submission, HackathonTimingConfig } from '../../types';
import { CountdownTimer } from '../../components/common/CountdownTimer';
import { formatISTDateTime } from '../../utils/date';
import { useScoring } from '../../contexts/ScoringContext';

const { Title, Text, Paragraph } = Typography;

export const Round2Page: React.FC = () => {
  const { user } = useAuth();
  const { round2MaxMarks } = useScoring();
  const teamId = user?.teamId || '';
  const teamName = user?.displayName || 'Team';

  const [round, setRound] = useState<Round | null>(null);
  const [timingConfig, setTimingConfig] = useState<HackathonTimingConfig | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    const unsubRound = subscribeToRound('round2', setRound);
    const unsubTiming = subscribeToTimingConfig(setTimingConfig);
    const unsubSub = subscribeToTeamSubmissions(teamId, (subs) => {
      const r2 = subs.find((s) => (s.roundId || '').includes('2') || s.round === 2);
      setSubmission(r2 || null);
    });

    return () => {
      unsubRound();
      unsubTiming();
      unsubSub();
    };
  }, [teamId]);

  const timingEval = calculateRoundTimingEvaluation('round2', timingConfig, round);
  const isUploadAllowed = timingEval.isUploadAllowed;
  const maxMarks = round?.maxMarks || round2MaxMarks;

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      message.warning('Please select a presentation file (.ppt, .pptx, .pdf) to upload.');
      return;
    }

    if (!isUploadAllowed) {
      if (timingEval.state === 'UPCOMING') {
        message.error('Round has not started yet. Submissions are not open.');
      } else if (timingEval.state === 'ENDED') {
        message.error('Submission period has ended. Uploads are closed.');
      } else {
        message.error('Submissions are currently closed for this round.');
      }
      return;
    }

    const validation = validateSubmissionFile('round2', selectedFile);
    if (!validation.valid) {
      setUploadError(validation.error || 'File validation failed.');
      message.error(validation.error || 'File validation failed.');
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const fileData = await uploadSubmissionFile(teamId, 'round2', selectedFile, (p) => {
        setUploadProgress(p);
      });

      await submitFileRecord(teamId, teamName, 'round2', fileData);
      message.success('Round 2 Presentation slide deck successfully uploaded to Cloudinary!');
      setSelectedFile(null);
      setUploadProgress(100);
    } catch (err: any) {
      console.error('Round 2 Upload failed:', err);
      const errMsg = err.message || 'Submission upload failed. Please check your internet connection.';
      setUploadError(errMsg);
      message.error(errMsg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveSubmission = async () => {
    setIsRemoving(true);
    try {
      await removeSubmissionRecord(teamId, 'round2');
      message.success('Round 2 presentation file removed successfully.');
      setSubmission(null);
      setSelectedFile(null);
    } catch (err: any) {
      console.error('Round 2 Remove failed:', err);
      message.error(err.message || 'Failed to remove presentation file.');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ marginBottom: 8 }}>
          <Tag color="cyan" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            ROUND 2
          </Tag>
          <Tag color="purple" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            MAX {maxMarks} MARKS
          </Tag>
          <Tag color="blue" icon={<CloudUploadOutlined />}>
            Cloudinary Storage
          </Tag>
        </Space>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Round 2 — Technical Presentation Submission
        </Title>
        <Text type="secondary">
          Upload slide deck covering solution architecture, algorithm design, business value, and milestones
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
          message="Round 2 is currently PAUSED by Administrator."
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
            background: '#ecfdf5',
            borderColor: '#a7f3d0',
            boxShadow: '0 2px 8px rgba(5, 150, 105, 0.08)',
          }}
        >
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} md={14}>
              <Text strong style={{ color: '#065f46', fontSize: '15px' }}>
                🟢 Round 2 is LIVE and accepting submissions
              </Text>
              <div style={{ fontSize: '13px', color: '#047857', marginTop: 4 }}>
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
          message="Round 2 has ended."
          description="The submission deadline has passed. New uploads and edits are closed. Existing submissions remain available for evaluation."
          type="error"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {timingEval.state === 'LOCKED' && (
        <Alert
          message="Round 2 is locked by Administrator."
          description="Submissions are not currently open."
          type="info"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {/* Presentation Guidelines */}
      <Card
        title="Presentation Requirements & Guidelines"
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Paragraph style={{ fontSize: '14px', lineHeight: 1.8 }}>
          {round?.problemStatement ||
            'Prepare a comprehensive engineering presentation detailing problem definition, system design, technical innovation, database schemas, algorithm complexity, and prototype demo roadmap.'}
        </Paragraph>

        <Divider style={{ margin: '16px 0' }} />

        <Title level={5}>Submission Format Requirements:</Title>
        <ul style={{ paddingLeft: 20, color: '#475569', lineHeight: 1.8 }}>
          <li>Submit presentation slides in <strong>.PPT, .PPTX, or .PDF</strong> format.</li>
          <li>Maximum file size: <strong>50 MB</strong>.</li>
          <li>Files are securely stored on Cloudinary under <code>hackathon/teams/{teamId}/round2/</code>.</li>
          <li>Manual scoring rubric: Maximum {maxMarks} Marks.</li>
        </ul>
      </Card>

      {/* Submission Workspace Card */}
      <Card
        title={
          <Space>
            <FileDoneOutlined style={{ color: '#722ed1' }} />
            <span>Round 2 Slide Deck Workspace</span>
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        {submission ? (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: 20, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <CheckCircleOutlined style={{ fontSize: '28px', color: '#52c41a' }} />
              <div>
                <Title level={4} style={{ margin: 0, color: '#237804' }}>
                  Presentation Slide Deck Received ✓
                </Title>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Submitted on {formatISTDateTime(submission.submittedAt)} (Version {submission.version})
                </Text>
              </div>
            </div>

            <Divider style={{ margin: '16px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <Space>
                {submission.fileName?.toLowerCase().endsWith('.pdf') ? (
                  <FilePdfOutlined style={{ fontSize: '22px', color: '#ff4d4f' }} />
                ) : (
                  <FilePptOutlined style={{ fontSize: '22px', color: '#fa8c16' }} />
                )}
                <div>
                  <Text strong>{submission.fileName}</Text>
                  {submission.fileSizeBytes ? (
                    <Text type="secondary" style={{ fontSize: '12px', marginLeft: 8 }}>
                      ({(submission.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)
                    </Text>
                  ) : null}
                </div>
              </Space>

              <Space>
                <Button
                  type="primary"
                  icon={<EyeOutlined />}
                  href={getSubmissionViewUrl(submission)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                >
                  View Deck
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  href={getSubmissionDownloadUrl(submission)}
                  target="_blank"
                  download={submission.fileName || true}
                >
                  Download
                </Button>
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
              </Space>
            </div>
          </div>
        ) : (
          <div>
            <Paragraph type="secondary">
              Upload your presentation deck (.pptx, .ppt, .pdf) before the round deadline.
            </Paragraph>

            <Upload
              beforeUpload={(file) => {
                const validation = validateSubmissionFile('round2', file);
                if (!validation.valid) {
                  setUploadError(validation.error || 'Invalid file');
                  message.error(validation.error);
                  return Upload.LIST_IGNORE;
                }
                setUploadError(null);
                setSelectedFile(file);
                return false;
              }}
              maxCount={1}
              accept=".ppt,.pptx,.pdf"
              disabled={!isUploadAllowed || isUploading}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />} size="large" disabled={!isUploadAllowed || isUploading}>
                Select Slide Deck (.pptx, .ppt, .pdf)
              </Button>
            </Upload>

            {selectedFile && (
              <div style={{ marginTop: 16, background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <Text strong>Selected Presentation: </Text>
                <Text>{selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</Text>
              </div>
            )}

            {uploadError && (
              <Alert
                type="error"
                showIcon
                message="Upload Error"
                description={uploadError}
                style={{ marginTop: 16, borderRadius: 8 }}
              />
            )}

            {isUploading && (
              <div style={{ marginTop: 16 }}>
                <Progress percent={uploadProgress} status="active" />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Uploading slide deck to Cloudinary storage...
                </Text>
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <Button
                type="primary"
                size="large"
                disabled={!selectedFile || !isUploadAllowed || isUploading}
                loading={isUploading}
                onClick={handleUploadSubmit}
                style={{ borderRadius: 8, background: '#722ed1', borderColor: '#722ed1' }}
              >
                CONFIRM & SUBMIT ROUND 2 ({maxMarks} MARKS)
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
