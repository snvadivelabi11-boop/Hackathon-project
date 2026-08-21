import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Typography,
  Tag,
  Space,
  Button,
  Input,
  Row,
  Col,
  Empty,
  Modal,
  Drawer,
  Form,
  InputNumber,
  message,
  Image,
  Segmented,
  Radio,
} from 'antd';
import {
  SearchOutlined,
  EyeOutlined,
  DownloadOutlined,
  CheckSquareOutlined,
  AppstoreOutlined,
  TableOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileImageOutlined,
  GithubOutlined,
  FileOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  EditOutlined,
} from '@ant-design/icons';
import {
  subscribeToAllSubmissions,
  getSubmissionViewUrl,
  getSubmissionDownloadUrl,
} from '../../services/submissions.service';
import { subscribeToAllScores, submitEvaluation } from '../../services/scores.service';
import { subscribeToRounds } from '../../services/rounds.service';
import { subscribeToTeams } from '../../services/accounts.service';
import { Submission, Score, Round, Team } from '../../types';
import { formatISTDateTime } from '../../utils/date';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { auth } from '../../firebase/config';
import { safeString, safeRoundNumber, safeNumber } from '../../utils/normalize';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export const SubmissionsPage: React.FC = () => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [viewMode, setViewMode] = useState<'grouped' | 'table'>('grouped');
  const [selectedRoundFilter, setSelectedRoundFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Dynamic Scoring Hook
  const { scoringConfig, getMaxMarks, totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();

  // Grading Drawer State
  const [selectedSub, setSelectedSub] = useState<Submission | null>(null);
  const [gradingTeamId, setGradingTeamId] = useState<string>('');
  const [gradingRoundId, setGradingRoundId] = useState<string>('round1');
  const [isEvalDrawerOpen, setIsEvalDrawerOpen] = useState(false);
  const [savingScore, setSavingScore] = useState(false);
  const [previewImageModalOpen, setPreviewImageModalOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');
  const [evalForm] = Form.useForm();
  const { user } = useAuth();

  useEffect(() => {
    const unsubSubs = subscribeToAllSubmissions(setSubmissions);
    const unsubScores = subscribeToAllScores(setScores);
    const unsubRounds = subscribeToRounds(setRounds);
    const unsubTeams = subscribeToTeams(setTeams);

    return () => {
      unsubSubs();
      unsubScores();
      unsubRounds();
      unsubTeams();
    };
  }, []);

  const getTeamScoreForRound = (teamId: string, roundNum: string | number) => {
    const targetRoundNum = safeRoundNumber(roundNum);
    return scores.find(
      (s) => s && safeString(s.teamId) === safeString(teamId) && safeRoundNumber(s.round || s.roundId) === targetRoundNum
    );
  };

  const getTeamTotalScore = (teamId: string) => {
    const s1 = getTeamScoreForRound(teamId, 1)?.totalMarks ?? null;
    const s2 = getTeamScoreForRound(teamId, 2)?.totalMarks ?? null;
    const s3 = getTeamScoreForRound(teamId, 3)?.totalMarks ?? null;
    if (s1 === null && s2 === null && s3 === null) return null;
    return (s1 || 0) + (s2 || 0) + (s3 || 0);
  };

  const isImageFile = (fileName?: string) => {
    if (!fileName) return false;
    const lower = safeString(fileName).toLowerCase();
    return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.svg');
  };

  const getFileIcon = (fileName?: string) => {
    if (!fileName) return <FileOutlined />;
    const lower = safeString(fileName).toLowerCase();
    if (lower.endsWith('.pdf')) return <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
    if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return <FilePptOutlined style={{ color: '#fa8c16', fontSize: 18 }} />;
    if (isImageFile(lower)) return <FileImageOutlined style={{ color: '#13c2c2', fontSize: 18 }} />;
    return <FileOutlined style={{ fontSize: 18 }} />;
  };

  const handleOpenEvaluation = (teamId: string, roundId: string, sub?: Submission) => {
    const rNum = safeRoundNumber(roundId);
    setGradingTeamId(teamId);
    setGradingRoundId(`round${rNum}`);
    setSelectedSub(sub || null);

    const currentScore = scores.find(
      (s) => safeString(s.teamId) === safeString(teamId) && safeRoundNumber(s.round || s.roundId) === rNum
    );

    evalForm.setFieldsValue({
      adminFinalScore: currentScore?.totalMarks ?? null,
      feedback: currentScore?.feedback || '',
    });
    setIsEvalDrawerOpen(true);
  };

  const handleSaveEvaluation = async (values: any) => {
    if (!gradingTeamId || !gradingRoundId) return;

    setSavingScore(true);
    try {
      await submitEvaluation(
        gradingTeamId,
        gradingRoundId,
        {},
        values.adminFinalScore,
        values.feedback || '',
        auth.currentUser?.email || user?.username || 'admin@hackathon.org'
      );
      message.success(`Score for ${gradingTeamId} (${gradingRoundId.toUpperCase()}) saved successfully!`);
      setIsEvalDrawerOpen(false);
    } catch (err: any) {
      message.error(err.message || 'Failed to save score.');
    } finally {
      setSavingScore(false);
    }
  };

  const query = safeString(search).toLowerCase();

  // Filtered Teams for Grouped View
  const filteredTeams = teams.filter((t) => {
    if (!query) return true;
    const teamId = safeString(t.teamId).toLowerCase();
    const teamName = safeString(t.teamName).toLowerCase();
    const leaderName = safeString(t.leaderName).toLowerCase();
    return teamId.includes(query) || teamName.includes(query) || leaderName.includes(query);
  });

  // Filtered Submissions for Table View
  const filteredSubmissions = submissions.filter((s) => {
    const rNum = safeRoundNumber(s.round || s.roundId);
    const matchesRound =
      selectedRoundFilter === 'all' ||
      (selectedRoundFilter === 'round1' && rNum === 1) ||
      (selectedRoundFilter === 'round2' && rNum === 2) ||
      (selectedRoundFilter === 'round3' && rNum === 3);

    if (!query) return matchesRound;

    const teamId = safeString(s.teamId).toLowerCase();
    const teamName = safeString(s.teamName).toLowerCase();
    const fileName = safeString(s.fileName).toLowerCase();

    return matchesRound && (teamId.includes(query) || teamName.includes(query) || fileName.includes(query));
  });

  const tableColumns = [
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      width: 110,
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700 }}>{safeString(id) || '—'}</Tag>,
    },
    {
      title: 'Team Name',
      dataIndex: 'teamName',
      key: 'teamName',
      width: 160,
      render: (name: string) => <Text strong>{safeString(name) || '—'}</Text>,
    },
    {
      title: 'Round',
      dataIndex: 'roundId',
      key: 'roundId',
      width: 150,
      render: (r: any, record: Submission) => {
        const rNum = safeRoundNumber(record.round || r);
        const marks = getMaxMarks(rNum);
        return (
          <Tag color={rNum === 1 ? 'cyan' : rNum === 2 ? 'geekblue' : 'purple'} style={{ fontWeight: 600 }}>
            {`Round ${rNum} (${marks}m)`}
          </Tag>
        );
      },
    },
    {
      title: 'Submission Artifacts',
      key: 'artifacts',
      render: (_: any, record: Submission) => {
        const viewUrl = getSubmissionViewUrl(record);
        const downloadUrl = getSubmissionDownloadUrl(record);
        return (
          <Space direction="vertical" size={4}>
            {viewUrl && (
              <Space wrap>
                {getFileIcon(record.fileName)}
                {isImageFile(record.fileName) ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, fontWeight: 600 }}
                    onClick={() => {
                      setPreviewImageUrl(viewUrl);
                      setPreviewImageModalOpen(true);
                    }}
                  >
                    {safeString(record.fileName) || 'File'} (Preview)
                  </Button>
                ) : (
                  <a
                    href={viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontWeight: 600, color: '#1677ff' }}
                  >
                    {safeString(record.fileName) || 'View File'}
                  </a>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<DownloadOutlined />}
                  href={downloadUrl}
                  target="_blank"
                  download={record.fileName || true}
                />
              </Space>
            )}

          {record.githubUrl && (
            <Space>
              <GithubOutlined style={{ fontSize: 16 }} />
              <a
                href={record.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: 600, color: '#24292e' }}
              >
                {record.githubUrl}
              </a>
            </Space>
          )}

            {record.prototypeUrl && (
              <Space>
                <LinkOutlined style={{ color: '#52c41a' }} />
                <a
                  href={record.prototypeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#52c41a' }}
                >
                  {record.prototypeUrl}
                </a>
              </Space>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Submitted At (IST)',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 170,
      render: (time: any) => <Text style={{ fontSize: '13px' }}>{formatISTDateTime(time)}</Text>,
    },
    {
      title: 'Score',
      key: 'score',
      width: 130,
      render: (_: any, record: Submission) => {
        const rNum = safeRoundNumber(record.round || record.roundId);
        const sc = getTeamScoreForRound(record.teamId, rNum);
        const maxMarks = getMaxMarks(rNum);

        return sc ? (
          <Tag color="green" style={{ fontSize: '13px', fontWeight: 700 }}>
            {sc.totalMarks} / {maxMarks}
          </Tag>
        ) : (
          <Tag color="default">Pending</Tag>
        );
      },
    },
    {
      title: 'Action',
      key: 'action',
      width: 140,
      render: (_: any, record: Submission) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<CheckSquareOutlined />}
            onClick={() => handleOpenEvaluation(record.teamId, record.roundId, record)}
            style={{ borderRadius: 6, background: '#1677ff' }}
          >
            Grade
          </Button>
        </Space>
      ),
    },
  ];

  const gradingRoundNum = safeRoundNumber(gradingRoundId);
  const maxGradingMarks = getMaxMarks(gradingRoundNum);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
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
            Round Submissions & Evaluation Console
          </Title>
          <Text type="secondary">
            Inspect live submissions in Cloudinary file storage, view artifacts, and enter manual scores (/{totalMaxMarks} Marks)
          </Text>
        </div>

        <Space wrap>
          <Segmented
            value={viewMode}
            onChange={(val) => setViewMode(val as 'grouped' | 'table')}
            options={[
              { label: 'Team Grouped View', value: 'grouped', icon: <AppstoreOutlined /> },
              { label: 'Detailed Stream Table', value: 'table', icon: <TableOutlined /> },
            ]}
          />
        </Space>
      </div>

      {/* Filter and Search Bar */}
      <Card
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={viewMode === 'table' ? 10 : 24}>
            <Input
              placeholder="Search by Team ID, Team Name, or Leader Name..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              size="large"
            />
          </Col>

          {viewMode === 'table' && (
            <Col xs={24} md={14} style={{ textAlign: 'right' }}>
              <Radio.Group
                value={selectedRoundFilter}
                onChange={(e) => setSelectedRoundFilter(e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value="all">All Rounds</Radio.Button>
                <Radio.Button value="round1">Round 1 ({round1MaxMarks}m)</Radio.Button>
                <Radio.Button value="round2">Round 2 ({round2MaxMarks}m)</Radio.Button>
                <Radio.Button value="round3">Round 3 ({round3MaxMarks}m)</Radio.Button>
              </Radio.Group>
            </Col>
          )}
        </Row>
      </Card>

      {/* VIEW 1: Team Grouped Cards View */}
      {viewMode === 'grouped' ? (
        filteredTeams.length === 0 ? (
          <Card bordered={false} style={{ borderRadius: 12, textAlign: 'center', padding: '40px 0' }}>
            <Empty description="No teams registered yet. Use Add Team modal to create team accounts." />
          </Card>
        ) : (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            {filteredTeams.map((team) => {
              const r1Sub = submissions.find(
                (s) => safeString(s.teamId) === safeString(team.teamId) && safeRoundNumber(s.round || s.roundId) === 1
              );
              const r2Sub = submissions.find(
                (s) => safeString(s.teamId) === safeString(team.teamId) && safeRoundNumber(s.round || s.roundId) === 2
              );
              const r3Sub = submissions.find(
                (s) => safeString(s.teamId) === safeString(team.teamId) && safeRoundNumber(s.round || s.roundId) === 3
              );

              const r1Score = getTeamScoreForRound(team.teamId, 1)?.totalMarks ?? null;
              const r2Score = getTeamScoreForRound(team.teamId, 2)?.totalMarks ?? null;
              const r3Score = getTeamScoreForRound(team.teamId, 3)?.totalMarks ?? null;
              const totalScore = getTeamTotalScore(team.teamId);

              return (
                <Card
                  key={team.teamId}
                  bordered={false}
                  style={{
                    borderRadius: 14,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    border: '1px solid #e2e8f0',
                  }}
                  title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <Space size={12}>
                        <Tag color="blue" style={{ fontSize: '14px', fontWeight: 800, padding: '4px 10px' }}>
                          {team.teamId}
                        </Tag>
                        <Title level={4} style={{ margin: 0 }}>
                          {team.teamName}
                        </Title>
                        <Text type="secondary" style={{ fontSize: '13px' }}>
                          Leader: <Text strong>{team.leaderName || '—'}</Text>
                        </Text>
                      </Space>

                      <Space>
                        <Tag color="purple" style={{ fontSize: '13px', fontWeight: 700, padding: '4px 10px' }}>
                          Total Score: {totalScore !== null ? `${totalScore} / ${totalMaxMarks} Marks` : 'Pending Grading'}
                        </Tag>
                      </Space>
                    </div>
                  }
                >
                  <Row gutter={[20, 20]}>
                    {/* ROUND 1 CARD */}
                    <Col xs={24} md={8}>
                      <Card
                        type="inner"
                        title={
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Space>
                              <Tag color="cyan" style={{ fontWeight: 700 }}>ROUND 1</Tag>
                              <Text strong>Architecture ({round1MaxMarks}m)</Text>
                            </Space>
                            {r1Sub ? <Tag color="green">✓ Submitted</Tag> : <Tag color="default">Pending</Tag>}
                          </div>
                        }
                        style={{ background: '#f8fafc', height: '100%', borderRadius: 10 }}
                      >
                        {r1Sub ? (
                          <div>
                            <div style={{ marginBottom: 12 }}>
                              <Space>
                                {getFileIcon(r1Sub.fileName)}
                                <Text strong ellipsis style={{ maxWidth: 180 }}>
                                  {r1Sub.fileName || 'Architecture File'}
                                </Text>
                              </Space>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
                                Uploaded: {formatISTDateTime(r1Sub.submittedAt)}
                              </div>
                            </div>

                            {/* Image Thumbnail Preview if supported */}
                            {isImageFile(r1Sub.fileName) && r1Sub.fileUrl && (
                              <div
                                style={{
                                  marginBottom: 12,
                                  borderRadius: 8,
                                  overflow: 'hidden',
                                  maxHeight: 120,
                                  background: '#000',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                }}
                                onClick={() => {
                                  setPreviewImageUrl(getSubmissionViewUrl(r1Sub));
                                  setPreviewImageModalOpen(true);
                                }}
                              >
                                <img
                                  src={getSubmissionViewUrl(r1Sub)}
                                  alt="Architecture"
                                  style={{ width: '100%', height: '120px', objectFit: 'cover' }}
                                />
                              </div>
                            )}

                            <Space wrap style={{ marginBottom: 16 }}>
                              <Button
                                size="small"
                                type="primary"
                                icon={<EyeOutlined />}
                                href={getSubmissionViewUrl(r1Sub)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ background: '#1677ff' }}
                              >
                                VIEW FILE
                              </Button>
                              <Button
                                size="small"
                                icon={<DownloadOutlined />}
                                href={getSubmissionDownloadUrl(r1Sub)}
                                target="_blank"
                                download={r1Sub.fileName || true}
                              >
                                DOWNLOAD
                              </Button>
                            </Space>

                            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <Text type="secondary" style={{ fontSize: '12px' }}>R1 Score: </Text>
                                <Text strong style={{ color: r1Score !== null ? '#08979c' : '#94a3b8' }}>
                                  {r1Score !== null ? `${r1Score} / ${round1MaxMarks} Marks` : 'Pending'}
                                </Text>
                              </div>
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => handleOpenEvaluation(team.teamId, 'round1', r1Sub)}
                              >
                                {r1Score !== null ? 'EDIT' : 'GRADE'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                            <ClockCircleOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
                            <Text type="secondary">No submission received for Round 1.</Text>
                          </div>
                        )}
                      </Card>
                    </Col>

                    {/* ROUND 2 CARD */}
                    <Col xs={24} md={8}>
                      <Card
                        type="inner"
                        title={
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Space>
                              <Tag color="geekblue" style={{ fontWeight: 700 }}>ROUND 2</Tag>
                              <Text strong>Presentation ({round2MaxMarks}m)</Text>
                            </Space>
                            {r2Sub ? <Tag color="green">✓ Submitted</Tag> : <Tag color="default">Pending</Tag>}
                          </div>
                        }
                        style={{ background: '#f8fafc', height: '100%', borderRadius: 10 }}
                      >
                        {r2Sub ? (
                          <div>
                            <div style={{ marginBottom: 12 }}>
                              <Space>
                                {getFileIcon(r2Sub.fileName)}
                                <Text strong ellipsis style={{ maxWidth: 180 }}>
                                  {r2Sub.fileName || 'Presentation Slide Deck'}
                                </Text>
                              </Space>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
                                Uploaded: {formatISTDateTime(r2Sub.submittedAt)}
                              </div>
                            </div>

                            <Space wrap style={{ marginBottom: 16 }}>
                              <Button
                                size="small"
                                type="primary"
                                icon={<EyeOutlined />}
                                href={getSubmissionViewUrl(r2Sub)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ background: '#1d39c4' }}
                              >
                                OPEN SLIDES
                              </Button>
                              <Button
                                size="small"
                                icon={<DownloadOutlined />}
                                href={getSubmissionDownloadUrl(r2Sub)}
                                target="_blank"
                                download={r2Sub.fileName || true}
                              >
                                DOWNLOAD
                              </Button>
                            </Space>

                            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <Text type="secondary" style={{ fontSize: '12px' }}>R2 Score: </Text>
                                <Text strong style={{ color: r2Score !== null ? '#1d39c4' : '#94a3b8' }}>
                                  {r2Score !== null ? `${r2Score} / ${round2MaxMarks} Marks` : 'Pending'}
                                </Text>
                              </div>
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => handleOpenEvaluation(team.teamId, 'round2', r2Sub)}
                              >
                                {r2Score !== null ? 'EDIT' : 'GRADE'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                            <ClockCircleOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
                            <Text type="secondary">No submission received for Round 2.</Text>
                          </div>
                        )}
                      </Card>
                    </Col>

                    {/* ROUND 3 CARD */}
                    <Col xs={24} md={8}>
                      <Card
                        type="inner"
                        title={
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Space>
                              <Tag color="purple" style={{ fontWeight: 700 }}>ROUND 3</Tag>
                              <Text strong>Prototype ({round3MaxMarks}m)</Text>
                            </Space>
                            {r3Sub ? <Tag color="green">✓ Submitted</Tag> : <Tag color="default">Pending</Tag>}
                          </div>
                        }
                        style={{ background: '#f8fafc', height: '100%', borderRadius: 10 }}
                      >
                        {r3Sub ? (
                          <div>
                            <div style={{ marginBottom: 12 }}>
                              {r3Sub.githubUrl && (
                                <div style={{ marginBottom: 6 }}>
                                  <Space>
                                    <GithubOutlined style={{ fontSize: 16 }} />
                                    <a href={r3Sub.githubUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                                      {r3Sub.githubUrl}
                                    </a>
                                  </Space>
                                </div>
                              )}
                              {r3Sub.prototypeUrl && (
                                <div>
                                  <Space>
                                    <LinkOutlined style={{ color: '#52c41a' }} />
                                    <a href={r3Sub.prototypeUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#52c41a' }}>
                                      {r3Sub.prototypeUrl}
                                    </a>
                                  </Space>
                                </div>
                              )}
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
                                Submitted: {formatISTDateTime(r3Sub.submittedAt)}
                              </div>
                            </div>

                            <Space wrap style={{ marginBottom: 16 }}>
                              {r3Sub.githubUrl && (
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<GithubOutlined />}
                                  href={r3Sub.githubUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ background: '#24292e', borderColor: '#24292e' }}
                                >
                                  VIEW REPO
                                </Button>
                              )}
                              {r3Sub.prototypeUrl && (
                                <Button
                                  size="small"
                                  icon={<LinkOutlined />}
                                  href={r3Sub.prototypeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  LIVE DEMO
                                </Button>
                              )}
                            </Space>

                            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <Text type="secondary" style={{ fontSize: '12px' }}>R3 Score: </Text>
                                <Text strong style={{ color: r3Score !== null ? '#531dab' : '#94a3b8' }}>
                                  {r3Score !== null ? `${r3Score} / ${round3MaxMarks} Marks` : 'Pending'}
                                </Text>
                              </div>
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => handleOpenEvaluation(team.teamId, 'round3', r3Sub)}
                              >
                                {r3Score !== null ? 'EDIT' : 'GRADE'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                            <ClockCircleOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
                            <Text type="secondary">No submission received for Round 3.</Text>
                          </div>
                        )}
                      </Card>
                    </Col>
                  </Row>
                </Card>
              );
            })}
          </Space>
        )
      ) : (
        /* VIEW 2: Detailed Stream Table */
        <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {filteredSubmissions.length === 0 ? (
            <Empty description="No submissions found matching criteria." style={{ padding: '36px 0' }} />
          ) : (
            <Table
              dataSource={filteredSubmissions}
              columns={tableColumns}
              rowKey="id"
              pagination={{ pageSize: 15 }}
            />
          )}
        </Card>
      )}

      {/* Manual Grading Drawer */}
      <Drawer
        title={
          <Space>
            <CheckSquareOutlined style={{ color: '#1677ff' }} />
            <span>
              Manual Evaluation — Team {gradingTeamId} ({gradingRoundId.toUpperCase()})
            </span>
          </Space>
        }
        placement="right"
        width={500}
        onClose={() => setIsEvalDrawerOpen(false)}
        open={isEvalDrawerOpen}
        extra={
          <Button
            type="primary"
            onClick={() => evalForm.submit()}
            loading={savingScore}
            icon={<CheckSquareOutlined />}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}
          >
            SAVE SCORE
          </Button>
        }
      >
        <Form form={evalForm} layout="vertical" onFinish={handleSaveEvaluation}>
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, marginBottom: 20 }}>
            <Text type="secondary">Round Maximum Marks: </Text>
            <Text strong>{maxGradingMarks} Marks</Text>
            {selectedSub?.fileName && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">Submitted File: </Text>
                <a href={getSubmissionViewUrl(selectedSub)} target="_blank" rel="noopener noreferrer">
                  {selectedSub.fileName}
                </a>
              </div>
            )}
            {selectedSub?.githubUrl && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">GitHub Repository: </Text>
                <a href={selectedSub.githubUrl} target="_blank" rel="noopener noreferrer">
                  {selectedSub.githubUrl}
                </a>
              </div>
            )}
          </div>

          <Form.Item
            name="adminFinalScore"
            label={`Score (0 to ${maxGradingMarks} Marks)`}
            rules={[
              { required: true, message: 'Please enter a valid numeric score.' },
              {
                type: 'number',
                min: 0,
                max: maxGradingMarks,
                message: `Score must be between 0 and ${maxGradingMarks}`,
              },
            ]}
          >
            <InputNumber
              min={0}
              max={maxGradingMarks}
              step={0.5}
              style={{ width: '100%' }}
              size="large"
              placeholder="Enter marks..."
            />
          </Form.Item>

          <Form.Item name="feedback" label="Evaluator Feedback / Remarks">
            <TextArea rows={4} placeholder="Provide technical feedback for the team..." />
          </Form.Item>
        </Form>
      </Drawer>

      {/* Image Preview Modal */}
      <Modal
        open={previewImageModalOpen}
        footer={null}
        onCancel={() => setPreviewImageModalOpen(false)}
        width={800}
      >
        <Image src={previewImageUrl} alt="Preview" style={{ width: '100%' }} />
      </Modal>
    </div>
  );
};
