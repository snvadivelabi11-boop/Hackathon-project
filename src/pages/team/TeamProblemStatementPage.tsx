import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Tag,
  Button,
  Space,
  Row,
  Col,
  Divider,
  Alert,
  Descriptions,
} from 'antd';
import {
  FileTextOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  LockOutlined,
  CodeOutlined,
  BulbOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useScoring } from '../../contexts/ScoringContext';
import { subscribeToTeamAssignment } from '../../services/problems.service';
import { subscribeToTeamProblemAnnouncement } from '../../services/problemAssignment.service';
import { TeamProblemAssignment } from '../../types';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;

export const TeamProblemStatementPage: React.FC = () => {
  const { user } = useAuth();
  const { totalMaxMarks, round1MaxMarks, round2MaxMarks, round3MaxMarks } = useScoring();
  const teamId = user?.teamId || '';
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState<TeamProblemAssignment | null>(null);
  const [announcement, setAnnouncement] = useState<any | null>(null);

  useEffect(() => {
    if (!teamId) return;
    const unsub = subscribeToTeamAssignment(teamId, setAssignment);
    const unsubAnn = subscribeToTeamProblemAnnouncement(teamId, setAnnouncement);
    return () => {
      unsub();
      unsubAnn();
    };
  }, [teamId]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ marginBottom: 8 }}>
          <Tag color="blue" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            OFFICIAL TEAM ASSIGNMENT
          </Tag>
          <Tag color="cyan" style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px' }}>
            {teamId}
          </Tag>
        </Space>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          Assigned Problem Statement
        </Title>
        <Text type="secondary">
          Your team's official challenge assigned by the Hackathon committee for Round 1 ({round1MaxMarks}m), Round 2 ({round2MaxMarks}m), and Round 3 ({round3MaxMarks}m) • Total {totalMaxMarks} Marks
        </Text>
      </div>

      {announcement && announcement.isPublished && (
        <Alert
          message={
            <Space>
              <ThunderboltOutlined style={{ color: '#7c3aed', fontSize: '18px' }} />
              <span style={{ fontWeight: 800, fontSize: '15px', color: '#5b21b6' }}>
                Official Problem Statement Assignment Announcement
              </span>
            </Space>
          }
          description={
            <div style={{ marginTop: 6, fontSize: '14px', color: '#334155' }}>
              <div>{announcement.announcementText}</div>
              <div style={{ marginTop: 4, fontSize: '12px', color: '#64748b' }}>
                Announced by Hackathon Administration • {formatISTDateTime(announcement.announcedAt)}
              </div>
            </div>
          }
          type="info"
          showIcon={false}
          style={{
            marginBottom: 24,
            borderRadius: 12,
            border: '1px solid #ddd6fe',
            background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
            padding: '16px 20px',
          }}
        />
      )}

      {assignment && assignment.status === 'PUBLISHED' ? (
        <div>
          {/* Main Statement Card */}
          <Card
            bordered={false}
            style={{
              borderRadius: 14,
              marginBottom: 24,
              boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}
          >
            <div style={{ background: '#f0f5ff', padding: '20px 24px', margin: '-24px -24px 24px -24px', borderBottom: '1px solid #d6e4ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <Space size="middle">
                  <Tag color="blue" style={{ fontSize: '16px', fontWeight: 800, padding: '4px 14px' }}>
                    {assignment.problemSequence ? `Problem #${assignment.problemSequence}` : assignment.statementId}
                  </Tag>
                  <Title level={3} style={{ margin: 0, color: '#1d39c4', fontWeight: 800 }}>
                    {assignment.statementTitle}
                  </Title>
                </Space>
                <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontWeight: 700, padding: '4px 10px' }}>
                  PUBLISHED & ACTIVE
                </Tag>
              </div>
            </div>

            <Title level={4} style={{ color: '#0f172a', marginBottom: 12 }}>
              Challenge Overview & Problem Context
            </Title>
            <Paragraph style={{ fontSize: '15px', lineHeight: 1.8, color: '#334155', whiteSpace: 'pre-line' }}>
              {assignment.description}
            </Paragraph>

            {/* Technical Guidelines */}
            {(assignment.technicalGuidelines || (assignment.instructions && assignment.instructions.length > 0)) && (
              <div style={{ marginTop: 20 }}>
                <Divider style={{ margin: '20px 0' }} />
                <Title level={5} style={{ color: '#0f172a', marginBottom: 10 }}>
                  <CodeOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                  Technical Architecture Guidelines & Evaluation Focus
                </Title>
                {assignment.technicalGuidelines ? (
                  <Paragraph style={{ fontSize: '14px', lineHeight: 1.8, color: '#475569', whiteSpace: 'pre-line' }}>
                    {assignment.technicalGuidelines}
                  </Paragraph>
                ) : (
                  <ul style={{ paddingLeft: 20, fontSize: '14px', lineHeight: 2, color: '#475569' }}>
                    {assignment.instructions?.map((inst, idx) => (
                      <li key={idx}>{inst}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Constraints */}
            {assignment.constraints && (
              <div style={{ marginTop: 20 }}>
                <Divider style={{ margin: '20px 0' }} />
                <Title level={5} style={{ color: '#0f172a', marginBottom: 10 }}>
                  <SafetyCertificateOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
                  System Constraints & Limitations
                </Title>
                <Paragraph style={{ fontSize: '14px', lineHeight: 1.8, color: '#475569', whiteSpace: 'pre-line' }}>
                  {assignment.constraints}
                </Paragraph>
              </div>
            )}

            {/* Expected Outcome */}
            {assignment.expectedOutcome && (
              <div style={{ marginTop: 20 }}>
                <Divider style={{ margin: '20px 0' }} />
                <Title level={5} style={{ color: '#0f172a', marginBottom: 10 }}>
                  <ThunderboltOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                  Expected Deliverables & Outcomes
                </Title>
                <Paragraph style={{ fontSize: '14px', lineHeight: 1.8, color: '#475569', whiteSpace: 'pre-line' }}>
                  {assignment.expectedOutcome}
                </Paragraph>
              </div>
            )}

            {/* Examples & Sample Use Cases */}
            {assignment.examples && (
              <div style={{ marginTop: 20 }}>
                <Divider style={{ margin: '20px 0' }} />
                <Title level={5} style={{ color: '#0f172a', marginBottom: 10 }}>
                  <BulbOutlined style={{ color: '#722ed1', marginRight: 8 }} />
                  Examples & Sample Use Cases
                </Title>
                <Paragraph style={{ fontSize: '14px', lineHeight: 1.8, color: '#475569', whiteSpace: 'pre-line' }}>
                  {assignment.examples}
                </Paragraph>
              </div>
            )}

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Assigned to: <Text strong>{user?.displayName || teamId}</Text> • Assigned at: {formatISTDateTime(assignment.assignedAt)}
                </Text>
              </div>

              <Button
                type="primary"
                size="large"
                icon={<ArrowRightOutlined />}
                onClick={() => navigate('/team/round1')}
                style={{ borderRadius: 8, background: '#1677ff', fontWeight: 600 }}
              >
                Proceed to Round 1 Submission ({round1MaxMarks} Marks)
              </Button>
            </div>
          </Card>

          {/* Submission Roadmap Callout */}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" title="Round 1: Architecture & Flow" extra={<Tag color="cyan">Max {round1MaxMarks} Marks</Tag>} style={{ borderRadius: 10 }}>
                <Text style={{ fontSize: '13px', color: '#64748b' }}>
                  Submit modular architecture and system flow pipeline addressing {assignment.statementTitle}.
                </Text>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="Round 2: PPT Presentation" extra={<Tag color="geekblue">Max {round2MaxMarks} Marks</Tag>} style={{ borderRadius: 10 }}>
                <Text style={{ fontSize: '13px', color: '#64748b' }}>
                  Present solution architecture and technical depth for {assignment.statementTitle}.
                </Text>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="Round 3: Prototype" extra={<Tag color="purple">Max {round3MaxMarks} Marks</Tag>} style={{ borderRadius: 10 }}>
                <Text style={{ fontSize: '13px', color: '#64748b' }}>
                  Deliver functioning GitHub code and prototype repository for {assignment.statementTitle}.
                </Text>
              </Card>
            </Col>
          </Row>
        </div>
      ) : (
        <Alert
          message="Problem Statement Assignment Pending"
          description="The official problem statement distribution is currently being processed by the administration. Your assigned problem statement will appear here once published."
          type="info"
          showIcon
          icon={<LockOutlined />}
          style={{ borderRadius: 10, padding: 20 }}
        />
      )}
    </div>
  );
};
