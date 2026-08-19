import React, { useState, useEffect, useMemo } from 'react';
import {
  Row,
  Col,
  Card,
  Typography,
  Select,
  Form,
  InputNumber,
  Input,
  Button,
  Tag,
  Space,
  Divider,
  message,
  Table,
  Statistic,
  Alert,
  Modal,
  Drawer,
  Radio,
  Progress,
  Tooltip,
  List,
  Collapse,
  Badge,
} from 'antd';
import {
  CheckSquareOutlined,
  SaveOutlined,
  FileDoneOutlined,
  RobotOutlined,
  ReloadOutlined,
  EyeOutlined,
  LinkOutlined,
  GithubOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  BulbOutlined,
  WarningOutlined,
  EditOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  AuditOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { subscribeToRounds } from '../../services/rounds.service';
import { subscribeToTeams } from '../../services/accounts.service';
import { subscribeToAllSubmissions } from '../../services/submissions.service';
import { subscribeToAllScores } from '../../services/scores.service';
import {
  triggerAIEvaluation,
  saveAdminFinalScore,
  subscribeToAIEvaluation,
  subscribeToEvaluationHistory,
} from '../../services/ai.service';
import {
  Round,
  Team,
  Submission,
  Score,
  AIEvaluation,
  EvaluationHistoryItem,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { safeRoundNumber } from '../../utils/normalize';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export const EvaluationsPage: React.FC = () => {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Score[]>([]);

  const [selectedRoundId, setSelectedRoundId] = useState<string>('round1');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  // AI Evaluation & Modal States
  const [aiEvaluation, setAiEvaluation] = useState<AIEvaluation | null>(null);
  const [evalHistory, setEvalHistory] = useState<EvaluationHistoryItem[]>([]);
  const [runningAI, setRunningAI] = useState(false);
  const [runningTeamId, setRunningTeamId] = useState<string | null>(null);
  const [savingFinalScore, setSavingFinalScore] = useState(false);
  const [aiProgressStage, setAiProgressStage] = useState<string>('');
  const [aiProgressPercent, setAiProgressPercent] = useState<number>(0);

  // Modals & Drawers
  const [isFullAnalysisDrawerOpen, setIsFullAnalysisDrawerOpen] = useState(false);
  const [isEditScoreModalOpen, setIsEditScoreModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const [form] = Form.useForm();
  const [modalForm] = Form.useForm();
  const { user } = useAuth();
  const { getMaxMarks, totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();

  useEffect(() => {
    const unsubRounds = subscribeToRounds(setRounds);
    const unsubTeams = subscribeToTeams((loadedTeams) => {
      setTeams(loadedTeams);
      if (loadedTeams.length > 0) {
        setSelectedTeamId((prev) => (prev && loadedTeams.some((t) => t.teamId === prev) ? prev : loadedTeams[0].teamId));
      } else {
        setSelectedTeamId('');
      }
    });
    const unsubSubs = subscribeToAllSubmissions(setSubmissions);
    const unsubScores = subscribeToAllScores(setScores);

    return () => {
      unsubRounds();
      unsubTeams();
      unsubSubs();
      unsubScores();
    };
  }, []);

  const selectedRoundNum = safeRoundNumber(selectedRoundId);
  const maxMarks = getMaxMarks(selectedRoundNum);

  const currentSubmission = submissions.find(
    (s) => s && s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
  );
  const currentScore = scores.find(
    (s) => s && s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
  );
  const activeTeam = teams.find((t) => t && t.teamId === selectedTeamId);

  // Sync AI evaluation when selected team or submission changes
  useEffect(() => {
    const targetId = currentSubmission?.id || `${selectedTeamId}_${selectedRoundId}`;
    if (!targetId) {
      setAiEvaluation(null);
      setEvalHistory([]);
      return;
    }
    const unsubAI = subscribeToAIEvaluation(targetId, setAiEvaluation);
    const unsubHist = subscribeToEvaluationHistory(targetId, setEvalHistory);

    return () => {
      unsubAI();
      unsubHist();
    };
  }, [currentSubmission?.id, selectedTeamId, selectedRoundId]);

  // Sync inline form
  useEffect(() => {
    const defaultScore = currentScore?.totalMarks ?? aiEvaluation?.suggestedScore ?? Math.round(maxMarks * 0.8);
    form.setFieldsValue({
      adminFinalScore: defaultScore,
      feedback: currentScore?.feedback || aiEvaluation?.summary || '',
    });
  }, [selectedRoundId, selectedTeamId, currentScore, aiEvaluation, maxMarks, form]);

  // Run AI Evaluation with multi-step progress & confirmation
  const handleConfirmRunAI = (team: Team, sub?: Submission) => {
    if (!sub) {
      Modal.warning({
        title: 'Project Submission Not Available',
        content: `Team ${team.teamId} has not submitted any deliverable for Round ${selectedRoundNum}. The AI evaluator cannot analyze non-existent submissions.`,
      });
      return;
    }

    Modal.confirm({
      title: `Run OpenRouter Evidence-Based Analysis for ${team.teamId}?`,
      icon: <FileSearchOutlined style={{ color: '#722ed1' }} />,
      content: (
        <div>
          <Paragraph>
            OpenRouter AI will analyze the <Text strong>assigned problem statement</Text> and <Text strong>actual uploaded deliverable</Text> for Round {selectedRoundNum} (Max {maxMarks} Marks).
          </Paragraph>
          <Alert
            message="Evidence-Based Scoring Only"
            description="The AI extracts real evidence, maps requirement coverage, checks cross-round consistency, and produces recommended marks. The final score remains under your authority."
            type="info"
            showIcon
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: 'Start Evidence Analysis',
      okType: 'primary',
      cancelText: 'Cancel',
      onOk: () => executeAIEvaluation(team.teamId, sub.id),
    });
  };

  const executeAIEvaluation = async (teamId: string, submissionId: string) => {
    setRunningAI(true);
    setRunningTeamId(teamId);
    setAiProgressStage('Reading assigned problem specifications...');
    setAiProgressPercent(20);

    try {
      await new Promise((r) => setTimeout(r, 400));
      setAiProgressStage('Inspecting actual submission files / GitHub repository...');
      setAiProgressPercent(45);

      await new Promise((r) => setTimeout(r, 500));
      setAiProgressStage('OpenRouter AI mapping requirement coverage & collecting evidence...');
      setAiProgressPercent(75);

      const res = await triggerAIEvaluation(submissionId, teamId, selectedRoundId);

      setAiProgressStage('Validating evidence citations & score bounds...');
      setAiProgressPercent(100);

      setAiEvaluation(res);
      form.setFieldsValue({
        adminFinalScore: res.suggestedScore || res.score,
        feedback: res.summary || '',
      });

      message.success(
        `Evidence analysis completed! AI Recommendation: ${res.suggestedScore || res.score} / ${res.maxScore || maxMarks} Marks`
      );
    } catch (err: any) {
      console.error('AI Evaluation error:', err);
      message.error(err.message || 'AI Evaluation encountered an error. Please retry.');
    } finally {
      setRunningAI(false);
      setRunningTeamId(null);
    }
  };

  // Save Admin Authoritative Final Score
  const handleSaveFinalScore = async (values: any) => {
    if (!currentSubmission) {
      message.warning('Cannot save official score without an actual team submission.');
      return;
    }

    const finalScore = Number(values.adminFinalScore);
    if (isNaN(finalScore) || finalScore < 0 || finalScore > maxMarks) {
      message.error(`Final score must be between 0 and ${maxMarks} marks.`);
      return;
    }

    setSavingFinalScore(true);
    try {
      await saveAdminFinalScore(
        currentSubmission.id,
        selectedTeamId,
        selectedRoundId,
        finalScore,
        values.feedback || '',
        { uid: user?.uid, email: user?.email },
        maxMarks
      );

      message.success(`Official Final Score saved: ${finalScore} / ${maxMarks} Marks (Finalized)!`);
    } catch (err: any) {
      message.error(err.message || 'Failed to save final score.');
    } finally {
      setSavingFinalScore(false);
    }
  };

  // Open Modal Score Editor
  const handleOpenScoreModal = (team: Team, sub?: Submission, scoreDoc?: Score, aiDoc?: AIEvaluation | null) => {
    setEditingTeam(team);
    const initialScore = scoreDoc?.totalMarks ?? aiDoc?.suggestedScore ?? Math.round(maxMarks * 0.8);
    modalForm.setFieldsValue({
      adminFinalScore: initialScore,
      feedback: scoreDoc?.feedback || aiDoc?.summary || '',
    });
    setIsEditScoreModalOpen(true);
  };

  const handleSaveModalScore = async (values: any) => {
    if (!editingTeam) return;
    const sub = submissions.find(
      (s) => s.teamId === editingTeam.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
    );
    if (!sub) {
      message.warning('No submission found for this team.');
      return;
    }

    const finalScore = Number(values.adminFinalScore);
    if (isNaN(finalScore) || finalScore < 0 || finalScore > maxMarks) {
      message.error(`Final score must be between 0 and ${maxMarks} marks.`);
      return;
    }

    setSavingFinalScore(true);
    try {
      await saveAdminFinalScore(
        sub.id,
        editingTeam.teamId,
        selectedRoundId,
        finalScore,
        values.feedback || '',
        { uid: user?.uid, email: user?.email },
        maxMarks
      );

      message.success(`Score finalized for ${editingTeam.teamId}: ${finalScore} / ${maxMarks} Marks!`);
      setIsEditScoreModalOpen(false);
    } catch (err: any) {
      message.error(err.message || 'Failed to save score.');
    } finally {
      setSavingFinalScore(false);
    }
  };

  // Build Table Columns for Team Grid
  const columns = [
    {
      title: 'Team & Assigned Problem',
      key: 'team',
      render: (_: any, record: Team) => (
        <div>
          <Space>
            <Tag color="blue" style={{ fontWeight: 800 }}>{record.teamId}</Tag>
            <Text strong style={{ fontSize: '14px', color: '#1e293b' }}>{record.teamName}</Text>
          </Space>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: 2 }}>
            Leader: {record.leaderName}
            {record.assignedStatementTitle && (
              <span> • Challenge: <Text strong style={{ color: '#1d39c4' }}>{record.assignedStatementTitle}</Text></span>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Submission Status',
      key: 'submission',
      render: (_: any, record: Team) => {
        const sub = submissions.find(
          (s) => s.teamId === record.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
        );
        if (!sub) {
          return <Tag color="default">Not Submitted</Tag>;
        }
        return (
          <Space direction="vertical" size={2}>
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontWeight: 600 }}>
              Submitted
            </Tag>
            <Space size="small">
              {sub.fileUrl && (
                <a href={sub.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
                  <LinkOutlined /> View File
                </a>
              )}
              {sub.githubRepoUrl && (
                <a href={sub.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#24292e' }}>
                  <GithubOutlined /> GitHub
                </a>
              )}
            </Space>
          </Space>
        );
      },
    },
    {
      title: 'AI Evidence Evaluation',
      key: 'aiStatus',
      render: (_: any, record: Team) => {
        const sub = submissions.find(
          (s) => s.teamId === record.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
        );
        const sc = scores.find(
          (s) => s.teamId === record.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
        );

        if (!sub) return <Text type="secondary">—</Text>;

        if (runningTeamId === record.teamId) {
          return (
            <Space>
              <RobotOutlined spin style={{ color: '#722ed1' }} />
              <Text style={{ fontSize: '12px', color: '#722ed1', fontWeight: 600 }}>Analyzing...</Text>
            </Space>
          );
        }

        if (sc?.aiSuggestedScore !== undefined && sc?.aiSuggestedScore !== null) {
          return (
            <div>
              <Tag color="purple" icon={<RobotOutlined />} style={{ fontWeight: 700 }}>
                {sc.aiSuggestedScore} / {maxMarks} Marks
              </Tag>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 2 }}>AI Recommendation</div>
            </div>
          );
        }

        return <Tag color="orange">Not Run</Tag>;
      },
    },
    {
      title: 'Admin Final Score',
      key: 'finalScore',
      render: (_: any, record: Team) => {
        const sc = scores.find(
          (s) => s.teamId === record.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
        );

        if (sc && sc.evaluationStatus === 'FINALIZED' && sc.totalMarks !== null && sc.totalMarks !== undefined) {
          return (
            <div>
              <Tag color="green" icon={<CheckSquareOutlined />} style={{ fontWeight: 800, fontSize: '13px' }}>
                {sc.totalMarks} / {maxMarks} Marks
              </Tag>
              <div style={{ fontSize: '11px', color: '#059669', fontWeight: 600, marginTop: 2 }}>
                FINALIZED ({sc.percentage || Math.round((sc.totalMarks / maxMarks) * 100)}%)
              </div>
            </div>
          );
        }

        return <Tag color="default">Pending Finalization</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Team) => {
        const sub = submissions.find(
          (s) => s.teamId === record.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
        );
        const sc = scores.find(
          (s) => s.teamId === record.teamId && safeRoundNumber(s.round || s.roundId) === selectedRoundNum
        );

        if (!sub) {
          return <Text type="secondary" style={{ fontSize: '12px' }}>Awaiting submission</Text>;
        }

        const isEvaluatingThis = runningTeamId === record.teamId;

        return (
          <Space wrap size="small">
            <Button
              size="small"
              icon={<RobotOutlined />}
              loading={isEvaluatingThis}
              onClick={() => handleConfirmRunAI(record, sub)}
              style={{ borderRadius: 6, borderColor: '#722ed1', color: '#722ed1', fontWeight: 600 }}
            >
              {sc?.aiSuggestedScore ? 'Re-run AI' : 'Run AI'}
            </Button>

            <Button
              size="small"
              type="primary"
              icon={<EditOutlined />}
              onClick={() => {
                setSelectedTeamId(record.teamId);
                handleOpenScoreModal(record, sub, sc);
              }}
              style={{ borderRadius: 6, background: '#1677ff' }}
            >
              Finalize Score
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
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
            Evidence-Based AI Evaluation & Score Hub
          </Title>
          <Text type="secondary">
            Strict evidence inspection • Requirement coverage mapping • OpenRouter AI recommendation • Admin final authority
          </Text>
        </div>

        <Radio.Group
          value={selectedRoundId}
          onChange={(e) => setSelectedRoundId(e.target.value)}
          buttonStyle="solid"
          size="large"
        >
          <Radio.Button value="round1">Round 1 (Max {round1MaxMarks}m)</Radio.Button>
          <Radio.Button value="round2">Round 2 (Max {round2MaxMarks}m)</Radio.Button>
          <Radio.Button value="round3">Round 3 (Max {round3MaxMarks}m)</Radio.Button>
        </Radio.Group>
      </div>

      {/* Overview Metric Row */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Active Evaluation Round</span>}
              value={`Round ${selectedRoundNum}`}
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>• Max {maxMarks} Marks</span>}
              prefix={<ThunderboltOutlined style={{ color: '#1677ff', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 8, fontSize: '12px', color: '#64748b' }}>
              Total Hackathon Scale: {totalMaxMarks} Marks
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Submissions Received</span>}
              value={submissions.filter((s) => safeRoundNumber(s.round || s.roundId) === selectedRoundNum).length}
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>/ {teams.length} Teams</span>}
              prefix={<FileDoneOutlined style={{ color: '#52c41a', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 8, fontSize: '12px', color: '#64748b' }}>
              {teams.length - submissions.filter((s) => safeRoundNumber(s.round || s.roundId) === selectedRoundNum).length} Submissions Pending
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Official Scores Finalized</span>}
              value={
                scores.filter(
                  (s) => safeRoundNumber(s.round || s.roundId) === selectedRoundNum && s.evaluationStatus === 'FINALIZED'
                ).length
              }
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>/ {teams.length} Teams</span>}
              prefix={<CheckSquareOutlined style={{ color: '#059669', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 8, fontSize: '12px', color: '#64748b' }}>
              Admin Final Score is official for Leaderboard & Results
            </div>
          </Card>
        </Col>
      </Row>

      {/* Two Column Layout: Team Table & Detailed Evidence Panel */}
      <Row gutter={[24, 24]}>
        {/* Left Column: All Teams Table */}
        <Col xs={24} lg={13}>
          <Card
            title={
              <Space>
                <FileDoneOutlined style={{ color: '#1677ff' }} />
                <span style={{ fontWeight: 700 }}>Team Submissions — Round {selectedRoundNum}</span>
              </Space>
            }
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <Table
              dataSource={teams}
              columns={columns}
              rowKey="teamId"
              pagination={{ pageSize: 7 }}
              size="middle"
              onRow={(record) => ({
                onClick: () => setSelectedTeamId(record.teamId),
                style: {
                  cursor: 'pointer',
                  background: record.teamId === selectedTeamId ? '#eff6ff' : 'transparent',
                },
              })}
            />
          </Card>
        </Col>

        {/* Right Column: Detailed Evidence Inspection & Admin Score Finalization */}
        <Col xs={24} lg={11}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <FileSearchOutlined style={{ color: '#722ed1', fontSize: '18px' }} />
                  <span style={{ fontWeight: 700 }}>{selectedTeamId || 'Select a Team'} — Analysis</span>
                </Space>
                <Tag color="blue" style={{ fontWeight: 700 }}>Max {maxMarks} Marks</Tag>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            {selectedTeamId ? (
              <div>
                {/* 1. Problem Statement Context */}
                <div style={{ background: '#f0f5ff', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #d6e4ff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text strong style={{ color: '#1d39c4', fontSize: '13px' }}>
                      Assigned Challenge Specifications
                    </Text>
                    <Tag color="blue">{activeTeam?.assignedStatementId || 'Assigned'}</Tag>
                  </div>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px', marginBottom: 4 }}>
                    {activeTeam?.assignedStatementTitle || 'General Challenge'}
                  </div>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    AI verifies submission evidence strictly against this challenge specification.
                  </Text>
                </div>

                {/* 2. Submission Snapshot & File Link */}
                <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text strong style={{ fontSize: '13px' }}>Actual Submission Deliverable</Text>
                    {currentSubmission ? (
                      <Tag color="green" icon={<CheckCircleOutlined />}>Delivered</Tag>
                    ) : (
                      <Tag color="default">Not Submitted</Tag>
                    )}
                  </div>
                  {currentSubmission ? (
                    <div style={{ fontSize: '12px', color: '#475569' }}>
                      <div>Deliverable: <Text strong>{currentSubmission.fileName || currentSubmission.fileType || 'Submission File'}</Text></div>
                      <div style={{ marginTop: 4, display: 'flex', gap: 12 }}>
                        {currentSubmission.fileUrl && (
                          <a href={currentSubmission.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                            <LinkOutlined /> Inspect Submitted File
                          </a>
                        )}
                        {currentSubmission.githubRepoUrl && (
                          <a href={currentSubmission.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: '#24292e' }}>
                            <GithubOutlined /> GitHub Repository
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Alert
                      message="No Submission Provided"
                      description="Team has not uploaded Round deliverables yet. AI evaluation cannot be executed."
                      type="warning"
                      showIcon
                      style={{ marginTop: 6 }}
                    />
                  )}
                </div>

                {/* 3. AI Progress or Results */}
                {runningAI && runningTeamId === selectedTeamId ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <RobotOutlined spin style={{ fontSize: 36, color: '#722ed1', marginBottom: 12 }} />
                    <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>{aiProgressStage}</div>
                    <Progress percent={aiProgressPercent} status="active" strokeColor="#722ed1" />
                  </div>
                ) : aiEvaluation && aiEvaluation.status !== 'NO_SUBMISSION' ? (
                  <div>
                    {/* AI Score Banner */}
                    <div style={{ background: '#faf5ff', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #d3adf7' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Space>
                          <RobotOutlined style={{ color: '#722ed1' }} />
                          <Text strong style={{ color: '#581c87' }}>AI Evidence-Based Recommendation</Text>
                        </Space>
                        <Tag color="purple" style={{ fontSize: '14px', fontWeight: 800 }}>
                          {aiEvaluation.suggestedScore ?? aiEvaluation.score} / {maxMarks} Marks
                        </Tag>
                      </div>
                      <Paragraph style={{ fontSize: '12px', color: '#475569', marginBottom: 8 }}>
                        {aiEvaluation.summary}
                      </Paragraph>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#7e22ce' }}>
                        <span>Confidence: {Math.round((aiEvaluation.confidence || 0.88) * 100)}% • OpenRouter Gateway</span>
                        <Button
                          type="link"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => setIsFullAnalysisDrawerOpen(true)}
                          style={{ padding: 0, fontSize: '11px', color: '#722ed1', fontWeight: 600 }}
                        >
                          View Full Evidence Breakdown
                        </Button>
                      </div>
                    </div>

                    {/* Requirement Coverage Matrix Preview */}
                    {aiEvaluation.requirementCoverage && aiEvaluation.requirementCoverage.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <Text strong style={{ fontSize: '13px', color: '#1e293b' }}>Requirement Coverage:</Text>
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {aiEvaluation.requirementCoverage.map((req, idx) => (
                            <div key={idx} style={{ background: '#f8fafc', padding: '6px 10px', borderRadius: 6, border: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ fontSize: '12px', color: '#334155' }}>{req.requirement}</Text>
                              <Tag color={req.status === 'EVIDENCED' ? 'green' : req.status === 'PARTIALLY_EVIDENCED' ? 'orange' : 'red'} style={{ fontWeight: 700, fontSize: '11px' }}>
                                {req.status}
                              </Tag>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Criteria Breakdown with Evidence Snippets */}
                    {aiEvaluation.criteria && aiEvaluation.criteria.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <Text strong style={{ fontSize: '13px', color: '#1e293b' }}>Evidence-Backed Criteria:</Text>
                        <List
                          size="small"
                          dataSource={aiEvaluation.criteria}
                          renderItem={(crit) => (
                            <List.Item style={{ padding: '8px 0' }}>
                              <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Text strong style={{ fontSize: '12px', color: '#0f172a' }}>{crit.criterionName}</Text>
                                  <Tag color="purple" style={{ fontWeight: 700 }}>
                                    {crit.suggestedMarks} / {crit.maxMarks}m
                                  </Tag>
                                </div>
                                {crit.evidence && (
                                  <div style={{ fontSize: '11px', color: '#059669', marginTop: 2 }}>
                                    <Text strong style={{ color: '#059669' }}>Evidence: </Text>{crit.evidence}
                                  </div>
                                )}
                                {crit.reason && (
                                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: 1 }}>
                                    <Text strong style={{ color: '#64748b' }}>Reason: </Text>{crit.reason}
                                  </div>
                                )}
                              </div>
                            </List.Item>
                          )}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: '#64748b' }}>
                    <Text type="secondary">AI evidence analysis has not been executed for this submission.</Text>
                    <div style={{ marginTop: 12 }}>
                      <Button
                        type="primary"
                        icon={<FileSearchOutlined />}
                        disabled={!currentSubmission}
                        onClick={() => currentSubmission && handleConfirmRunAI(activeTeam!, currentSubmission)}
                        style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
                      >
                        Run Evidence Analysis with OpenRouter AI
                      </Button>
                    </div>
                  </div>
                )}

                <Divider style={{ margin: '16px 0' }} />

                {/* 4. Authoritative Admin Final Score Form */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text strong style={{ fontSize: '14px', color: '#0f172a' }}>
                      Admin Official Final Score
                    </Text>
                    {currentScore && currentScore.evaluationStatus === 'FINALIZED' ? (
                      <Tag color="green" icon={<CheckSquareOutlined />}>FINALIZED</Tag>
                    ) : (
                      <Tag color="orange">DRAFT</Tag>
                    )}
                  </div>

                  <Form form={form} layout="vertical" onFinish={handleSaveFinalScore}>
                    <Form.Item
                      name="adminFinalScore"
                      label={`Final Marks (0 to ${maxMarks})`}
                      rules={[
                        { required: true, message: 'Final score required' },
                        { type: 'number', min: 0, max: maxMarks, message: `Must be 0 to ${maxMarks}` },
                      ]}
                    >
                      <InputNumber
                        min={0}
                        max={maxMarks}
                        step={0.5}
                        size="large"
                        style={{ width: '100%' }}
                        addonAfter={`/ ${maxMarks} Marks`}
                      />
                    </Form.Item>

                    <Form.Item name="feedback" label="Judge Comments & Reviewer Feedback">
                      <TextArea rows={3} placeholder="Enter official judge comments and feedback..." />
                    </Form.Item>

                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SaveOutlined />}
                      loading={savingFinalScore}
                      disabled={!currentSubmission}
                      style={{ width: '100%', borderRadius: 8, background: '#059669', borderColor: '#059669', fontWeight: 700 }}
                    >
                      Save & Finalize Official Score
                    </Button>
                  </Form>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                Select a team from the table on the left to inspect evidence and evaluate.
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ========================================================================= */}
      {/* FULL EVIDENCE & CONSISTENCY ANALYSIS DRAWER                               */}
      {/* ========================================================================= */}
      <Drawer
        title={
          <Space>
            <AuditOutlined style={{ color: '#722ed1' }} />
            <span style={{ fontWeight: 700 }}>Comprehensive Evidence Analysis — {selectedTeamId}</span>
          </Space>
        }
        open={isFullAnalysisDrawerOpen}
        onClose={() => setIsFullAnalysisDrawerOpen(false)}
        width={650}
      >
        {aiEvaluation && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <Tag color="purple" style={{ fontSize: '15px', fontWeight: 800, padding: '4px 12px' }}>
                AI Suggested Score: {aiEvaluation.suggestedScore} / {maxMarks} Marks
              </Tag>
            </div>

            {/* Requirement Coverage */}
            {aiEvaluation.requirementCoverage && (
              <div style={{ marginBottom: 20 }}>
                <Title level={5} style={{ color: '#1e3a8a' }}>Requirement Coverage Matrix</Title>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {aiEvaluation.requirementCoverage.map((req, idx) => (
                    <Card key={idx} size="small" style={{ borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text strong style={{ fontSize: '13px' }}>{req.requirement}</Text>
                        <Tag color={req.status === 'EVIDENCED' ? 'green' : req.status === 'PARTIALLY_EVIDENCED' ? 'orange' : 'red'}>
                          {req.status}
                        </Tag>
                      </div>
                      {req.evidenceSnippet && (
                        <div style={{ fontSize: '12px', color: '#059669' }}>
                          <Text strong style={{ color: '#059669' }}>Evidence: </Text>{req.evidenceSnippet}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Architecture Analysis */}
            {aiEvaluation.architectureAnalysis && (
              <div style={{ marginBottom: 20 }}>
                <Title level={5} style={{ color: '#1e3a8a' }}>Architecture Inspection</Title>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>Components Found: </Text>
                    <div style={{ marginTop: 4 }}>
                      {aiEvaluation.architectureAnalysis.componentsFound?.map((c, i) => (
                        <Tag key={i} color="blue" style={{ marginBottom: 4 }}>{c}</Tag>
                      ))}
                    </div>
                  </div>
                  {aiEvaluation.architectureAnalysis.missingEvidence && aiEvaluation.architectureAnalysis.missingEvidence.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong style={{ color: '#dc2626' }}>Missing Evidence: </Text>
                      <ul style={{ paddingLeft: 20, color: '#dc2626', fontSize: '12px', margin: '4px 0 0 0' }}>
                        {aiEvaluation.architectureAnalysis.missingEvidence.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* Cross-Round Consistency */}
            {aiEvaluation.consistencyAnalysis && (
              <div style={{ marginBottom: 20 }}>
                <Title level={5} style={{ color: '#1e3a8a' }}>Cross-Round Consistency</Title>
                <Alert
                  message={`Status: ${aiEvaluation.consistencyAnalysis.status}`}
                  description={aiEvaluation.consistencyAnalysis.details}
                  type={aiEvaluation.consistencyAnalysis.status === 'CONSISTENT' ? 'success' : 'warning'}
                  showIcon
                  style={{ borderRadius: 8 }}
                />
              </div>
            )}

            {/* Strengths & Weaknesses */}
            <Row gutter={16}>
              <Col span={12}>
                <Title level={5} style={{ color: '#059669' }}>Strengths</Title>
                <ul style={{ paddingLeft: 18, fontSize: '12px', color: '#334155' }}>
                  {aiEvaluation.strengths?.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </Col>
              <Col span={12}>
                <Title level={5} style={{ color: '#d97706' }}>Areas to Improve</Title>
                <ul style={{ paddingLeft: 18, fontSize: '12px', color: '#334155' }}>
                  {aiEvaluation.weaknesses?.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Col>
            </Row>
          </div>
        )}
      </Drawer>

      {/* ========================================================================= */}
      {/* MODAL SCORE EDITOR                                                        */}
      {/* ========================================================================= */}
      <Modal
        title={`Finalize Score: ${editingTeam?.teamId} • ${editingTeam?.teamName} (Round ${selectedRoundNum})`}
        open={isEditScoreModalOpen}
        onCancel={() => setIsEditScoreModalOpen(false)}
        onOk={() => modalForm.submit()}
        confirmLoading={savingFinalScore}
        okText="Save & Finalize Official Score"
        destroyOnClose
      >
        <Alert
          message="Authoritative Admin Score"
          description={`Enter the official score out of ${maxMarks} marks. This score directly drives the Leaderboard and Results.`}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form form={modalForm} layout="vertical" onFinish={handleSaveModalScore}>
          <Form.Item
            name="adminFinalScore"
            label={`Official Final Score (Max ${maxMarks})`}
            rules={[
              { required: true, message: 'Please enter final score' },
              { type: 'number', min: 0, max: maxMarks, message: `Score must be between 0 and ${maxMarks}` },
            ]}
          >
            <InputNumber min={0} max={maxMarks} step={0.5} size="large" style={{ width: '100%' }} addonAfter={`/ ${maxMarks}`} />
          </Form.Item>

          <Form.Item name="feedback" label="Judge Feedback">
            <TextArea rows={3} placeholder="Provide official feedback to the team..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
