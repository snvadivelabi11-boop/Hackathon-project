import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Button,
  Space,
  Progress,
  Divider,
  Alert,
  Statistic,
  Badge,
} from 'antd';
import {
  FileDoneOutlined,
  FundProjectionScreenOutlined,
  CodeOutlined,
  TrophyOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
  FileTextOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { subscribeToRounds } from '../../services/rounds.service';
import { subscribeToTeamSubmissions } from '../../services/submissions.service';
import { subscribeToTeamScores } from '../../services/scores.service';
import { subscribeToTeamSelection } from '../../services/selection.service';
import { subscribeToTeamMembers } from '../../services/certificates.service';
import { subscribeToTeamAssignment } from '../../services/problems.service';
import {
  subscribeToTimingConfig,
  calculateRoundTimingEvaluation,
} from '../../services/timing.service';
import { Round, Submission, Score, TeamSelection, TeamMember, TeamProblemAssignment, HackathonTimingConfig } from '../../types';
import { CountdownTimer } from '../../components/common/CountdownTimer';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;

export const TeamDashboard: React.FC = () => {
  const { user } = useAuth();
  const { totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();
  const teamId = user?.teamId || '';
  const navigate = useNavigate();

  const [rounds, setRounds] = useState<Round[]>([]);
  const [timingConfig, setTimingConfig] = useState<HackathonTimingConfig | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [selection, setSelection] = useState<TeamSelection | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assignment, setAssignment] = useState<TeamProblemAssignment | null>(null);

  useEffect(() => {
    const unsubRounds = subscribeToRounds(setRounds);
    const unsubTiming = subscribeToTimingConfig(setTimingConfig);
    const unsubSubs = subscribeToTeamSubmissions(teamId, setSubmissions);
    const unsubScores = subscribeToTeamScores(teamId, setScores);
    const unsubSel = subscribeToTeamSelection(teamId, setSelection);
    const unsubMems = subscribeToTeamMembers(teamId, setMembers);
    const unsubAssign = subscribeToTeamAssignment(teamId, setAssignment);

    return () => {
      unsubRounds();
      unsubTiming();
      unsubSubs();
      unsubScores();
      unsubSel();
      unsubMems();
      unsubAssign();
    };
  }, [teamId]);

  const r1Sub = submissions.find((s) => (s.roundId || '').includes('1') || s.round === 1);
  const r2Sub = submissions.find((s) => (s.roundId || '').includes('2') || s.round === 2);
  const r3Sub = submissions.find((s) => (s.roundId || '').includes('3') || s.round === 3);

  const r1Score = scores.find((s) => (s.roundId || '').includes('1') || s.round === 1)?.totalMarks || 0;
  const r2Score = scores.find((s) => (s.roundId || '').includes('2') || s.round === 2)?.totalMarks || 0;
  const r3Score = scores.find((s) => (s.roundId || '').includes('3') || s.round === 3)?.totalMarks || 0;
  const totalScore = Number((r1Score + r2Score + r3Score).toFixed(1));

  const r1Eval = calculateRoundTimingEvaluation('round1', timingConfig, rounds.find((r) => r.id === 'round1'));
  const r2Eval = calculateRoundTimingEvaluation('round2', timingConfig, rounds.find((r) => r.id === 'round2'));
  const r3Eval = calculateRoundTimingEvaluation('round3', timingConfig, rounds.find((r) => r.id === 'round3'));

  const isLiveOrActive = (evalState?: string) => evalState === 'ACTIVE' || evalState === 'LIVE';
  const activeRound =
    rounds.find((r) => r.status === 'ACTIVE' || r.status === 'LIVE') ||
    (isLiveOrActive(r1Eval.state) ? rounds[0] : isLiveOrActive(r2Eval.state) ? rounds[1] : isLiveOrActive(r3Eval.state) ? rounds[2] : null);
  const isSelected = selection?.status === 'SELECTED';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Welcome Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Title level={2} style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>
              Welcome, {user?.displayName || 'Team'}
            </Title>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: '14px', color: '#475569' }}>
                Team ID: <Tag color="blue" style={{ fontWeight: 700 }}>{teamId}</Tag>
              </Text>
              <Text type="secondary" style={{ fontSize: '14px' }}>
                Active Members: <Text strong>{members.length}</Text>
              </Text>
            </div>
          </div>

          <Space wrap>
            <Button
              type="primary"
              icon={<TrophyOutlined />}
              onClick={() => navigate('/team/scores')}
              style={{ borderRadius: 8, background: '#1677ff' }}
            >
              My Scorecard ({totalScore} / {totalMaxMarks})
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              onClick={() => navigate('/team/selection')}
              style={{ borderRadius: 8 }}
            >
              Selection Status
            </Button>
          </Space>
        </div>
      </div>

      {/* Assigned Problem Statement Card (Visible ONLY when PUBLISHED) */}
      {assignment && assignment.status === 'PUBLISHED' && (
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <Space>
                <FileTextOutlined style={{ color: '#1677ff', fontSize: '18px' }} />
                <span style={{ fontWeight: 700 }}>Your Assigned Problem Statement</span>
              </Space>
              <Tag color="blue" style={{ fontWeight: 800, fontSize: '13px' }}>
                {assignment.statementId}
              </Tag>
            </div>
          }
          bordered={false}
          style={{
            borderRadius: 14,
            marginBottom: 24,
            boxShadow: '0 4px 14px rgba(22, 119, 255, 0.08)',
            border: '1px solid #bfdbfe',
            background: 'linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%)',
          }}
          extra={
            <Button
              type="link"
              onClick={() => navigate('/team/problem-statement')}
              style={{ fontWeight: 600 }}
            >
              View Full Details <ArrowRightOutlined />
            </Button>
          }
        >
          <Title level={4} style={{ color: '#1e3a8a', marginTop: 0, marginBottom: 8 }}>
            {assignment.statementTitle || assignment.statementId}
          </Title>
          <Paragraph
            ellipsis={{ rows: 2, expandable: false }}
            style={{ color: '#475569', fontSize: '14px', marginBottom: 12, lineHeight: 1.6 }}
          >
            {assignment.description}
          </Paragraph>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Official Problem Assignment • Locked for all rounds
            </Text>
            <Button
              size="small"
              type="primary"
              onClick={() => navigate('/team/problem-statement')}
              style={{ borderRadius: 6, background: '#1677ff' }}
            >
              Read Problem Specifications
            </Button>
          </div>
        </Card>
      )}

      {/* Live Selection Announcement Banner (if Selected) */}
      {selection?.isPublished && isSelected && (
        <Alert
          message={
            <span style={{ fontWeight: 700, fontSize: '15px' }}>
              🎉 Congratulations! Your team has been selected for the next stage.
            </span>
          }
          description="The evaluation committee has reviewed your submissions and published the official selection results."
          type="success"
          showIcon
          action={
            <Button size="small" type="primary" onClick={() => navigate('/team/selection')} style={{ background: '#059669' }}>
              View Selection Details
            </Button>
          }
          style={{ marginBottom: 24, borderRadius: 12 }}
        />
      )}

      {/* Active Round Banner with Timing */}
      {activeRound && (
        <Card
          bordered={false}
          style={{
            borderRadius: 14,
            marginBottom: 24,
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            color: '#fff',
            boxShadow: '0 8px 24px rgba(5, 150, 105, 0.25)',
          }}
        >
          <Row gutter={[24, 24]} align="middle">
            <Col xs={24} md={14}>
              <Tag color="gold" style={{ fontWeight: 800, fontSize: '11px', marginBottom: 8 }}>
                ROUND CURRENTLY ACTIVE
              </Tag>
              <Title level={3} style={{ color: '#fff', margin: '4px 0 8px' }}>
                {activeRound.name}
              </Title>
              <Paragraph style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', marginBottom: 16 }}>
                {activeRound.description}
              </Paragraph>
              <Button
                type="default"
                size="large"
                onClick={() => {
                  if (activeRound.id.includes('1')) navigate('/team/round1');
                  else if (activeRound.id.includes('2')) navigate('/team/round2');
                  else navigate('/team/round3');
                }}
                style={{
                  fontWeight: 600,
                  borderRadius: 8,
                  color: '#065f46',
                  borderColor: '#fff',
                }}
              >
                Go to Submission Workspace <ArrowRightOutlined />
              </Button>
            </Col>
            <Col xs={24} md={10}>
              <div style={{ background: 'rgba(255,255,255,0.15)', padding: 16, borderRadius: 12, backdropFilter: 'blur(4px)' }}>
                <CountdownTimer
                  endTime={activeRound.endTime}
                  status="ACTIVE"
                  title="Submission Window Closes In"
                  size="large"
                />
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* 3 Primary Rounds */}
      <Title level={4} style={{ marginBottom: 16 }}>
        Hackathon Evaluation Stages (Total {totalMaxMarks} Marks)
      </Title>

      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        {/* Round 1 */}
        <Col xs={24} md={8}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Round 1: Architecture</span>
                <Tag color="cyan">Max {round1MaxMarks} Marks</Tag>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <div style={{ marginBottom: 8 }}>
              <Tag color={r1Eval.badgeColor} style={{ fontWeight: 700 }}>
                {r1Eval.state}
              </Tag>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {r1Eval.state === 'ACTIVE' ? `Closes ${formatISTDateTime(r1Eval.endTime)}` : r1Eval.state === 'PAUSED' ? 'Paused by Admin' : r1Eval.state === 'SCHEDULED' || r1Eval.state === 'UPCOMING' ? `Starts ${formatISTDateTime(r1Eval.startTime)}` : 'Closed'}
              </Text>
            </div>
            <Paragraph type="secondary" style={{ fontSize: '13px', minHeight: 40 }}>
              Modular system architecture and data flow based on your assigned problem statement.
            </Paragraph>
            <div style={{ margin: '14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text type="secondary">Submission: </Text>
                {r1Sub ? <Tag color="green">SUBMITTED</Tag> : <Tag color="default">NOT SUBMITTED</Tag>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Score: </Text>
                <Text strong>{r1Score > 0 ? `${r1Score} / ${round1MaxMarks} Marks` : 'Pending'}</Text>
              </div>
            </div>
            <Button block type="primary" onClick={() => navigate('/team/round1')} style={{ borderRadius: 8 }}>
              {r1Sub ? 'View Round 1' : 'Open Round 1 Workspace'}
            </Button>
          </Card>
        </Col>

        {/* Round 2 */}
        <Col xs={24} md={8}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Round 2: Presentation</span>
                <Tag color="geekblue">Max {round2MaxMarks} Marks</Tag>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <div style={{ marginBottom: 8 }}>
              <Tag color={r2Eval.badgeColor} style={{ fontWeight: 700 }}>
                {r2Eval.state}
              </Tag>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {r2Eval.state === 'ACTIVE' ? `Closes ${formatISTDateTime(r2Eval.endTime)}` : r2Eval.state === 'PAUSED' ? 'Paused by Admin' : r2Eval.state === 'SCHEDULED' || r2Eval.state === 'UPCOMING' ? `Starts ${formatISTDateTime(r2Eval.startTime)}` : 'Closed'}
              </Text>
            </div>
            <Paragraph type="secondary" style={{ fontSize: '13px', minHeight: 40 }}>
              Technical slide deck presenting solution design and implementation milestones.
            </Paragraph>
            <div style={{ margin: '14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text type="secondary">Submission: </Text>
                {r2Sub ? <Tag color="green">SUBMITTED</Tag> : <Tag color="default">NOT SUBMITTED</Tag>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Score: </Text>
                <Text strong>{r2Score > 0 ? `${r2Score} / ${round2MaxMarks} Marks` : 'Pending'}</Text>
              </div>
            </div>
            <Button block onClick={() => navigate('/team/round2')} style={{ borderRadius: 8 }}>
              {r2Sub ? 'View Round 2' : 'Open Round 2 Workspace'}
            </Button>
          </Card>
        </Col>

        {/* Round 3 */}
        <Col xs={24} md={8}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Round 3: Prototype</span>
                <Tag color="purple">Max {round3MaxMarks} Marks</Tag>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <div style={{ marginBottom: 8 }}>
              <Tag color={r3Eval.badgeColor} style={{ fontWeight: 700 }}>
                {r3Eval.state}
              </Tag>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {r3Eval.state === 'ACTIVE' ? `Closes ${formatISTDateTime(r3Eval.endTime)}` : r3Eval.state === 'PAUSED' ? 'Paused by Admin' : r3Eval.state === 'SCHEDULED' || r3Eval.state === 'UPCOMING' ? `Starts ${formatISTDateTime(r3Eval.startTime)}` : 'Closed'}
              </Text>
            </div>
            <Paragraph type="secondary" style={{ fontSize: '13px', minHeight: 40 }}>
              Functional prototype code repository and GitHub submission.
            </Paragraph>
            <div style={{ margin: '14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text type="secondary">Submission: </Text>
                {r3Sub ? <Tag color="green">SUBMITTED</Tag> : <Tag color="default">NOT SUBMITTED</Tag>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Score: </Text>
                <Text strong>{r3Score > 0 ? `${r3Score} / ${round3MaxMarks} Marks` : 'Pending'}</Text>
              </div>
            </div>
            <Button block onClick={() => navigate('/team/round3')} style={{ borderRadius: 8 }}>
              {r3Sub ? 'View Round 3' : 'Open Round 3 Workspace'}
            </Button>
          </Card>
        </Col>
      </Row>

      {/* Quick Links */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card
            hoverable
            onClick={() => navigate('/team/scores')}
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <Space>
              <TrophyOutlined style={{ fontSize: '24px', color: '#1677ff' }} />
              <div>
                <Text strong style={{ fontSize: '15px' }}>Official Scorecard & Evaluation Feedback</Text>
                <br />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Track live marks across Round 1, Round 2, and Round 3
                </Text>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} sm={12}>
          <Card
            hoverable
            onClick={() => navigate('/team/certificates')}
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <Space>
              <SafetyCertificateOutlined style={{ fontSize: '24px', color: '#52c41a' }} />
              <div>
                <Text strong style={{ fontSize: '15px' }}>Team Certificates Hub</Text>
                <br />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  View and download official team participation certificates
                </Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};
