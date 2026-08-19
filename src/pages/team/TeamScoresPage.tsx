import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Statistic,
  Progress,
  Divider,
  Alert,
  Space,
} from 'antd';
import {
  TrophyOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  LockOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { subscribeToTeamScores, subscribeToScoresPublishStatus } from '../../services/scores.service';
import { subscribeToRounds } from '../../services/rounds.service';
import { Score, Round } from '../../types';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;

export const TeamScoresPage: React.FC = () => {
  const { user } = useAuth();
  const { totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();
  const teamId = user?.teamId || '';

  const [scores, setScores] = useState<Score[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [scoresPublished, setScoresPublished] = useState<boolean>(true);

  useEffect(() => {
    const unsubScores = subscribeToTeamScores(teamId, setScores);
    const unsubRounds = subscribeToRounds(setRounds);
    const unsubPub = subscribeToScoresPublishStatus(setScoresPublished);

    return () => {
      unsubScores();
      unsubRounds();
      unsubPub();
    };
  }, [teamId]);

  const r1Score = scores.find((s) => (s.roundId || '').includes('1') || s.round === 1);
  const r2Score = scores.find((s) => (s.roundId || '').includes('2') || s.round === 2);
  const r3Score = scores.find((s) => (s.roundId || '').includes('3') || s.round === 3);

  const r1Marks = r1Score?.totalMarks ?? null;
  const r2Marks = r2Score?.totalMarks ?? null;
  const r3Marks = r3Score?.totalMarks ?? null;

  const totalScore = (r1Marks || 0) + (r2Marks || 0) + (r3Marks || 0);
  const hasAnyScore = r1Marks !== null || r2Marks !== null || r3Marks !== null;
  const totalPercentage = Number(((totalScore / (totalMaxMarks || 1)) * 100).toFixed(1));

  if (!scoresPublished) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
            Team Evaluation Scorecard (Total {totalMaxMarks} Marks)
          </Title>
          <Text type="secondary">
            Official scores across Round 1 ({round1MaxMarks}m), Round 2 ({round2MaxMarks}m), and Round 3 ({round3MaxMarks}m)
          </Text>
        </div>

        <Card bordered={false} style={{ borderRadius: 14, textAlign: 'center', padding: '32px 16px' }}>
          <LockOutlined style={{ fontSize: '48px', color: '#fa8c16', marginBottom: 16 }} />
          <Title level={3} style={{ color: '#1e293b' }}>
            Scores Evaluation in Progress
          </Title>
          <Paragraph type="secondary" style={{ maxWidth: 500, margin: '0 auto 16px', fontSize: '14px' }}>
            Official evaluation marks and feedback are currently being finalized by the judging committee. Scorecards will become visible once officially published.
          </Paragraph>
          <Tag color="orange" style={{ padding: '4px 12px', fontSize: '13px', borderRadius: 6 }}>
            PENDING JUDGES PUBLICATION
          </Tag>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          My Performance & Scorecard (Total {totalMaxMarks} Marks)
        </Title>
        <Text type="secondary">
          Official evaluation marks awarded across Round 1 ({round1MaxMarks}m), Round 2 ({round2MaxMarks}m), and Round 3 ({round3MaxMarks}m)
        </Text>
      </div>

      {/* Main Scorecard Header */}
      <Card
        bordered={false}
        style={{
          borderRadius: 14,
          marginBottom: 24,
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}
        bodyStyle={{ padding: 28 }}
      >
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} md={12}>
            <Tag color="cyan" style={{ fontWeight: 700, marginBottom: 8 }}>
              OFFICIAL TEAM EVALUATION
            </Tag>
            <Title level={3} style={{ color: '#fff', margin: '4px 0' }}>
              {user?.displayName || teamId}
            </Title>
            <Text style={{ color: '#94a3b8' }}>Team ID: {teamId}</Text>

            <div style={{ marginTop: 20 }}>
              <Text style={{ color: '#94a3b8', fontSize: '13px' }}>Overall Completion Percentage</Text>
              <div style={{ marginTop: 6 }}>
                <Progress
                  percent={hasAnyScore ? totalPercentage : 0}
                  strokeColor="#38bdf8"
                  trailColor="rgba(255,255,255,0.15)"
                />
              </div>
            </div>
          </Col>

          <Col xs={24} md={12}>
            <div style={{ background: 'rgba(255,255,255,0.06)', padding: 20, borderRadius: 12, textAlign: 'center' }}>
              <Text style={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '12px' }}>
                Total Points Earned
              </Text>
              <div style={{ fontSize: '48px', fontWeight: 900, color: '#38bdf8', lineHeight: 1.2, margin: '8px 0' }}>
                {hasAnyScore ? totalScore : '—'} <span style={{ fontSize: '20px', color: '#94a3b8' }}>/ {totalMaxMarks}</span>
              </div>
              <Tag color="blue" style={{ fontSize: '13px', padding: '2px 10px', borderRadius: 4 }}>
                {hasAnyScore ? `${totalPercentage}% Aggregate` : 'Evaluation in Progress'}
              </Tag>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Round-by-Round Breakdown */}
      <Title level={4} style={{ marginBottom: 16 }}>
        Round-by-Round Evaluation Breakdown
      </Title>

      <Row gutter={[20, 20]}>
        {/* Round 1 */}
        <Col xs={24} md={8}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Round 1: Architecture & Flow</span>
                <Tag color="cyan">Max {round1MaxMarks} Marks</Tag>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <div style={{ fontSize: '32px', fontWeight: 800, color: r1Marks !== null ? '#08979c' : '#8c8c8c' }}>
                {r1Marks !== null ? r1Marks : '—'} <span style={{ fontSize: '14px', color: '#8c8c8c' }}>/ {round1MaxMarks}</span>
              </div>
              <Tag color={r1Marks !== null ? 'green' : 'default'} style={{ marginTop: 6 }}>
                {r1Marks !== null ? 'EVALUATION FINALIZED' : 'PENDING EVALUATION'}
              </Tag>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            {r1Score?.feedback ? (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: '13px' }}>
                <Space style={{ marginBottom: 4 }}>
                  <MessageOutlined style={{ color: '#1677ff' }} />
                  <Text strong>Judges Feedback:</Text>
                </Space>
                <Paragraph style={{ margin: 0, color: '#475569' }}>
                  {r1Score.feedback}
                </Paragraph>
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: '12px' }}>Feedback will appear once evaluated.</Text>
            )}
          </Card>
        </Col>

        {/* Round 2 */}
        <Col xs={24} md={8}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Round 2: PPT Presentation</span>
                <Tag color="geekblue">Max {round2MaxMarks} Marks</Tag>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <div style={{ fontSize: '32px', fontWeight: 800, color: r2Marks !== null ? '#1d39c4' : '#8c8c8c' }}>
                {r2Marks !== null ? r2Marks : '—'} <span style={{ fontSize: '14px', color: '#8c8c8c' }}>/ {round2MaxMarks}</span>
              </div>
              <Tag color={r2Marks !== null ? 'green' : 'default'} style={{ marginTop: 6 }}>
                {r2Marks !== null ? 'EVALUATION FINALIZED' : 'PENDING EVALUATION'}
              </Tag>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            {r2Score?.feedback ? (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: '13px' }}>
                <Space style={{ marginBottom: 4 }}>
                  <MessageOutlined style={{ color: '#1677ff' }} />
                  <Text strong>Judges Feedback:</Text>
                </Space>
                <Paragraph style={{ margin: 0, color: '#475569' }}>
                  {r2Score.feedback}
                </Paragraph>
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: '12px' }}>Feedback will appear once evaluated.</Text>
            )}
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
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <div style={{ fontSize: '32px', fontWeight: 800, color: r3Marks !== null ? '#531dab' : '#8c8c8c' }}>
                {r3Marks !== null ? r3Marks : '—'} <span style={{ fontSize: '14px', color: '#8c8c8c' }}>/ {round3MaxMarks}</span>
              </div>
              <Tag color={r3Marks !== null ? 'green' : 'default'} style={{ marginTop: 6 }}>
                {r3Marks !== null ? 'EVALUATION FINALIZED' : 'PENDING EVALUATION'}
              </Tag>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            {r3Score?.feedback ? (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: '13px' }}>
                <Space style={{ marginBottom: 4 }}>
                  <MessageOutlined style={{ color: '#1677ff' }} />
                  <Text strong>Judges Feedback:</Text>
                </Space>
                <Paragraph style={{ margin: 0, color: '#475569' }}>
                  {r3Score.feedback}
                </Paragraph>
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: '12px' }}>Feedback will appear once evaluated.</Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};
