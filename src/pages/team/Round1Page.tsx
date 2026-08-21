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
  Image,
  Popconfirm,
} from 'antd';
import {
  UploadOutlined,
  CheckCircleOutlined,
  FilePdfOutlined,
  FileImageOutlined,
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

export const Round1Page: React.FC = () => {
  const { user } = useAuth();
  const { round1MaxMarks } = useScoring();
  const teamId = user?.teamId || '';
  const teamName = user?.displayName || 'Team';

  const [round, setRound] = useState<Round | null>(null);
  const [timingConfig, setTimingConfig] = useState<HackathonTimingConfig | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<(File | null)[]>([null, null, null, null, null]);
  const [filePreviews, setFilePreviews] = useState<(string | null)[]>([null, null, null, null, null]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    const unsubRound = subscribeToRound('round1', setRound);
    const unsubTiming = subscribeToTimingConfig(setTimingConfig);
    const unsubSub = subscribeToTeamSubmissions(teamId, (subs) => {
      const r1 = subs.find((s) => (s.roundId || '').includes('1') || s.round === 1);
      setSubmission(r1 || null);
    });

    return () => {
      unsubRound();
      unsubTiming();
      unsubSub();
    };
  }, [teamId]);

  const timingEval = calculateRoundTimingEvaluation('round1', timingConfig, round);
  const isUploadAllowed = timingEval.isUploadAllowed;
  const maxMarks = round?.maxMarks || round1MaxMarks;

  const handleSelectSlotFile = (index: number, file: File) => {
    const validation = validateSubmissionFile('round1', file);
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid file format.');
      message.error(validation.error || 'Invalid file format.');
      return;
    }
    setUploadError(null);

    // Revoke old object URL if exists
    if (filePreviews[index]) {
      URL.revokeObjectURL(filePreviews[index]!);
    }

    const previewUrl = URL.createObjectURL(file);

    setSelectedFiles((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });

    setFilePreviews((prev) => {
      const next = [...prev];
      next[index] = previewUrl;
      return next;
    });
  };

  const handleRemoveSlotFile = (index: number) => {
    if (filePreviews[index]) {
      URL.revokeObjectURL(filePreviews[index]!);
    }
    setSelectedFiles((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setFilePreviews((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  };

  const selectedCount = selectedFiles.filter((f) => f !== null).length;
  const hasAtLeastOneFile = selectedCount > 0;

  const handleUploadSubmit = async () => {
    const activeFiles = selectedFiles
      .map((file, idx) => ({ file, slot: idx + 1 }))
      .filter((item): item is { file: File; slot: number } => item.file !== null);

    if (activeFiles.length === 0) {
      message.warning('Please select at least 1 image before submitting.');
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

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(5);

    try {
      const uploadedResults = [];
      for (let i = 0; i < activeFiles.length; i++) {
        const { file, slot } = activeFiles[i];
        const baseProgress = Math.round((i / activeFiles.length) * 90);
        const slotData = await uploadSubmissionFile(teamId, 'round1', file, (p) => {
          setUploadProgress(Math.min(95, baseProgress + Math.round((p / activeFiles.length) * 0.9)));
        });
        uploadedResults.push({ ...slotData, slot, order: i + 1 });
      }

      await submitFileRecord(teamId, teamName, 'round1', uploadedResults);
      setUploadProgress(100);
      message.success(`Round 1 Architecture solution (${uploadedResults.length} image${uploadedResults.length > 1 ? 's' : ''}) submitted successfully!`);

      // Cleanup previews
      filePreviews.forEach((p) => p && URL.revokeObjectURL(p));
      setSelectedFiles([null, null, null, null, null]);
      setFilePreviews([null, null, null, null, null]);
    } catch (err: any) {
      console.error('Round 1 Upload failed:', err);
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
      await removeSubmissionRecord(teamId, 'round1');
      message.success('Round 1 submission removed successfully.');
      setSubmission(null);
      setSelectedFiles([null, null, null, null, null]);
      setFilePreviews([null, null, null, null, null]);
    } catch (err: any) {
      console.error('Round 1 Remove failed:', err);
      message.error(err.message || 'Failed to remove submission file.');
    } finally {
      setIsRemoving(false);
    }
  };

  const submissionFiles = submission?.files && submission.files.length > 0
    ? submission.files
    : submission?.fileUrl
      ? [{
          fileUrl: submission.fileUrl,
          fileName: submission.fileName || 'Architecture Image',
          fileSizeBytes: submission.fileSizeBytes,
        }]
      : [];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ marginBottom: 8 }}>
          <Tag color="cyan" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            ROUND 1
          </Tag>
          <Tag color="purple" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            MAX {maxMarks} MARKS
          </Tag>
          <Tag color="blue" icon={<CloudUploadOutlined />}>
            Cloudinary Storage (Up to 5 Images)
          </Tag>
        </Space>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Round 1 — Architecture & System Flow Submission
        </Title>
        <Text type="secondary">
          Design modular system architecture, database schema, and high-throughput data flow pipelines
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
          message="Round 1 is currently PAUSED by Administrator."
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
                🟢 Round 1 is LIVE and accepting submissions
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
          message="Round 1 has ended."
          description="The submission deadline has passed. New uploads and edits are closed. Existing submissions remain available for evaluation."
          type="error"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {timingEval.state === 'LOCKED' && (
        <Alert
          message="Round 1 is locked by Administrator."
          description="Submissions are not currently open."
          type="info"
          showIcon
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {/* Problem Statement & Architecture Guidelines */}
      <Card
        title="Problem Statement & Architecture Guidelines"
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Paragraph style={{ fontSize: '14px', lineHeight: 1.8 }}>
          {round?.problemStatement ||
            'Design a scalable, fault-tolerant enterprise architecture handling 100,000 requests per second with strict zero data loss. Submit architecture diagrams, component specifications, and data flow pipelines.'}
        </Paragraph>

        <Divider style={{ margin: '16px 0' }} />

        <Title level={5}>Submission Requirements:</Title>
        <ul style={{ paddingLeft: 20, color: '#475569', lineHeight: 1.8 }}>
          <li>Upload up to <strong>5 separate image files</strong> (<strong>.png, .jpg, .jpeg</strong>). PDF files are not allowed for Round 1.</li>
          <li>You can upload <strong>1 to 5 images</strong> depending on your solution architecture diagram breakdown.</li>
          <li>Maximum file size: <strong>25 MB</strong> per image.</li>
          <li>Files are securely stored on Cloudinary under <code>hackathon/teams/{teamId}/round1/</code>.</li>
          <li>Manual scoring rubric: Maximum {maxMarks} Marks.</li>
        </ul>
      </Card>

      {/* Submission Workspace Card */}
      <Card
        title={
          <Space>
            <FileDoneOutlined style={{ color: '#1677ff' }} />
            <span>Round 1 Submission Workspace</span>
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        {submission && submissionFiles.length > 0 ? (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: 20, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <CheckCircleOutlined style={{ fontSize: '28px', color: '#52c41a' }} />
                <div>
                  <Title level={4} style={{ margin: 0, color: '#237804' }}>
                    Architecture Solution Received ({submissionFiles.length} Image{submissionFiles.length > 1 ? 's' : ''}) ✓
                  </Title>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Submitted on {formatISTDateTime(submission.submittedAt)} (Version {submission.version})
                  </Text>
                </div>
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
                  Remove Submission
                </Button>
              </Popconfirm>
            </div>

            <Divider style={{ margin: '16px 0' }} />

            <Row gutter={[16, 16]}>
              {submissionFiles.map((file, idx) => (
                <Col xs={24} sm={12} md={submissionFiles.length <= 2 ? 12 : submissionFiles.length === 3 ? 8 : 6} lg={submissionFiles.length <= 2 ? 12 : submissionFiles.length === 3 ? 8 : 4.8} style={{ flex: submissionFiles.length > 4 ? '1 1 180px' : undefined }} key={idx}>
                  <Card
                    size="small"
                    title={
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong>Image {idx + 1}</Text>
                        <Tag color="cyan" style={{ margin: 0 }}>✓ Stored</Tag>
                      </div>
                    }
                    style={{ borderRadius: 8, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}
                    bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                    cover={
                      <div style={{ height: 160, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <Image
                          src={getSubmissionViewUrl(file)}
                          alt={file.fileName || `Image ${idx + 1}`}
                          style={{ maxHeight: 160, width: '100%', objectFit: 'contain' }}
                        />
                      </div>
                    }
                  >
                    <div>
                      <div style={{ marginBottom: 8 }}>
                        <Text strong ellipsis style={{ display: 'block', fontSize: '12px' }} title={file.fileName}>
                          {file.fileName}
                        </Text>
                        {file.fileSizeBytes ? (
                          <Text type="secondary" style={{ fontSize: '11px' }}>
                            {(file.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                          </Text>
                        ) : null}
                      </div>

                      <Space wrap size="small" style={{ width: '100%', marginTop: 8 }}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<EyeOutlined />}
                          href={getSubmissionViewUrl(file)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ background: '#52c41a', borderColor: '#52c41a' }}
                        >
                          View
                        </Button>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          href={getSubmissionDownloadUrl(file)}
                          target="_blank"
                          download={file.fileName || true}
                        >
                          Download
                        </Button>
                      </Space>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        ) : (
          <div>
            <Paragraph type="secondary" style={{ marginBottom: 16 }}>
              Select up to <strong>5 separate image files</strong> (.png, .jpg, .jpeg) representing your system architecture diagrams, data models, or flowcharts. You must upload at least 1 image.
            </Paragraph>

            <Row gutter={[16, 16]}>
              {[0, 1, 2, 3, 4].map((slotIdx) => {
                const file = selectedFiles[slotIdx];
                const preview = filePreviews[slotIdx];
                const slotNumber = slotIdx + 1;
                const isRequiredSlot = slotIdx === 0;

                return (
                  <Col
                    xs={24}
                    sm={12}
                    md={8}
                    lg={8}
                    xl={4.8}
                    style={{ flex: '1 1 180px', minWidth: 170 }}
                    key={slotIdx}
                  >
                    <Card
                      size="small"
                      title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text strong>Image {slotNumber}</Text>
                          {file ? (
                            <Tag color="green" style={{ margin: 0 }}>Selected</Tag>
                          ) : (
                            <Tag color={isRequiredSlot ? 'blue' : 'default'} style={{ margin: 0 }}>
                              {isRequiredSlot ? 'Slot 1' : 'Optional'}
                            </Tag>
                          )}
                        </div>
                      }
                      style={{
                        borderRadius: 8,
                        border: file ? '1px solid #91caff' : '1px dashed #d9d9d9',
                        background: file ? '#f0f9ff' : '#fafafa',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                      bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 12 }}
                    >
                      {file && preview ? (
                        <div>
                          <div
                            style={{
                              height: 120,
                              borderRadius: 6,
                              overflow: 'hidden',
                              background: '#000',
                              marginBottom: 10,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <img
                              src={preview}
                              alt={`Slot ${slotNumber}`}
                              style={{ maxHeight: 120, maxWidth: '100%', objectFit: 'contain' }}
                            />
                          </div>
                          <Text strong ellipsis style={{ display: 'block', fontSize: '12px' }} title={file.name}>
                            {file.name}
                          </Text>
                          <Text type="secondary" style={{ fontSize: '11px', display: 'block', marginBottom: 8 }}>
                            {(file.size / (1024 * 1024)).toFixed(2)} MB
                          </Text>
                          <Space size="small" style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Upload
                              beforeUpload={(newFile) => {
                                handleSelectSlotFile(slotIdx, newFile);
                                return false;
                              }}
                              accept=".png,.jpg,.jpeg"
                              showUploadList={false}
                              disabled={!isUploadAllowed || isUploading}
                            >
                              <Button size="small" icon={<UploadOutlined />} disabled={!isUploadAllowed || isUploading}>
                                Replace
                              </Button>
                            </Upload>
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              disabled={!isUploadAllowed || isUploading}
                              onClick={() => handleRemoveSlotFile(slotIdx)}
                            >
                              Remove
                            </Button>
                          </Space>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '24px 8px' }}>
                          <Upload
                            beforeUpload={(newFile) => {
                              handleSelectSlotFile(slotIdx, newFile);
                              return false;
                            }}
                            accept=".png,.jpg,.jpeg"
                            showUploadList={false}
                            disabled={!isUploadAllowed || isUploading}
                          >
                            <div style={{ cursor: (!isUploadAllowed || isUploading) ? 'not-allowed' : 'pointer' }}>
                              <FileImageOutlined style={{ fontSize: 32, color: isRequiredSlot ? '#1677ff' : '#8c8c8c', marginBottom: 8 }} />
                              <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                                Upload Image {slotNumber}
                              </div>
                              <Text type="secondary" style={{ fontSize: '11px', display: 'block', marginTop: 4 }}>
                                .png, .jpg, .jpeg
                              </Text>
                              <Button
                                size="small"
                                icon={<UploadOutlined />}
                                style={{ marginTop: 12 }}
                                disabled={!isUploadAllowed || isUploading}
                              >
                                Select Image
                              </Button>
                            </div>
                          </Upload>
                        </div>
                      )}
                    </Card>
                  </Col>
                );
              })}
            </Row>

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
                  Uploading images securely to Cloudinary storage...
                </Text>
              </div>
            )}

            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
              <Button
                type="primary"
                size="large"
                disabled={!hasAtLeastOneFile || !isUploadAllowed || isUploading}
                loading={isUploading}
                onClick={handleUploadSubmit}
                style={{ borderRadius: 8, background: '#1677ff' }}
              >
                CONFIRM & SUBMIT ROUND 1 ({maxMarks} MARKS)
              </Button>
              {selectedCount > 0 && (
                <Text type="secondary">
                  {selectedCount} image{selectedCount > 1 ? 's' : ''} ready to submit
                </Text>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
