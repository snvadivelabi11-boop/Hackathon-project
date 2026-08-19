import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Typography,
  Tag,
  Input,
  Button,
  Space,
  Row,
  Col,
  Result,
  Badge,
} from 'antd';
import {
  CheckCircleOutlined,
  SearchOutlined,
  LoginOutlined,
  TrophyOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { subscribeToPublicSelections } from '../../services/selection.service';
import { useScoring } from '../../contexts/ScoringContext';
import { TeamSelection } from '../../types';

const { Title, Text, Paragraph } = Typography;

export const PublicSelectionPage: React.FC = () => {
  const [publishedSelections, setPublishedSelections] = useState<TeamSelection[]>([]);
  const [search, setSearch] = useState<string>('');
  const navigate = useNavigate();
  const { round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();

  useEffect(() => {
    const unsub = subscribeToPublicSelections(setPublishedSelections);
    return () => unsub();
  }, []);

  const query = (search || '').trim().toLowerCase();
  const filteredTeams = publishedSelections.filter((t) => {
    if (!query) return true;
    const teamId = (t.teamId || '').toLowerCase();
    const teamName = (t.teamName || '').toLowerCase();
    const leaderName = (t.leaderName || '').toLowerCase();
    return teamId.includes(query) || teamName.includes(query) || leaderName.includes(query);
  });

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 60,
      render: (_: any, __: any, index: number) => (
        <Text strong style={{ color: '#8c8c8c' }}>{index + 1}</Text>
      ),
    },
    {
      title: 'Team ID',
      dataIndex: 'teamId',
      key: 'teamId',
      width: 120,
      render: (id: string) => <Tag color="blue" style={{ fontWeight: 700 }}>{id}</Tag>,
    },
    {
      title: 'Qualified Team Name',
      dataIndex: 'teamName',
      key: 'teamName',
      render: (name: string) => (
        <Text strong style={{ fontSize: '15px', color: '#0f172a' }}>{name}</Text>
      ),
    },
    {
      title: 'Team Leader',
      dataIndex: 'leaderName',
      key: 'leaderName',
      render: (leader: string) => <Text>{leader}</Text>,
    },
    {
      title: 'Official Status',
      key: 'status',
      width: 160,
      render: () => (
        <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontWeight: 700, padding: '2px 10px', borderRadius: 4 }}>
          SELECTED / QUALIFIED
        </Tag>
      ),
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Top Navbar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 32,
            background: '#ffffff',
            padding: '16px 24px',
            borderRadius: 12,
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 800,
                fontSize: '20px',
              }}
            >
              H
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '16px', color: '#0f172a', lineHeight: 1.2 }}>
                HackPortal
              </div>
              <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Official Selection Announcement
              </Text>
            </div>
          </div>

          <Button
            type="primary"
            icon={<LoginOutlined />}
            onClick={() => navigate('/login')}
            style={{ borderRadius: 8, background: '#1677ff' }}
          >
            Team Sign In
          </Button>
        </div>

        {/* Hero Banner */}
        <Card
          bordered={false}
          style={{
            borderRadius: 16,
            marginBottom: 28,
            background: 'linear-gradient(135deg, #065f46 0%, #047857 100%)',
            color: '#fff',
            boxShadow: '0 8px 24px rgba(6, 95, 70, 0.2)',
          }}
          bodyStyle={{ padding: '36px 32px' }}
        >
          <div style={{ textAlign: 'center', maxWidth: 700, margin: '0 auto' }}>
            <Tag color="gold" style={{ fontWeight: 800, fontSize: '12px', marginBottom: 12, padding: '2px 10px' }}>
              OFFICIAL HACKATHON STAGE SELECTION
            </Tag>
            <Title level={2} style={{ color: '#fff', margin: '4px 0 12px', fontWeight: 800 }}>
              Qualified Teams Announcement
            </Title>
            <Paragraph style={{ color: 'rgba(255,255,255,0.9)', fontSize: '15px', lineHeight: 1.6, margin: 0 }}>
              The judging committee has completed multi-round evaluations across Architecture ({round1MaxMarks}m), Presentations ({round2MaxMarks}m), and Prototypes ({round3MaxMarks}m). Below are the officially selected qualifying teams.
            </Paragraph>
          </div>
        </Card>

        {/* Qualified Teams Table Card */}
        <Card
          bordered={false}
          style={{
            borderRadius: 14,
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}
        >
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
              <Title level={4} style={{ margin: 0 }}>
                Selected Teams ({publishedSelections.length} Qualified)
              </Title>
              <Text type="secondary" style={{ fontSize: '13px' }}>
                Teams approved by the evaluation committee for the next stage
              </Text>
            </div>

            <Input
              placeholder="Search qualified team or ID..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280, borderRadius: 8 }}
              allowClear
            />
          </div>

          {publishedSelections.length > 0 ? (
            <Table
              dataSource={filteredTeams}
              columns={columns}
              rowKey="teamId"
              pagination={{ pageSize: 15, showSizeChanger: true }}
              size="middle"
            />
          ) : (
            <Result
              icon={<SafetyCertificateOutlined style={{ color: '#d97706' }} />}
              title="Selection Announcement Pending"
              subTitle="The official team selection list has not been published yet. Please check back soon."
            />
          )}
        </Card>
      </div>
    </div>
  );
};
