import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  Progress,
  Button,
  Table,
  Space,
  Modal,
  Tag,
  Divider,
  Empty,
} from 'antd';
import {
  TeamOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  UserAddOutlined,
  UploadOutlined,
  TrophyOutlined,
  StopOutlined,
  ArrowRightOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { subscribeToTeams } from '../../services/accounts.service';
import { subscribeToRounds, stopRound, startRound } from '../../services/rounds.service';
import { subscribeToAllSubmissions } from '../../services/submissions.service';
import { subscribeToAllScores } from '../../services/scores.service';
import { subscribeToAllSelections } from '../../services/selection.service';
import { Team, Round, Submission, Score, TeamSelection } from '../../types';
import { CountdownTimer } from '../../components/common/CountdownTimer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatISTDateTime, formatISTFromNow, formatISTScheduleRange, calculateDurationFormatted } from '../../utils/date';
import { AddTeamModal } from '../../components/admin/AddTeamModal';
import { useScoring } from '../../contexts/ScoringContext';

const { Title, Text, Paragraph } = Typography;

export const AdminDashboard: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [selections, setSelections] = useState<TeamSelection[]>([]);
  const [isAddTeamModalOpen, setIsAddTeamModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();

  const { totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();

  useEffect(() => {
    const unsubTeams = subscribeToTeams(setTeams);
    const unsubRounds = subscribeToRounds(setRounds);
    const unsubSubs = subscribeToAllSubmissions(setSubmissions);
    const unsubScores = subscribeToAllScores(setScores);
    const unsubSelections = subscribeToAllSelections(setSelections);

    return () => {
      unsubTeams();
      unsubRounds();
      unsubSubs();
      unsubScores();
      unsubSelections();
    };
  }, []);

  const totalTeams = teams.length;
  const liveActiveRound = rounds.find((r) => r?.status === 'ACTIVE' || r?.status === 'LIVE') || null;
  const nextScheduledRound = rounds.find((r) => r?.status === 'SCHEDULED' || r?.status === 'UPCOMING' || r?.status === 'NOT_STARTED') || rounds[0] || null;
  const displayRound = liveActiveRound || nextScheduledRound;

  const round1Subs = submissions.filter((s) => s?.roundId?.includes('1')).length;
  const round2Subs = submissions.filter((s) => s?.roundId?.includes('2')).length;
  const round3Subs = submissions.filter((s) => s?.roundId?.includes('3')).length;

  const selectedTeamsCount = selections.filter((s) => s?.status === 'SELECTED').length;
  const evaluatedScoresCount = scores.length;
  const totalSubmissionsCount = submissions.length;

  const recentSubmissions = submissions.slice(0, 6);

  const columns = [
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700 }}>{id || '—'}</Tag>,
    },
    {
      title: 'Team Name',
      dataIndex: 'teamName',
      key: 'teamName',
      render: (name: string) => <Text strong>{name || '—'}</Text>,
    },
    {
      title: 'Round',
      dataIndex: 'roundId',
      key: 'roundId',
      render: (r: string) => (
        <Tag color={r?.includes('1') ? 'cyan' : r?.includes('2') ? 'geekblue' : 'purple'}>
          {r?.includes('1')
            ? `Round 1 (${round1MaxMarks}m)`
            : r?.includes('2')
            ? `Round 2 (${round2MaxMarks}m)`
            : `Round 3 (${round3MaxMarks}m)`}
        </Tag>
      ),
    },
    {
      title: 'Submitted At',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      render: (time: any) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: '13px' }}>{formatISTDateTime(time)}</Text>
          <Text type="secondary" style={{ fontSize: '11px' }}>{formatISTFromNow(time)}</Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (st: string) => <StatusBadge status={st || 'SUBMITTED'} />,
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: any) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => navigate('/admin/submissions')}
        >
          Review & Grade
        </Button>
      ),
    },
  ];

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
            Hackathon Executive Overview
          </Title>
          <Text type="secondary">
            Centralized orchestration: Real-time Submissions, Storage & {totalMaxMarks}-Mark Manual Scoring Console
          </Text>
        </div>

        <Space wrap>
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => setIsAddTeamModalOpen(true)}
            style={{ borderRadius: 8, background: '#1677ff', fontWeight: 600 }}
          >
            ADD TEAM
          </Button>
          <Button
            icon={<ArrowRightOutlined />}
            onClick={() => navigate('/admin/teams')}
            style={{ borderRadius: 8 }}
          >
            Manage Teams ({totalTeams})
          </Button>
        </Space>
      </div>

      {/* Top 4 KPI Metrics */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Provisioned Teams</span>}
              value={totalTeams}
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>Teams</span>}
              prefix={<TeamOutlined style={{ color: '#1677ff', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 12 }}>
              <Progress percent={totalTeams > 0 ? Math.min(100, Math.round((totalTeams / 100) * 100)) : 0} strokeColor="#1677ff" size="small" />
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Submissions Received</span>}
              value={totalSubmissionsCount}
              prefix={<UploadOutlined style={{ color: '#52c41a', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 12, fontSize: '12px', color: '#64748b' }}>
              Across R1 ({round1MaxMarks}m), R2 ({round2MaxMarks}m), R3 ({round3MaxMarks}m)
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Evaluated Grades</span>}
              value={evaluatedScoresCount}
              prefix={<TrophyOutlined style={{ color: '#fa8c16', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 12, fontSize: '12px', color: '#64748b' }}>
              Manual scoring (/{totalMaxMarks} Marks)
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Qualified Selections</span>}
              value={selectedTeamsCount}
              prefix={<CheckCircleOutlined style={{ color: '#722ed1', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 12, fontSize: '12px', color: '#64748b' }}>
              Shortlisted for Final Round
            </div>
          </Card>
        </Col>
      </Row>

      {/* Round-by-Round Submissions Progress */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Round Submission Metrics</span>
            <Tag color="blue">3 Core Competition Rounds</Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Row gutter={[20, 20]}>
          <Col xs={24} md={8}>
            <Card type="inner" title="Round 1 Submissions" extra={<Tag color="cyan">Max {round1MaxMarks} Marks</Tag>}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <Title level={3} style={{ margin: 0, color: '#08979c' }}>
                  {round1Subs} <span style={{ fontSize: '16px', color: '#8c8c8c' }}>/ {totalTeams}</span>
                </Title>
                <Text type="secondary">{totalTeams > 0 ? Math.round((round1Subs / totalTeams) * 100) : 0}%</Text>
              </div>
              <Progress percent={totalTeams > 0 ? Math.round((round1Subs / totalTeams) * 100) : 0} strokeColor="#13c2c2" />
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: 8 }}>
                Architecture diagram & solution PDF
              </div>
            </Card>
          </Col>

          <Col xs={24} md={8}>
            <Card type="inner" title="Round 2 Submissions" extra={<Tag color="geekblue">Max {round2MaxMarks} Marks</Tag>}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <Title level={3} style={{ margin: 0, color: '#1d39c4' }}>
                  {round2Subs} <span style={{ fontSize: '16px', color: '#8c8c8c' }}>/ {totalTeams}</span>
                </Title>
                <Text type="secondary">{totalTeams > 0 ? Math.round((round2Subs / totalTeams) * 100) : 0}%</Text>
              </div>
              <Progress percent={totalTeams > 0 ? Math.round((round2Subs / totalTeams) * 100) : 0} strokeColor="#2f54eb" />
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: 8 }}>
                PPT Presentation slide deck
              </div>
            </Card>
          </Col>

          <Col xs={24} md={8}>
            <Card type="inner" title="Round 3 Submissions" extra={<Tag color="purple">Max {round3MaxMarks} Marks</Tag>}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <Title level={3} style={{ margin: 0, color: '#531dab' }}>
                  {round3Subs} <span style={{ fontSize: '16px', color: '#8c8c8c' }}>/ {totalTeams}</span>
                </Title>
                <Text type="secondary">{totalTeams > 0 ? Math.round((round3Subs / totalTeams) * 100) : 0}%</Text>
              </div>
              <Progress percent={totalTeams > 0 ? Math.round((round3Subs / totalTeams) * 100) : 0} strokeColor="#722ed1" />
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: 8 }}>
                Functional Prototype & GitHub Repository
              </div>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* Active Round Control Widget & Recent Live Submissions */}
      <Row gutter={[20, 20]}>
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined style={{ color: '#1677ff' }} />
                <span>Active Round Status</span>
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/admin/rounds')}>
                Rounds Console
              </Button>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            {displayRound ? (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {liveActiveRound ? 'Currently Live Round' : 'Scheduled Round (Awaiting Start)'}
                  </Text>
                  <Title level={4} style={{ margin: '4px 0 8px', color: '#0f172a' }}>
                    {displayRound.name || `Round ${displayRound.roundNumber || 1}`}
                  </Title>
                  <div style={{ marginTop: 6 }}>
                    {liveActiveRound ? (
                      <StatusBadge status="ACTIVE" />
                    ) : (
                      <StatusBadge status="SCHEDULED" customText="Waiting for Admin to Start" />
                    )}
                  </div>
                </div>

                <div style={{ margin: '16px 0' }}>
                  {liveActiveRound ? (
                    <CountdownTimer
                      endTime={liveActiveRound.endTime}
                      status="ACTIVE"
                      title="Time Remaining (IST)"
                      size="large"
                    />
                  ) : (
                    <div
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: 8,
                        padding: '14px 16px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '12px', textTransform: 'uppercase', fontWeight: 700, color: '#1e40af', letterSpacing: '0.5px' }}>
                        <ClockCircleOutlined style={{ marginRight: 6 }} />
                        Timer: Not Running
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e3a8a', marginTop: 4 }}>
                        Waiting for Admin to Start
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
                        Submissions stay locked until explicitly activated.
                      </div>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    fontSize: '12px',
                    lineHeight: 1.8,
                    marginBottom: 20,
                    background: '#f8fafc',
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ display: 'block', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', color: '#64748b' }}>
                      Configured Schedule:
                    </Text>
                    <Text strong style={{ color: '#334155' }}>
                      {formatISTScheduleRange(displayRound.startTime, displayRound.endTime)}
                    </Text>
                  </div>
                  <div>
                    <Text type="secondary">Configured Duration: </Text>
                    <Text strong>{calculateDurationFormatted(displayRound.startTime, displayRound.endTime)}</Text>
                  </div>
                  <div>
                    <Text type="secondary">Round Max Marks: </Text>
                    <Text strong>
                      {displayRound.maxMarks || (displayRound.id?.includes('1') ? round1MaxMarks : displayRound.id?.includes('2') ? round2MaxMarks : round3MaxMarks)} Marks
                    </Text>
                  </div>
                  {liveActiveRound?.actualStartedAt && (
                    <div>
                      <Text type="secondary">Activated At: </Text>
                      <Text strong style={{ color: '#16a34a' }}>{formatISTDateTime(liveActiveRound.actualStartedAt)}</Text>
                    </div>
                  )}
                </div>

                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {liveActiveRound ? (
                    <Button
                      type="primary"
                      danger
                      block
                      icon={<StopOutlined />}
                      loading={actionLoading}
                      onClick={() => {
                        Modal.confirm({
                          title: `End ${liveActiveRound.name}?`,
                          content: 'Ending this round will immediately close submission uploads across the platform.',
                          okText: 'Confirm End Round',
                          okType: 'danger',
                          centered: true,
                          onOk: async () => {
                            try {
                              setActionLoading(true);
                              await stopRound(liveActiveRound.id);
                            } finally {
                              setActionLoading(false);
                            }
                          },
                        });
                      }}
                      style={{ borderRadius: 8, fontWeight: 600 }}
                    >
                      STOP ACTIVE ROUND
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      block
                      icon={<PlayCircleOutlined />}
                      loading={actionLoading}
                      onClick={() => {
                        Modal.confirm({
                          title: `Start ${displayRound.name}?`,
                          content: `Are you sure you want to activate ${displayRound.name}? User uploads will open immediately and live countdown will begin.`,
                          okText: 'Confirm Start Round',
                          okButtonProps: { style: { background: '#16a34a', borderColor: '#16a34a' } },
                          centered: true,
                          onOk: async () => {
                            try {
                              setActionLoading(true);
                              await startRound(displayRound.id);
                            } finally {
                              setActionLoading(false);
                            }
                          },
                        });
                      }}
                      style={{ borderRadius: 8, background: '#16a34a', borderColor: '#16a34a', fontWeight: 600 }}
                    >
                      START ROUND NOW
                    </Button>
                  )}
                  <Button
                    block
                    onClick={() => navigate('/admin/rounds')}
                    style={{ borderRadius: 8 }}
                  >
                    Manage Rounds & Schedules
                  </Button>
                </Space>
              </div>
            ) : (
              <Empty description="No competition round found." style={{ padding: '24px 0' }} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <UploadOutlined style={{ color: '#1677ff' }} />
                  <span>Recent Submissions Stream</span>
                </Space>
                <Button type="link" onClick={() => navigate('/admin/submissions')}>
                  View All Submissions ({submissions.length})
                </Button>
              </div>
            }
            bordered={false}
            style={{ borderRadius: 12, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            {recentSubmissions.length === 0 ? (
              <Empty description="No submissions received yet." style={{ padding: '36px 0' }} />
            ) : (
              <Table
                dataSource={recentSubmissions}
                columns={columns}
                rowKey="id"
                pagination={false}
                size="middle"
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Reusable Add Team Modal */}
      <AddTeamModal
        open={isAddTeamModalOpen}
        onClose={() => setIsAddTeamModalOpen(false)}
      />
    </div>
  );
};
