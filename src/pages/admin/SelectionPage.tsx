import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Typography,
  Checkbox,
  Button,
  Space,
  Tag,
  Input,
  Statistic,
  Row,
  Col,
  Alert,
  message,
  Popconfirm,
  Badge,
} from 'antd';
import {
  CheckCircleOutlined,
  SearchOutlined,
  GlobalOutlined,
  SaveOutlined,
  ClearOutlined,
  CheckSquareOutlined,
  EyeOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { subscribeToTeams } from '../../services/accounts.service';
import { subscribeToAllScores } from '../../services/scores.service';
import {
  subscribeToAllSelections,
  subscribeToCurrentSelectionState,
  saveTeamSelections,
  setSelectionPublishStatus,
  CurrentSelectionState,
} from '../../services/selection.service';
import { Team, Score, TeamSelection } from '../../types';
import { formatISTDateTime } from '../../utils/date';
import { safeString } from '../../utils/normalize';
import { useScoring } from '../../contexts/ScoringContext';

const { Title, Text, Paragraph } = Typography;

export const SelectionPage: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [selections, setSelections] = useState<TeamSelection[]>([]);
  const [currentState, setCurrentState] = useState<CurrentSelectionState>({
    status: 'DRAFT',
    isPublished: false,
    selectedTeamIds: [],
    totalSelected: 0,
    publishedAt: null,
    updatedAt: null,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const { totalMaxMarks } = useScoring();

  useEffect(() => {
    const unsubTeams = subscribeToTeams(setTeams);
    const unsubScores = subscribeToAllScores(setScores);
    const unsubSelections = subscribeToAllSelections((list) => {
      setSelections(list);
    });
    const unsubCurrent = subscribeToCurrentSelectionState((state) => {
      setCurrentState(state);
      if (state.selectedTeamIds && state.selectedTeamIds.length > 0) {
        setSelectedRowKeys(state.selectedTeamIds);
      }
    });

    return () => {
      unsubTeams();
      unsubScores();
      unsubSelections();
      unsubCurrent();
    };
  }, []);

  const getTeamTotalScore = (teamId: string) => {
    return Number(
      scores
        .filter((s) => safeString(s.teamId) === safeString(teamId))
        .reduce((sum, item) => sum + (Number(item.totalMarks) || 0), 0)
        .toFixed(1)
    );
  };

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(newSelectedRowKeys);
  };

  const handleSelectAll = () => {
    setSelectedRowKeys(teams.map((t) => t.teamId));
  };

  const handleClearAll = () => {
    setSelectedRowKeys([]);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await saveTeamSelections(selectedRowKeys as string[], false);
      message.success(`Selection saved as Draft (${selectedRowKeys.length} teams selected).`);
    } catch (err: any) {
      message.error(err.message || 'Failed to save team selection.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishLive = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select at least one team before publishing selection live.');
      return;
    }

    setPublishing(true);
    try {
      await saveTeamSelections(selectedRowKeys as string[], true);
      message.success(`🎉 Team selection is now LIVE! (${selectedRowKeys.length} teams published)`);
    } catch (err: any) {
      message.error(err.message || 'Failed to publish live selection.');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setPublishing(true);
    try {
      await setSelectionPublishStatus(false);
      message.info('Selection announcement unpublished.');
    } catch (err: any) {
      message.error(err.message || 'Failed to unpublish selection.');
    } finally {
      setPublishing(false);
    }
  };

  const query = (search || '').trim().toLowerCase();
  const filteredTeams = teams.filter((t) => {
    if (!query) return true;
    const teamId = (t.teamId || '').toLowerCase();
    const teamName = (t.teamName || '').toLowerCase();
    const leaderName = (t.leaderName || '').toLowerCase();
    return teamId.includes(query) || teamName.includes(query) || leaderName.includes(query);
  });

  const columns = [
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      width: 110,
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700 }}>{id}</Tag>,
      sorter: (a: Team, b: Team) => a.teamId.localeCompare(b.teamId),
    },
    {
      title: 'Team Name',
      dataIndex: 'teamName',
      key: 'teamName',
      render: (name: string, record: Team) => (
        <div>
          <Text strong style={{ fontSize: '14px' }}>{name}</Text>
          <div style={{ fontSize: '12px', color: '#8c8c8c' }}>Leader: {record.leaderName}</div>
        </div>
      ),
    },
    {
      title: `Score (/${totalMaxMarks})`,
      key: 'score',
      width: 120,
      render: (_: any, record: Team) => {
        const total = getTeamTotalScore(record.teamId);
        return (
          <Tag color="purple" style={{ fontWeight: 700, fontSize: '13px' }}>
            {total} / {totalMaxMarks}
          </Tag>
        );
      },
      sorter: (a: Team, b: Team) => getTeamTotalScore(a.teamId) - getTeamTotalScore(b.teamId),
    },
    {
      title: 'Selection Status',
      key: 'status',
      width: 160,
      render: (_: any, record: Team) => {
        const isSelected = selectedRowKeys.includes(record.teamId);
        return (
          <Tag
            color={isSelected ? 'green' : 'default'}
            style={{ fontWeight: 700, fontSize: '12px', padding: '4px 10px' }}
          >
            {isSelected ? '✓ SELECTED' : 'NOT SELECTED'}
          </Tag>
        );
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: onSelectChange,
  };

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
            Team Selection & Qualification Hub
          </Title>
          <Text type="secondary">
            Select qualified teams based on evaluation scores (/90 Marks) and publish the official qualification live
          </Text>
        </div>

        <Space wrap>
          {currentState.isPublished ? (
            <Popconfirm
              title="Unpublish live selection?"
              description="Teams and public viewers will no longer see the qualified list until republished."
              onConfirm={handleUnpublish}
              okText="Unpublish"
              cancelText="Cancel"
            >
              <Button danger icon={<StopOutlined />} loading={publishing}>
                Unpublish Live Selection
              </Button>
            </Popconfirm>
          ) : null}

          <Button
            icon={<SaveOutlined />}
            onClick={handleSaveDraft}
            loading={saving}
          >
            Save Draft
          </Button>

          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handlePublishLive}
            loading={publishing}
            style={{ background: '#059669', borderColor: '#059669', borderRadius: 8, fontWeight: 700 }}
          >
            Publish Selection Live ({selectedRowKeys.length} Teams)
          </Button>
        </Space>
      </div>

      {/* Top Status Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Live Announcement State"
              value={currentState.isPublished ? 'LIVE / PUBLISHED' : 'DRAFT / UNPUBLISHED'}
              valueStyle={{ color: currentState.isPublished ? '#059669' : '#d97706', fontWeight: 800 }}
              prefix={currentState.isPublished ? <CheckCircleOutlined /> : <StopOutlined />}
            />
            {currentState.publishedAt && (
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
                Published: {formatISTDateTime(currentState.publishedAt)}
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Qualified Teams"
              value={selectedRowKeys.length}
              suffix={`/ ${teams.length} Registered`}
              valueStyle={{ color: '#1677ff', fontWeight: 800 }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12 }}>
            <Statistic
              title="Public Results URL"
              value="/selection"
              valueStyle={{ fontSize: '18px', color: '#7c3aed' }}
              formatter={() => (
                <Button
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => window.open('/selection', '_blank')}
                  style={{ padding: 0, fontSize: '16px', fontWeight: 600 }}
                >
                  View Live Announcement <GlobalOutlined />
                </Button>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* Live State Alert */}
      {currentState.isPublished ? (
        <Alert
          message="Selection is Currently LIVE"
          description={`The judging committee has published ${currentState.totalSelected} qualified teams. All team users and public visitors can now view the official qualification status.`}
          type="success"
          showIcon
          style={{ marginBottom: 20, borderRadius: 10 }}
        />
      ) : (
        <Alert
          message="Selection in DRAFT Mode"
          description="Selections are currently private to administrators. Click 'Publish Selection Live' when final judging is complete."
          type="warning"
          showIcon
          style={{ marginBottom: 20, borderRadius: 10 }}
        />
      )}

      {/* Main Table Card */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Space>
              <CheckSquareOutlined style={{ color: '#1677ff' }} />
              <span>Registered Teams List ({filteredTeams.length})</span>
            </Space>
            <Space>
              <Button size="small" icon={<CheckSquareOutlined />} onClick={handleSelectAll}>
                Select All ({teams.length})
              </Button>
              <Button size="small" icon={<ClearOutlined />} onClick={handleClearAll}>
                Clear All
              </Button>
            </Space>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <div style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search by Team ID, Team Name, or Leader Name..."
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 320 }}
            allowClear
          />
        </div>

        <Table
          rowSelection={rowSelection}
          dataSource={filteredTeams}
          columns={columns}
          rowKey="teamId"
          pagination={{ pageSize: 15 }}
          size="middle"
        />
      </Card>
    </div>
  );
};
