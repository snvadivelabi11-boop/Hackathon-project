import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Table,
  Typography,
  Tag,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  Input,
  Radio,
} from 'antd';
import {
  TrophyOutlined,
  DownloadOutlined,
  SearchOutlined,
  CrownOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { subscribeToTeams } from '../../services/accounts.service';
import { subscribeToAllScores } from '../../services/scores.service';
import { subscribeToAllSelections } from '../../services/selection.service';
import { Team, Score, TeamSelection, LeaderboardEntry } from '../../types';
import { useScoring } from '../../contexts/ScoringContext';
import { safeString, safeNumber, safeRoundNumber } from '../../utils/normalize';

const { Title, Text } = Typography;

export const ResultsPage: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [selections, setSelections] = useState<TeamSelection[]>([]);
  const [search, setSearch] = useState<string>('');
  const [selectionFilter, setSelectionFilter] = useState<string>('all');

  const { totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();

  useEffect(() => {
    const unsubTeams = subscribeToTeams(setTeams);
    const unsubScores = subscribeToAllScores(setScores);
    const unsubSelections = subscribeToAllSelections(setSelections);

    return () => {
      unsubTeams();
      unsubScores();
      unsubSelections();
    };
  }, []);

  const leaderboard: LeaderboardEntry[] = useMemo(() => {
    const totalPossible = totalMaxMarks || 100;
    const selectionsMap = new Map<string, { status: string; isPublished: boolean }>();
    selections.forEach((d) => {
      selectionsMap.set(d.teamId, {
        status: safeString(d.status || 'NOT_SELECTED'),
        isPublished: Boolean(d.isPublished),
      });
    });

    const teamScoresMap = new Map<string, { round1: number; round2: number; round3: number; total: number }>();
    scores.forEach((s) => {
      const tId = safeString(s.teamId);
      if (!tId) return;
      const current = teamScoresMap.get(tId) || { round1: 0, round2: 0, round3: 0, total: 0 };
      const r = safeRoundNumber(s.round || s.roundId);
      const scoreVal = safeNumber(s.totalMarks || s.adminFinalScore, 0);
      if (r === 1) current.round1 = scoreVal;
      if (r === 2) current.round2 = scoreVal;
      if (r === 3) current.round3 = scoreVal;
      current.total = current.round1 + current.round2 + current.round3;
      teamScoresMap.set(tId, current);
    });

    const entries: LeaderboardEntry[] = [];
    teams.forEach((t) => {
      const teamId = safeString(t.teamId || t.id);
      if (!teamId) return;
      const teamSc = teamScoresMap.get(teamId) || { round1: 0, round2: 0, round3: 0, total: 0 };
      const sel = selectionsMap.get(teamId) || { status: 'NOT_SELECTED', isPublished: false };

      entries.push({
        teamId,
        teamName: safeString(t.teamName || teamId),
        leaderName: safeString(t.leaderName || ''),
        round1Score: teamSc.round1,
        round2Score: teamSc.round2,
        round3Score: teamSc.round3,
        totalScore: teamSc.total,
        percentage: Number(((teamSc.total / totalPossible) * 100).toFixed(1)),
        selectionStatus: sel.status as any,
        isSelectionPublished: sel.isPublished,
        rank: 1,
      });
    });

    // Sort: Total Score DESC -> Round 3 DESC -> Round 2 DESC -> Team ID ASC
    entries.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.round3Score !== a.round3Score) return b.round3Score - a.round3Score;
      if (b.round2Score !== a.round2Score) return b.round2Score - a.round2Score;
      return a.teamId.localeCompare(b.teamId);
    });

    return entries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  }, [teams, scores, selections, totalMaxMarks]);

  const exportCSV = () => {
    const headers = [
      'Rank',
      'Team ID',
      'Team Name',
      'Leader',
      `Round 1 (/${round1MaxMarks})`,
      `Round 2 (/${round2MaxMarks})`,
      `Round 3 (/${round3MaxMarks})`,
      `Total (/${totalMaxMarks})`,
      'Percentage (%)',
      'Selection Status',
    ];
    const rows = leaderboard.map((item) => [
      item.rank,
      item.teamId,
      `"${item.teamName.replace(/"/g, '""')}"`,
      `"${item.leaderName.replace(/"/g, '""')}"`,
      item.round1Score,
      item.round2Score,
      item.round3Score,
      item.totalScore,
      item.percentage,
      item.selectionStatus,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Hackathon_Results_${totalMaxMarks}Marks_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredData = leaderboard.filter((item) => {
    const matchSearch =
      (item.teamId || '').toLowerCase().includes(search.toLowerCase()) ||
      (item.teamName || '').toLowerCase().includes(search.toLowerCase()) ||
      (item.leaderName || '').toLowerCase().includes(search.toLowerCase());

    const matchSelection =
      selectionFilter === 'all' ||
      (selectionFilter === 'selected' && item.selectionStatus === 'SELECTED') ||
      (selectionFilter === 'not_selected' && item.selectionStatus !== 'SELECTED');

    return matchSearch && matchSelection;
  });

  const top1 = leaderboard[0];
  const top2 = leaderboard[1];
  const top3 = leaderboard[2];

  const columns = [
    {
      title: 'Rank',
      dataIndex: 'rank',
      key: 'rank',
      width: 80,
      render: (rank: number) => {
        if (rank === 1) return <Tag color="#faad14" style={{ fontWeight: 800 }}>🥇 1</Tag>;
        if (rank === 2) return <Tag color="#d9d9d9" style={{ fontWeight: 800, color: '#434343' }}>🥈 2</Tag>;
        if (rank === 3) return <Tag color="#d46b08" style={{ fontWeight: 800 }}>🥉 3</Tag>;
        return <Text strong style={{ paddingLeft: 8 }}>#{rank}</Text>;
      },
    },
    {
      title: 'Team Name',
      dataIndex: 'teamName',
      key: 'teamName',
      render: (name: string, record: LeaderboardEntry) => (
        <div>
          <Text strong style={{ fontSize: '14px' }}>{name}</Text>
          <div style={{ fontSize: '12px', color: '#8c8c8c' }}>
            <Tag color="blue" style={{ fontSize: '11px', margin: 0 }}>{record.teamId}</Tag> • {record.leaderName}
          </div>
        </div>
      ),
    },
    {
      title: `Round 1 (Max ${round1MaxMarks})`,
      dataIndex: 'round1Score',
      key: 'round1Score',
      render: (score: number) => <Tag color="cyan">{score} / {round1MaxMarks}</Tag>,
    },
    {
      title: `Round 2 (Max ${round2MaxMarks})`,
      dataIndex: 'round2Score',
      key: 'round2Score',
      render: (score: number) => <Tag color="geekblue">{score} / {round2MaxMarks}</Tag>,
    },
    {
      title: `Round 3 (Max ${round3MaxMarks})`,
      dataIndex: 'round3Score',
      key: 'round3Score',
      render: (score: number) => <Tag color="purple">{score} / {round3MaxMarks}</Tag>,
    },
    {
      title: `Total Score (Max ${totalMaxMarks})`,
      dataIndex: 'totalScore',
      key: 'totalScore',
      render: (score: number) => (
        <Text strong style={{ fontSize: '16px', color: '#1677ff' }}>
          {score} <span style={{ fontSize: '12px', color: '#8c8c8c' }}>/ {totalMaxMarks}</span>
        </Text>
      ),
      sorter: (a: LeaderboardEntry, b: LeaderboardEntry) => a.totalScore - b.totalScore,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'Percentage',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (pct: number) => <Text strong>{pct}%</Text>,
    },
    {
      title: 'Qualification',
      dataIndex: 'selectionStatus',
      key: 'selectionStatus',
      render: (st: string) => (
        <Tag color={st === 'SELECTED' ? 'green' : 'default'} style={{ fontWeight: 600 }}>
          {st === 'SELECTED' ? 'SELECTED' : 'NOT SELECTED'}
        </Tag>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Final Leaderboard & Results (Total {totalMaxMarks} Marks)
        </Title>
        <Text type="secondary">
          Official ranking computed across Round 1 ({round1MaxMarks}m), Round 2 ({round2MaxMarks}m), and Round 3 ({round3MaxMarks}m) with deterministic tie-breaking
        </Text>
      </div>

      {/* Podium Cards for Top 3 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} md={8}>
          <Card
            bordered={false}
            style={{
              borderRadius: 12,
              background: 'linear-gradient(135deg, #fffbe6 0%, #fff1b8 100%)',
              borderColor: '#ffe58f',
              boxShadow: '0 4px 12px rgba(250, 173, 20, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: '32px' }}>🥇</div>
              <div>
                <Tag color="#faad14" style={{ fontWeight: 800 }}>RANK 1 • CHAMPION</Tag>
                <Title level={4} style={{ margin: '4px 0 2px' }}>{top1?.teamName || '—'}</Title>
                <Text type="secondary">{top1?.teamId} • Leader: {top1?.leaderName}</Text>
                <div style={{ marginTop: 8 }}>
                  <Text strong style={{ fontSize: '18px', color: '#d46b08' }}>
                    {top1?.totalScore || 0} / {totalMaxMarks} Marks ({top1?.percentage || 0}%)
                  </Text>
                </div>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card
            bordered={false}
            style={{
              borderRadius: 12,
              background: 'linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: '32px' }}>🥈</div>
              <div>
                <Tag color="#8c8c8c" style={{ fontWeight: 800 }}>RANK 2 • 1ST RUNNER UP</Tag>
                <Title level={4} style={{ margin: '4px 0 2px' }}>{top2?.teamName || '—'}</Title>
                <Text type="secondary">{top2?.teamId} • Leader: {top2?.leaderName}</Text>
                <div style={{ marginTop: 8 }}>
                  <Text strong style={{ fontSize: '18px', color: '#434343' }}>
                    {top2?.totalScore || 0} / {totalMaxMarks} Marks ({top2?.percentage || 0}%)
                  </Text>
                </div>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card
            bordered={false}
            style={{
              borderRadius: 12,
              background: 'linear-gradient(135deg, #fff7e6 0%, #ffd591 100%)',
              boxShadow: '0 4px 12px rgba(212, 107, 8, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: '32px' }}>🥉</div>
              <div>
                <Tag color="#d46b08" style={{ fontWeight: 800 }}>RANK 3 • 2ND RUNNER UP</Tag>
                <Title level={4} style={{ margin: '4px 0 2px' }}>{top3?.teamName || '—'}</Title>
                <Text type="secondary">{top3?.teamId} • Leader: {top3?.leaderName}</Text>
                <div style={{ marginTop: 8 }}>
                  <Text strong style={{ fontSize: '18px', color: '#d46b08' }}>
                    {top3?.totalScore || 0} / {totalMaxMarks} Marks ({top3?.percentage || 0}%)
                  </Text>
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Main Leaderboard Table Card */}
      <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
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
          <Space wrap>
            <Input
              placeholder="Search by Team ID, Name, Leader..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
            <Radio.Group
              value={selectionFilter}
              onChange={(e) => setSelectionFilter(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="all">All Teams</Radio.Button>
              <Radio.Button value="selected">Qualified / Selected Only</Radio.Button>
              <Radio.Button value="not_selected">Not Selected</Radio.Button>
            </Radio.Group>
          </Space>

          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={exportCSV}
            style={{ borderRadius: 8, background: '#1677ff' }}
          >
            Export Leaderboard CSV
          </Button>
        </div>

        <Table
          dataSource={filteredData}
          columns={columns}
          rowKey="teamId"
          pagination={{ pageSize: 15, showSizeChanger: true }}
          size="middle"
        />
      </Card>
    </div>
  );
};
