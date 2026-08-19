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
  message,
  Statistic,
  Alert,
  Modal,
  List,
  Spin,
  Empty,
} from 'antd';
import {
  RobotOutlined,
  SaveOutlined,
  LinkOutlined,
  GithubOutlined,
  CheckCircleOutlined,
  BulbOutlined,
  WarningOutlined,
  ApartmentOutlined,
  TeamOutlined,
  FundProjectionScreenOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  TrophyOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { subscribeToTeams } from '../../services/accounts.service';
import { subscribeToAllSubmissions } from '../../services/submissions.service';
import { subscribeToAllScores } from '../../services/scores.service';
import {
  triggerAIEvaluation,
  saveAdminFinalScore,
  subscribeToAIEvaluation,
} from '../../services/ai.service';
import {
  Team,
  Submission,
  Score,
  AIEvaluation,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { safeRoundNumber } from '../../utils/normalize';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export const AIAnalyticsPage: React.FC = () => {
  const { user } = useAuth();
  const { getMaxMarks, totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();

  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  // Assigned Problem Statement Info for Active Team
  const [assignedProblem, setAssignedProblem] = useState<any>(null);
  const [loadingProblem, setLoadingProblem] = useState(false);

  // Round Evaluations
  const [evalRound1, setEvalRound1] = useState<AIEvaluation | null>(null);
  const [evalRound2, setEvalRound2] = useState<AIEvaluation | null>(null);
  const [evalRound3, setEvalRound3] = useState<AIEvaluation | null>(null);

  // Evaluation trigger states
  const [runningRound, setRunningRound] = useState<number | null>(null);
  const [savingRound, setSavingRound] = useState<number | null>(null);

  // Score forms
  const [formR1] = Form.useForm();
  const [formR2] = Form.useForm();
  const [formR3] = Form.useForm();

  useEffect(() => {
    const unsubTeams = subscribeToTeams((loaded) => {
      setTeams(loaded);
      if (loaded.length > 0) {
        setSelectedTeamId((prev) => (prev && loaded.some((t) => t.teamId === prev) ? prev : loaded[0].teamId));
      } else {
        setSelectedTeamId('');
      }
    });
    const unsubSubs = subscribeToAllSubmissions(setSubmissions);
    const unsubScores = subscribeToAllScores(setScores);

    return () => {
      unsubTeams();
      unsubSubs();
      unsubScores();
    };
  }, []);

  const activeTeam = useMemo(() => teams.find((t) => t.teamId === selectedTeamId), [teams, selectedTeamId]);

  // Load Assigned Problem Statement Details when Team changes
  useEffect(() => {
    if (!selectedTeamId) {
      setAssignedProblem(null);
      return;
    }

    setLoadingProblem(true);
    const fetchProblem = async () => {
      try {
        const assignSnap = await getDoc(doc(db, 'teamProblemAssignments', selectedTeamId));
        if (assignSnap.exists()) {
          setAssignedProblem(assignSnap.data());
        } else if (activeTeam?.assignedStatementId) {
          const psSnap = await getDoc(doc(db, 'problemStatements', activeTeam.assignedStatementId));
          if (psSnap.exists()) {
            setAssignedProblem(psSnap.data());
          } else {
            setAssignedProblem(null);
          }
        } else {
          setAssignedProblem(null);
        }
      } catch (err) {
        console.warn('Error loading problem statement:', err);
        setAssignedProblem(null);
      } finally {
        setLoadingProblem(false);
      }
    };

    fetchProblem();
  }, [selectedTeamId, activeTeam]);

  // Submissions for each round
  const subR1 = useMemo(
    () => submissions.find((s) => s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === 1),
    [submissions, selectedTeamId]
  );
  const subR2 = useMemo(
    () => submissions.find((s) => s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === 2),
    [submissions, selectedTeamId]
  );
  const subR3 = useMemo(
    () => submissions.find((s) => s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === 3),
    [submissions, selectedTeamId]
  );

  // Scores for each round
  const scoreR1 = useMemo(
    () => scores.find((s) => s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === 1),
    [scores, selectedTeamId]
  );
  const scoreR2 = useMemo(
    () => scores.find((s) => s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === 2),
    [scores, selectedTeamId]
  );
  const scoreR3 = useMemo(
    () => scores.find((s) => s.teamId === selectedTeamId && safeRoundNumber(s.round || s.roundId) === 3),
    [scores, selectedTeamId]
  );

  // Subscribe to real evaluations for each round
  useEffect(() => {
    if (!selectedTeamId) {
      setEvalRound1(null);
      setEvalRound2(null);
      setEvalRound3(null);
      return;
    }

    const id1 = subR1?.id || `${selectedTeamId}_round1`;
    const id2 = subR2?.id || `${selectedTeamId}_round2`;
    const id3 = subR3?.id || `${selectedTeamId}_round3`;

    const unsub1 = subscribeToAIEvaluation(id1, setEvalRound1);
    const unsub2 = subscribeToAIEvaluation(id2, setEvalRound2);
    const unsub3 = subscribeToAIEvaluation(id3, setEvalRound3);

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [selectedTeamId, subR1?.id, subR2?.id, subR3?.id]);

  // Sync Form values
  useEffect(() => {
    formR1.setFieldsValue({
      finalScore: scoreR1?.totalMarks ?? evalRound1?.suggestedScore ?? null,
      feedback: scoreR1?.feedback || evalRound1?.summary || '',
    });
  }, [evalRound1, scoreR1, formR1]);

  useEffect(() => {
    formR2.setFieldsValue({
      finalScore: scoreR2?.totalMarks ?? evalRound2?.suggestedScore ?? null,
      feedback: scoreR2?.feedback || evalRound2?.summary || '',
    });
  }, [evalRound2, scoreR2, formR2]);

  useEffect(() => {
    formR3.setFieldsValue({
      finalScore: scoreR3?.totalMarks ?? evalRound3?.suggestedScore ?? null,
      feedback: scoreR3?.feedback || evalRound3?.summary || '',
    });
  }, [evalRound3, scoreR3, formR3]);

  // Run AI Evaluation for a round
  const handleRunEvaluation = async (roundNum: number, sub?: Submission) => {
    if (!activeTeam) return;
    if (!assignedProblem) {
      Modal.warning({
        title: 'NO PROJECT / PROBLEM STATEMENT ASSIGNED',
        content: `Team ${activeTeam.teamId} has no assigned problem statement. Please assign a published problem statement in Problem Statements Management first.`,
      });
      return;
    }

    if (!sub) {
      Modal.warning({
        title: `PROBLEM ASSIGNED — SUBMISSION NOT FOUND`,
        content: `Team ${activeTeam.teamId} has not submitted any deliverable for Round ${roundNum}. AI evaluation cannot evaluate non-existent submissions.`,
      });
      return;
    }

    const roundId = `round${roundNum}`;
    const maxM = getMaxMarks(roundNum);

    setRunningRound(roundNum);
    try {
      const res = await triggerAIEvaluation(sub.id, selectedTeamId, roundId);
      message.success(
        `Round ${roundNum} AI Evaluation complete! Suggested: ${res.suggestedScore || res.score} / ${res.maxScore || maxM} Marks`
      );
    } catch (err: any) {
      message.error(err.message || `AI evaluation could not be completed for Round ${roundNum}. Please retry.`);
    } finally {
      setRunningRound(null);
    }
  };

  // Save Final Score for a round
  const handleSaveScore = async (roundNum: number, values: any, sub?: Submission) => {
    if (!activeTeam || !sub) {
      message.warning('Cannot save official score without an actual team submission.');
      return;
    }

    const roundId = `round${roundNum}`;
    const maxM = getMaxMarks(roundNum);
    const finalScore = Number(values.finalScore);

    if (isNaN(finalScore) || finalScore < 0 || finalScore > maxM) {
      message.error(`Final score must be between 0 and ${maxM} marks.`);
      return;
    }

    setSavingRound(roundNum);
    try {
      await saveAdminFinalScore(
        sub.id,
        selectedTeamId,
        roundId,
        finalScore,
        values.feedback || '',
        { uid: user?.uid, email: user?.email },
        maxM
      );
      message.success(`Round ${roundNum} score finalized: ${finalScore} / ${maxM} Marks!`);
    } catch (err: any) {
      message.error(err.message || 'Failed to save score.');
    } finally {
      setSavingRound(null);
    }
  };

  // Compute Total Official Score
  const totalFinalScore = useMemo(() => {
    let sum = 0;
    let count = 0;
    if (scoreR1 && scoreR1.evaluationStatus === 'FINALIZED' && scoreR1.totalMarks !== null && scoreR1.totalMarks !== undefined) {
      sum += Number(scoreR1.totalMarks);
      count++;
    }
    if (scoreR2 && scoreR2.evaluationStatus === 'FINALIZED' && scoreR2.totalMarks !== null && scoreR2.totalMarks !== undefined) {
      sum += Number(scoreR2.totalMarks);
      count++;
    }
    if (scoreR3 && scoreR3.evaluationStatus === 'FINALIZED' && scoreR3.totalMarks !== null && scoreR3.totalMarks !== undefined) {
      sum += Number(scoreR3.totalMarks);
      count++;
    }
    return { sum, count, percentage: totalMaxMarks > 0 ? Math.round((sum / totalMaxMarks) * 100) : 0 };
  }, [scoreR1, scoreR2, scoreR3, totalMaxMarks]);

  if (teams.length === 0) {
    return (
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '40px 0' }}>
        <Card bordered={false} style={{ borderRadius: 14, textAlign: 'center', padding: '40px 20px' }}>
          <Empty
            description={
              <div>
                <Title level={4} style={{ color: '#475569', marginBottom: 6 }}>
                  No data available.
                </Title>
                <Text type="secondary">
                  No registered teams found in database. Teams will appear here once registered.
                </Text>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

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
          marginBottom: 20,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
            AI Analytics & Deep Evaluation Hub
          </Title>
          <Text type="secondary">
            Team-specific problem context • Evidence-first multi-round evaluation • Dynamic rubric scaling • Admin final authority
          </Text>
        </div>

        {/* Team Selector Dropdown */}
        <div style={{ minWidth: 280 }}>
          <Select
            value={selectedTeamId}
            onChange={(val) => setSelectedTeamId(val)}
            style={{ width: '100%' }}
            size="large"
            placeholder="Select a registered team"
            showSearch
            optionFilterProp="children"
          >
            {teams.map((t) => (
              <Select.Option key={t.teamId} value={t.teamId}>
                <Space>
                  <Tag color="blue" style={{ fontWeight: 800 }}>{t.teamId}</Tag>
                  <span>{t.teamName}</span>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>

      {/* Overview Metric Row */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Active Team Selected</span>}
              value={activeTeam?.teamId || 'None'}
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>• {activeTeam?.teamName || 'No Team'}</span>}
              prefix={<TeamOutlined style={{ color: '#1677ff', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 8, fontSize: '12px', color: '#64748b' }}>
              Leader: <Text strong>{activeTeam?.leaderName || '—'}</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Assigned Problem Statement</span>}
              value={assignedProblem?.statementTitle || assignedProblem?.title || activeTeam?.assignedStatementTitle || 'Unassigned'}
              valueStyle={{ fontSize: '16px', fontWeight: 700 }}
              prefix={<FundProjectionScreenOutlined style={{ color: '#722ed1', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 8, fontSize: '12px', color: '#64748b' }}>
              Code: <Tag color="purple">{assignedProblem?.statementId || activeTeam?.assignedStatementId || 'None'}</Tag>
              Status: <Tag color={assignedProblem?.status === 'PUBLISHED' ? 'green' : 'orange'}>{assignedProblem?.status || 'DRAFT'}</Tag>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Total Official Final Score</span>}
              value={totalFinalScore.sum}
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>/ {totalMaxMarks} Marks ({totalFinalScore.percentage}%)</span>}
              prefix={<TrophyOutlined style={{ color: '#059669', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 8, fontSize: '12px', color: '#64748b' }}>
              {totalFinalScore.count} / 3 Rounds Finalized
            </div>
          </Card>
        </Col>
      </Row>

      {/* ========================================================================= */}
      {/* 1. PROBLEM STATEMENT DEEP ANALYSIS CARD                                    */}
      {/* ========================================================================= */}
      <Card
        title={
          <Space>
            <BulbOutlined style={{ color: '#722ed1', fontSize: '18px' }} />
            <span style={{ fontWeight: 700 }}>1. Problem Statement Analysis & Evaluation Context</span>
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 24 }}
      >
        {loadingProblem ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin tip="Loading problem statement analysis..." />
          </div>
        ) : assignedProblem ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <Tag color="blue" style={{ fontSize: '13px', fontWeight: 800 }}>
                  {assignedProblem.statementId || 'PS001'}
                </Tag>
                <Text strong style={{ fontSize: '15px', color: '#0f172a', marginLeft: 8 }}>
                  {assignedProblem.statementTitle || assignedProblem.title}
                </Text>
              </div>
              <Tag color={assignedProblem.status === 'PUBLISHED' ? 'green' : 'orange'}>
                {assignedProblem.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'}
              </Tag>
            </div>

            <Paragraph style={{ fontSize: '13px', color: '#334155', lineHeight: 1.7, marginBottom: 16 }}>
              {assignedProblem.description}
            </Paragraph>

            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <Text strong style={{ fontSize: '12px', color: '#0369a1' }}>Key Requirements:</Text>
                  {Array.isArray(assignedProblem.requirements) && assignedProblem.requirements.length > 0 ? (
                    <ul style={{ paddingLeft: 18, fontSize: '12px', color: '#475569', margin: '4px 0 0 0' }}>
                      {assignedProblem.requirements.map((r: string, i: number) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: 4 }}>Standard requirements defined in challenge scope.</div>
                  )}
                </div>
              </Col>

              <Col xs={24} md={12}>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <Text strong style={{ fontSize: '12px', color: '#1e3a8a' }}>Technical Guidelines & Constraints:</Text>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: 4 }}>
                    {assignedProblem.technicalGuidelines || assignedProblem.constraints || 'Adhere to modular architecture, resilient data pipelines, and clear API boundaries.'}
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        ) : (
          <Alert
            message="NO PROJECT / PROBLEM STATEMENT ASSIGNED"
            description="This team does not have an assigned problem statement. AI evaluation cannot run without knowing the assigned challenge."
            type="warning"
            showIcon
          />
        )}
      </Card>

      {/* ========================================================================= */}
      {/* 2. ROUND 1: ARCHITECTURE EVALUATION                                       */}
      {/* ========================================================================= */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <ApartmentOutlined style={{ color: '#1677ff', fontSize: '18px' }} />
              <span style={{ fontWeight: 700 }}>Round 1 — Architecture & System Design</span>
            </Space>
            <Tag color="blue" style={{ fontWeight: 700 }}>Max {round1MaxMarks} Marks</Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 24 }}
      >
        <Row gutter={[24, 24]}>
          {/* Left: AI Evidence Findings */}
          <Col xs={24} lg={14}>
            {/* Submission Status */}
            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: '13px' }}>Submission Deliverable</Text>
                {subR1 ? (
                  <Tag color="green" icon={<CheckCircleOutlined />}>Submitted</Tag>
                ) : (
                  <Tag color="default">Not Submitted</Tag>
                )}
              </div>
              {subR1 ? (
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  Deliverable: <Text strong>{subR1.fileName || 'Architecture Document'}</Text>
                  {subR1.fileUrl && (
                    <span style={{ marginLeft: 12 }}>
                      <a href={subR1.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                        <LinkOutlined /> Inspect Submitted Architecture File
                      </a>
                    </span>
                  )}
                </div>
              ) : (
                <Alert
                  message="PROBLEM ASSIGNED — SUBMISSION NOT FOUND."
                  description="No submission deliverable uploaded for Round 1. AI cannot evaluate a missing deliverable."
                  type="info"
                  showIcon
                  style={{ marginTop: 6, fontSize: '12px' }}
                />
              )}
            </div>

            {/* AI Analysis Findings */}
            {evalRound1 && evalRound1.status !== 'NO_SUBMISSION' && evalRound1.status !== 'NO_PROBLEM_ASSIGNED' && evalRound1.status !== 'NO_ACTIVE_TEAM' ? (
              <div>
                <div style={{ background: '#faf5ff', padding: 12, borderRadius: 8, marginBottom: 14, border: '1px solid #d3adf7' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space>
                      <RobotOutlined style={{ color: '#722ed1' }} />
                      <Text strong style={{ color: '#581c87' }}>AI Recommendation: {evalRound1.suggestedScore} / {round1MaxMarks} Marks</Text>
                    </Space>
                    <Tag color="purple" style={{ fontWeight: 700 }}>
                      Confidence: {evalRound1.confidenceLevel || 'HIGH'}
                    </Tag>
                  </div>
                  <Paragraph style={{ fontSize: '12px', color: '#475569', margin: 0 }}>
                    {evalRound1.summary}
                  </Paragraph>
                </div>

                {/* Similarity Analysis */}
                {evalRound1.similarityAnalysis && (
                  <div style={{ marginBottom: 14 }}>
                    <Text strong style={{ fontSize: '12px', color: '#1e293b' }}>Architecture Pattern & Similarity Analysis:</Text>
                    <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #f1f5f9', marginTop: 4 }}>
                      <Tag color={evalRound1.similarityAnalysis.status === 'HIGH' ? 'green' : evalRound1.similarityAnalysis.status === 'MEDIUM' ? 'blue' : 'orange'}>
                        Similarity: {evalRound1.similarityAnalysis.status}
                      </Tag>
                      <Text style={{ fontSize: '12px', color: '#334155', marginLeft: 6 }}>
                        {evalRound1.similarityAnalysis.reason}
                      </Text>
                    </div>
                  </div>
                )}

                {/* Requirement Coverage */}
                {evalRound1.requirementCoverage && evalRound1.requirementCoverage.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <Text strong style={{ fontSize: '12px', color: '#1e293b' }}>Requirement Coverage:</Text>
                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {evalRound1.requirementCoverage.map((req, i) => (
                        <div key={i} style={{ background: '#f8fafc', padding: '6px 10px', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ fontSize: '12px', color: '#334155' }}>{req.requirement}</Text>
                          <Tag color={req.status === 'EVIDENCED' ? 'green' : req.status === 'PARTIALLY_EVIDENCED' ? 'orange' : 'red'}>
                            {req.status}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing Evidence Warning */}
                {evalRound1.missingEvidence && evalRound1.missingEvidence.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <Text strong style={{ color: '#dc2626', fontSize: '12px' }}>Missing Evidence: </Text>
                    <ul style={{ paddingLeft: 18, color: '#dc2626', fontSize: '12px', margin: '4px 0 0 0' }}>
                      {evalRound1.missingEvidence.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Button
                    type="default"
                    size="small"
                    icon={<RobotOutlined />}
                    disabled={!subR1}
                    loading={runningRound === 1}
                    onClick={() => handleRunEvaluation(1, subR1)}
                    style={{ fontWeight: 600 }}
                  >
                    Re-run AI Evaluation
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                <Text type="secondary">AI evaluation has not been run for Round 1.</Text>
                <div style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    disabled={!subR1 || !assignedProblem}
                    loading={runningRound === 1}
                    onClick={() => handleRunEvaluation(1, subR1)}
                    style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
                  >
                    Run Round 1 AI Analysis
                  </Button>
                </div>
              </div>
            )}
          </Col>

          {/* Right: Authoritative Admin Final Score Editor */}
          <Col xs={24} lg={10}>
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text strong style={{ fontSize: '13px', color: '#0f172a' }}>Admin Official Final Score</Text>
                {scoreR1 && scoreR1.evaluationStatus === 'FINALIZED' ? (
                  <Tag color="green" icon={<CheckSquareOutlined />}>FINALIZED</Tag>
                ) : (
                  <Tag color="orange">DRAFT</Tag>
                )}
              </div>

              <Form form={formR1} layout="vertical" onFinish={(values) => handleSaveScore(1, values, subR1)}>
                <Form.Item
                  name="finalScore"
                  label={`Official Marks (0 to ${round1MaxMarks})`}
                  rules={[
                    { required: true, message: 'Final score required' },
                    { type: 'number', min: 0, max: round1MaxMarks, message: `Must be 0 to ${round1MaxMarks}` },
                  ]}
                >
                  <InputNumber
                    min={0}
                    max={round1MaxMarks}
                    step={0.5}
                    size="large"
                    style={{ width: '100%' }}
                    addonAfter={`/ ${round1MaxMarks} Marks`}
                  />
                </Form.Item>

                <Form.Item name="feedback" label="Judge Review & Comments">
                  <TextArea rows={3} placeholder="Enter official feedback for Round 1..." />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={savingRound === 1}
                  disabled={!subR1}
                  style={{ width: '100%', borderRadius: 8, background: '#059669', borderColor: '#059669', fontWeight: 700 }}
                >
                  Save & Finalize Round 1 Score
                </Button>
              </Form>
            </div>
          </Col>
        </Row>
      </Card>

      {/* ========================================================================= */}
      {/* 3. ROUND 2: PPT / PRESENTATION EVALUATION                                  */}
      {/* ========================================================================= */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <FundProjectionScreenOutlined style={{ color: '#d97706', fontSize: '18px' }} />
              <span style={{ fontWeight: 700 }}>Round 2 — Presentation & Technical Feasibility</span>
            </Space>
            <Tag color="gold" style={{ fontWeight: 700 }}>Max {round2MaxMarks} Marks</Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 24 }}
      >
        <Row gutter={[24, 24]}>
          {/* Left: AI Findings */}
          <Col xs={24} lg={14}>
            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: '13px' }}>Presentation Deliverable</Text>
                {subR2 ? (
                  <Tag color="green" icon={<CheckCircleOutlined />}>Submitted</Tag>
                ) : (
                  <Tag color="default">Not Submitted</Tag>
                )}
              </div>
              {subR2 ? (
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  Deliverable: <Text strong>{subR2.fileName || 'Presentation Slide Deck'}</Text>
                  {subR2.fileUrl && (
                    <span style={{ marginLeft: 12 }}>
                      <a href={subR2.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                        <LinkOutlined /> View Submitted Presentation File
                      </a>
                    </span>
                  )}
                </div>
              ) : (
                <Alert
                  message="PROBLEM ASSIGNED — SUBMISSION NOT FOUND."
                  description="No submission deliverable uploaded for Round 2. AI cannot evaluate a missing deliverable."
                  type="info"
                  showIcon
                  style={{ marginTop: 6, fontSize: '12px' }}
                />
              )}
            </div>

            {evalRound2 && evalRound2.status !== 'NO_SUBMISSION' && evalRound2.status !== 'NO_PROBLEM_ASSIGNED' && evalRound2.status !== 'NO_ACTIVE_TEAM' ? (
              <div>
                <div style={{ background: '#faf5ff', padding: 12, borderRadius: 8, marginBottom: 14, border: '1px solid #d3adf7' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space>
                      <RobotOutlined style={{ color: '#722ed1' }} />
                      <Text strong style={{ color: '#581c87' }}>AI Recommendation: {evalRound2.suggestedScore} / {round2MaxMarks} Marks</Text>
                    </Space>
                    <Tag color="purple" style={{ fontWeight: 700 }}>
                      Confidence: {evalRound2.confidenceLevel || 'HIGH'}
                    </Tag>
                  </div>
                  <Paragraph style={{ fontSize: '12px', color: '#475569', margin: 0 }}>
                    {evalRound2.summary}
                  </Paragraph>
                </div>

                {evalRound2.strengths && evalRound2.strengths.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Text strong style={{ fontSize: '12px', color: '#059669' }}>Presentation Strengths:</Text>
                    <ul style={{ paddingLeft: 18, fontSize: '12px', color: '#334155', margin: '4px 0 0 0' }}>
                      {evalRound2.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Button
                    type="default"
                    size="small"
                    icon={<RobotOutlined />}
                    disabled={!subR2}
                    loading={runningRound === 2}
                    onClick={() => handleRunEvaluation(2, subR2)}
                    style={{ fontWeight: 600 }}
                  >
                    Re-run AI Evaluation
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                <Text type="secondary">AI evaluation has not been run for Round 2.</Text>
                <div style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    disabled={!subR2 || !assignedProblem}
                    loading={runningRound === 2}
                    onClick={() => handleRunEvaluation(2, subR2)}
                    style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
                  >
                    Run Round 2 AI Analysis
                  </Button>
                </div>
              </div>
            )}
          </Col>

          {/* Right: Score Editor */}
          <Col xs={24} lg={10}>
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text strong style={{ fontSize: '13px', color: '#0f172a' }}>Admin Official Final Score</Text>
                {scoreR2 && scoreR2.evaluationStatus === 'FINALIZED' ? (
                  <Tag color="green" icon={<CheckSquareOutlined />}>FINALIZED</Tag>
                ) : (
                  <Tag color="orange">DRAFT</Tag>
                )}
              </div>

              <Form form={formR2} layout="vertical" onFinish={(values) => handleSaveScore(2, values, subR2)}>
                <Form.Item
                  name="finalScore"
                  label={`Official Marks (0 to ${round2MaxMarks})`}
                  rules={[
                    { required: true, message: 'Final score required' },
                    { type: 'number', min: 0, max: round2MaxMarks, message: `Must be 0 to ${round2MaxMarks}` },
                  ]}
                >
                  <InputNumber
                    min={0}
                    max={round2MaxMarks}
                    step={0.5}
                    size="large"
                    style={{ width: '100%' }}
                    addonAfter={`/ ${round2MaxMarks} Marks`}
                  />
                </Form.Item>

                <Form.Item name="feedback" label="Judge Review & Comments">
                  <TextArea rows={3} placeholder="Enter official feedback for Round 2..." />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={savingRound === 2}
                  disabled={!subR2}
                  style={{ width: '100%', borderRadius: 8, background: '#059669', borderColor: '#059669', fontWeight: 700 }}
                >
                  Save & Finalize Round 2 Score
                </Button>
              </Form>
            </div>
          </Col>
        </Row>
      </Card>

      {/* ========================================================================= */}
      {/* 4. ROUND 3: PROTOTYPE / GITHUB REPOSITORY EVALUATION                      */}
      {/* ========================================================================= */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <CodeOutlined style={{ color: '#059669', fontSize: '18px' }} />
              <span style={{ fontWeight: 700 }}>Round 3 — Prototype & GitHub Repository</span>
            </Space>
            <Tag color="green" style={{ fontWeight: 700 }}>Max {round3MaxMarks} Marks</Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Row gutter={[24, 24]}>
          {/* Left: AI Findings */}
          <Col xs={24} lg={14}>
            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: '13px' }}>Prototype Deliverables</Text>
                {subR3 ? (
                  <Tag color="green" icon={<CheckCircleOutlined />}>Submitted</Tag>
                ) : (
                  <Tag color="default">Not Submitted</Tag>
                )}
              </div>
              {subR3 ? (
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  {subR3.githubRepoUrl && (
                    <div>
                      GitHub Repository: <a href={subR3.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: '#24292e' }}><GithubOutlined /> {subR3.githubRepoUrl}</a>
                    </div>
                  )}
                  {subR3.fileUrl && (
                    <div style={{ marginTop: 4 }}>
                      Deliverable File: <a href={subR3.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}><LinkOutlined /> View Archive / Screenshots</a>
                    </div>
                  )}
                </div>
              ) : (
                <Alert
                  message="PROBLEM ASSIGNED — SUBMISSION NOT FOUND."
                  description="No submission deliverable uploaded for Round 3. AI cannot evaluate a missing deliverable."
                  type="info"
                  showIcon
                  style={{ marginTop: 6, fontSize: '12px' }}
                />
              )}
            </div>

            {evalRound3 && evalRound3.status !== 'NO_SUBMISSION' && evalRound3.status !== 'NO_PROBLEM_ASSIGNED' && evalRound3.status !== 'NO_ACTIVE_TEAM' ? (
              <div>
                <div style={{ background: '#faf5ff', padding: 12, borderRadius: 8, marginBottom: 14, border: '1px solid #d3adf7' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space>
                      <RobotOutlined style={{ color: '#722ed1' }} />
                      <Text strong style={{ color: '#581c87' }}>AI Recommendation: {evalRound3.suggestedScore} / {round3MaxMarks} Marks</Text>
                    </Space>
                    <Tag color="purple" style={{ fontWeight: 700 }}>
                      Confidence: {evalRound3.confidenceLevel || 'HIGH'}
                    </Tag>
                  </div>
                  <Paragraph style={{ fontSize: '12px', color: '#475569', margin: 0 }}>
                    {evalRound3.summary}
                  </Paragraph>
                </div>

                {evalRound3.criteria && evalRound3.criteria.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Text strong style={{ fontSize: '12px', color: '#1e293b' }}>Implementation Evidence:</Text>
                    <List
                      size="small"
                      dataSource={evalRound3.criteria}
                      renderItem={(crit) => (
                        <List.Item style={{ padding: '6px 0' }}>
                          <div style={{ width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <Text strong style={{ fontSize: '12px' }}>{crit.criterionName}</Text>
                              <Tag color="purple">{crit.suggestedMarks} / {crit.maxMarks}m</Tag>
                            </div>
                            {crit.evidence && (
                              <div style={{ fontSize: '11px', color: '#059669', marginTop: 2 }}>
                                <Text strong style={{ color: '#059669' }}>Evidence: </Text>{crit.evidence}
                              </div>
                            )}
                          </div>
                        </List.Item>
                      )}
                    />
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Button
                    type="default"
                    size="small"
                    icon={<RobotOutlined />}
                    disabled={!subR3}
                    loading={runningRound === 3}
                    onClick={() => handleRunEvaluation(3, subR3)}
                    style={{ fontWeight: 600 }}
                  >
                    Re-run AI Evaluation
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                <Text type="secondary">AI evaluation has not been run for Round 3.</Text>
                <div style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    disabled={!subR3 || !assignedProblem}
                    loading={runningRound === 3}
                    onClick={() => handleRunEvaluation(3, subR3)}
                    style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
                  >
                    Run Round 3 AI Analysis
                  </Button>
                </div>
              </div>
            )}
          </Col>

          {/* Right: Score Editor */}
          <Col xs={24} lg={10}>
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text strong style={{ fontSize: '13px', color: '#0f172a' }}>Admin Official Final Score</Text>
                {scoreR3 && scoreR3.evaluationStatus === 'FINALIZED' ? (
                  <Tag color="green" icon={<CheckSquareOutlined />}>FINALIZED</Tag>
                ) : (
                  <Tag color="orange">DRAFT</Tag>
                )}
              </div>

              <Form form={formR3} layout="vertical" onFinish={(values) => handleSaveScore(3, values, subR3)}>
                <Form.Item
                  name="finalScore"
                  label={`Official Marks (0 to ${round3MaxMarks})`}
                  rules={[
                    { required: true, message: 'Final score required' },
                    { type: 'number', min: 0, max: round3MaxMarks, message: `Must be 0 to ${round3MaxMarks}` },
                  ]}
                >
                  <InputNumber
                    min={0}
                    max={round3MaxMarks}
                    step={0.5}
                    size="large"
                    style={{ width: '100%' }}
                    addonAfter={`/ ${round3MaxMarks} Marks`}
                  />
                </Form.Item>

                <Form.Item name="feedback" label="Judge Review & Comments">
                  <TextArea rows={3} placeholder="Enter official feedback for Round 3..." />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={savingRound === 3}
                  disabled={!subR3}
                  style={{ width: '100%', borderRadius: 8, background: '#059669', borderColor: '#059669', fontWeight: 700 }}
                >
                  Save & Finalize Round 3 Score
                </Button>
              </Form>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
};
