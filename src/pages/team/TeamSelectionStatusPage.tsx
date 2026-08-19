import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Tag,
  Button,
  Space,
  Row,
  Col,
  Result,
  Alert,
  Statistic,
  Spin,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  TrophyOutlined,
  SafetyCertificateOutlined,
  GlobalOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import {
  subscribeToTeamSelection,
  subscribeToCurrentSelectionState,
  CurrentSelectionState,
} from '../../services/selection.service';
import { subscribeToTeamScores } from '../../services/scores.service';
import { TeamSelection, Score } from '../../types';
import { formatISTDateTime } from '../../utils/date';
import confetti from 'canvas-confetti';

const { Title, Text, Paragraph } = Typography;

export const TeamSelectionStatusPage: React.FC = () => {
  const { user } = useAuth();
  const { totalMaxMarks } = useScoring();
  const teamId = user?.teamId || '';
  const navigate = useNavigate();

  const [selection, setSelection] = useState<TeamSelection | null>(null);
  const [globalState, setGlobalState] = useState<CurrentSelectionState | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubGlobal = subscribeToCurrentSelectionState((state) => {
      setGlobalState(state);
      setLoading(false);
    });

    let unsubSel: (() => void) | null = null;
    let unsubScores: (() => void) | null = null;

    if (teamId) {
      unsubSel = subscribeToTeamSelection(teamId, (data) => {
        setSelection(data);
        if (data?.status === 'SELECTED' && data?.isPublished) {
          confetti({
            particleCount: 90,
            spread: 70,
            origin: { y: 0.6 },
          });
        }
      });
      unsubScores = subscribeToTeamScores(teamId, setScores);
    } else {
      setLoading(false);
    }

    return () => {
      unsubGlobal();
      if (unsubSel) unsubSel();
      if (unsubScores) unsubScores();
    };
  }, [teamId]);

  const totalScore = Number(
    scores.reduce((sum, item) => sum + (Number(item.totalMarks) || 0), 0).toFixed(1)
  );

  const isLive = globalState?.isPublished === true || globalState?.status === 'LIVE' || selection?.isPublished === true;
  const isSelected = selection?.status === 'SELECTED' || (globalState?.selectedTeamIds?.includes(teamId) ?? false);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <Spin size="large" tip="Loading official qualification status..." />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, textAlign: 'center' }}>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Official Selection & Stage Qualification Status
        </Title>
        <Text type="secondary">
          Official qualification outcome issued by the hackathon evaluation committee
        </Text>
      </div>

      {/* Main Result Card */}
      {!isLive ? (
        /* State 1: Selection is not published yet */
        <Card
          bordered={false}
          style={{
            borderRadius: 16,
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            textAlign: 'center',
            padding: '24px 12px',
          }}
        >
          <Result
            icon={<ClockCircleOutlined style={{ color: '#fa8c16', fontSize: 64 }} />}
            title={
              <span style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b' }}>
                Qualification Announcement Pending
              </span>
            }
            subTitle={
              <div style={{ fontSize: '15px', color: '#64748b', maxWidth: 580, margin: '12px auto 0', lineHeight: 1.6 }}>
                The judging panel is currently evaluating final submissions and verifying total scores.
                The official qualified teams list will be published here as soon as judging is finalized.
              </div>
            }
            extra={[
              <Button
                key="scores"
                type="primary"
                icon={<TrophyOutlined />}
                size="large"
                onClick={() => navigate('/team/scores')}
                style={{ borderRadius: 8, background: '#1677ff' }}
              >
                View Your Scorecard ({totalScore} / {totalMaxMarks} Marks)
              </Button>,
              <Button
                key="certs"
                size="large"
                icon={<SafetyCertificateOutlined />}
                onClick={() => navigate('/team/certificates')}
                style={{ borderRadius: 8 }}
              >
                My Certificates
              </Button>,
            ]}
          />
        </Card>
      ) : isSelected ? (
        /* State 2: Selection is Live AND team is SELECTED */
        <Card
          bordered={false}
          style={{
            borderRadius: 16,
            boxShadow: '0 8px 30px rgba(5, 150, 105, 0.12)',
            border: '2px solid #a7f3d0',
            overflow: 'hidden',
          }}
        >
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: '#059669', fontSize: 68 }} />}
            title={
              <span style={{ fontSize: '28px', fontWeight: 800, color: '#065f46' }}>
                🎉 OFFICIALLY QUALIFIED / SELECTED!
              </span>
            }
            subTitle={
              <div style={{ fontSize: '16px', color: '#047857', maxWidth: 640, margin: '12px auto 0', lineHeight: 1.6 }}>
                Outstanding work, <Text strong>{user?.displayName || teamId}</Text>! Based on your final score of{' '}
                <Text strong>{totalScore} / {totalMaxMarks} Marks</Text>, your team has achieved top ranking and has been officially selected for qualification.
              </div>
            }
            extra={[
              <Button
                type="primary"
                key="cert"
                size="large"
                icon={<SafetyCertificateOutlined />}
                onClick={() => navigate('/team/certificates')}
                style={{ background: '#059669', borderColor: '#059669', borderRadius: 8, fontWeight: 700 }}
              >
                Download Team Certificates
              </Button>,
              <Button
                key="scores"
                size="large"
                icon={<TrophyOutlined />}
                onClick={() => navigate('/team/scores')}
                style={{ borderRadius: 8 }}
              >
                View Full Scorecard
              </Button>,
              <Button
                key="public"
                size="large"
                icon={<GlobalOutlined />}
                onClick={() => window.open('/selection', '_blank')}
                style={{ borderRadius: 8 }}
              >
                Public Announcement
              </Button>,
            ]}
          />

          {globalState?.publishedAt && (
            <div style={{ textAlign: 'center', borderTop: '1px solid #d1fae5', paddingTop: 16, marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: '12px', color: '#059669' }}>
                Official Decision Timestamp: {formatISTDateTime(globalState.publishedAt)}
              </Text>
            </div>
          )}
        </Card>
      ) : (
        /* State 3: Selection is Live AND team is NOT SELECTED */
        <Card
          bordered={false}
          style={{
            borderRadius: 16,
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            textAlign: 'center',
            padding: '16px 12px',
          }}
        >
          <Result
            status="info"
            title={
              <span style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                Selection Outcome: NOT SELECTED
              </span>
            }
            subTitle={
              <div style={{ fontSize: '15px', color: '#64748b', maxWidth: 620, margin: '12px auto 0', lineHeight: 1.6 }}>
                Thank you for your active participation, hard work, and engineering contribution in this hackathon.
                Your team achieved <Text strong>{totalScore} / {totalMaxMarks} Marks</Text>. We appreciate your innovation throughout all rounds.
              </div>
            }
            extra={[
              <Button
                key="scores"
                type="primary"
                size="large"
                icon={<TrophyOutlined />}
                onClick={() => navigate('/team/scores')}
                style={{ borderRadius: 8, background: '#1677ff' }}
              >
                View Scorecard Breakdown
              </Button>,
              <Button
                key="certs"
                size="large"
                icon={<SafetyCertificateOutlined />}
                onClick={() => navigate('/team/certificates')}
                style={{ borderRadius: 8 }}
              >
                Download Participation Certificates
              </Button>,
              <Button
                key="public"
                size="large"
                icon={<GlobalOutlined />}
                onClick={() => window.open('/selection', '_blank')}
                style={{ borderRadius: 8 }}
              >
                View Qualified Teams List
              </Button>,
            ]}
          />
        </Card>
      )}
    </div>
  );
};
