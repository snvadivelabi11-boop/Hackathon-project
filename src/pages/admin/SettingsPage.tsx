import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Typography,
  Divider,
  Space,
  Row,
  Col,
  Alert,
  message,
  Select,
  Tag,
  DatePicker,
  TimePicker,
  Radio,
} from 'antd';
import {
  SaveOutlined,
  CloudUploadOutlined,
  SafetyOutlined,
  SettingOutlined,
  TrophyOutlined,
  CalculatorOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { seedInitialFirestoreData } from '../../services/seedFirebase';
import {
  getActiveCloudinaryConfig,
  saveCloudinaryConfig,
  subscribeToCloudinaryConfig,
} from '../../services/submissions.service';
import {
  subscribeToAssignmentConfig,
  saveAssignmentConfig,
  DEFAULT_ASSIGNMENT_CONFIG,
} from '../../services/problemAssignment.service';
import {
  subscribeToTimingConfig,
  saveTimingConfig,
  DEFAULT_TIMING_CONFIG,
  calculateRoundTimingEvaluation,
} from '../../services/timing.service';
import { useScoring } from '../../contexts/ScoringContext';
import { useAuth } from '../../contexts/AuthContext';
import { ProblemAssignmentConfig, HackathonTimingConfig } from '../../types';
import { formatISTDateTime, toIST, parseDateAndTimeToIso } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [savingScoring, setSavingScoring] = useState(false);
  const [savingCloudinary, setSavingCloudinary] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [savingTiming, setSavingTiming] = useState(false);

  const { scoringConfig, updateScoringConfig } = useScoring();
  const [scoringForm] = Form.useForm();
  const [cloudinaryForm] = Form.useForm();
  const [assignmentForm] = Form.useForm();
  const [timingForm] = Form.useForm();

  const [timingConfig, setTimingConfig] = useState<HackathonTimingConfig>(DEFAULT_TIMING_CONFIG);

  // Watch round marks to calculate live total
  const round1Val = Form.useWatch('round1MaxMarks', scoringForm) ?? scoringConfig.round1MaxMarks;
  const round2Val = Form.useWatch('round2MaxMarks', scoringForm) ?? scoringConfig.round2MaxMarks;
  const round3Val = Form.useWatch('round3MaxMarks', scoringForm) ?? scoringConfig.round3MaxMarks;
  const computedTotal = (Number(round1Val) || 0) + (Number(round2Val) || 0) + (Number(round3Val) || 0);

  useEffect(() => {
    scoringForm.setFieldsValue({
      round1MaxMarks: scoringConfig.round1MaxMarks,
      round2MaxMarks: scoringConfig.round2MaxMarks,
      round3MaxMarks: scoringConfig.round3MaxMarks,
      totalMaxMarks: scoringConfig.totalMaxMarks,
    });
  }, [scoringConfig, scoringForm]);

  useEffect(() => {
    const unsubCloud = subscribeToCloudinaryConfig((cfg) => {
      cloudinaryForm.setFieldsValue(cfg);
    });
    const unsubAssign = subscribeToAssignmentConfig((cfg) => {
      assignmentForm.setFieldsValue({
        assignmentMode: cfg.assignmentMode || 'batch_alternating',
        batchSize: cfg.batchSize || 10,
        batchStartTeamNumbers: cfg.batchStartTeamNumbers?.join(', ') || '1, 21, 41, 61, 81',
      });
    });
    const unsubTiming = subscribeToTimingConfig((cfg) => {
      setTimingConfig(cfg);
      timingForm.setFieldsValue({
        hackathonStartDate: cfg.hackathonStartDate,
        hackathonStartTime: cfg.hackathonStartTime,
        hackathonEndDate: cfg.hackathonEndDate,
        hackathonEndTime: cfg.hackathonEndTime,
        r1StartDate: cfg.round1?.startDate || cfg.hackathonStartDate,
        r1StartTime: cfg.round1?.startTime || '09:00',
        r1EndDate: cfg.round1?.endDate || cfg.hackathonEndDate,
        r1EndTime: cfg.round1?.endTime || '18:00',
        r1Override: cfg.round1?.statusOverride || 'AUTO',
        r2StartDate: cfg.round2?.startDate || cfg.hackathonStartDate,
        r2StartTime: cfg.round2?.startTime || '09:00',
        r2EndDate: cfg.round2?.endDate || cfg.hackathonEndDate,
        r2EndTime: cfg.round2?.endTime || '18:00',
        r2Override: cfg.round2?.statusOverride || 'AUTO',
        r3StartDate: cfg.round3?.startDate || cfg.hackathonStartDate,
        r3StartTime: cfg.round3?.startTime || '09:00',
        r3EndDate: cfg.round3?.endDate || cfg.hackathonEndDate,
        r3EndTime: cfg.round3?.endTime || '18:00',
        r3Override: cfg.round3?.statusOverride || 'AUTO',
      });
    });

    return () => {
      unsubCloud();
      unsubAssign();
      unsubTiming();
    };
  }, [cloudinaryForm, assignmentForm, timingForm]);

  const handleSaveScoringConfig = async (values: any) => {
    setSavingScoring(true);
    try {
      const r1 = Number(values.round1MaxMarks);
      const r2 = Number(values.round2MaxMarks);
      const r3 = Number(values.round3MaxMarks);
      const total = Number(values.totalMaxMarks || computedTotal);

      if (r1 + r2 + r3 !== total) {
        throw new Error(
          `Total marks must equal the sum of all round maximum marks (${r1} + ${r2} + ${r3} = ${r1 + r2 + r3}).`
        );
      }

      await updateScoringConfig({
        round1MaxMarks: r1,
        round2MaxMarks: r2,
        round3MaxMarks: r3,
        totalMaxMarks: total,
      });

      message.success(
        `Scoring configuration saved! Round 1 = ${r1}m, Round 2 = ${r2}m, Round 3 = ${r3}m (Total = ${total} Marks).`
      );
    } catch (err: any) {
      message.error(err.message || 'Failed to save scoring configuration.');
    } finally {
      setSavingScoring(false);
    }
  };

  const handleSaveTimingConfig = async (values: any) => {
    setSavingTiming(true);
    try {
      const makeIso = (dateStr: string, timeStr: string) => {
        return parseDateAndTimeToIso(dateStr, timeStr);
      };

      const startIso = makeIso(values.hackathonStartDate, values.hackathonStartTime || '09:00');
      const endIso = makeIso(values.hackathonEndDate, values.hackathonEndTime || '18:00');

      const r1StartIso = makeIso(values.r1StartDate, values.r1StartTime || '09:00');
      const r1EndIso = makeIso(values.r1EndDate, values.r1EndTime || '18:00');

      const r2StartIso = makeIso(values.r2StartDate, values.r2StartTime || '09:00');
      const r2EndIso = makeIso(values.r2EndDate, values.r2EndTime || '18:00');

      const r3StartIso = makeIso(values.r3StartDate, values.r3StartTime || '09:00');
      const r3EndIso = makeIso(values.r3EndDate, values.r3EndTime || '18:00');

      const updatedConfig: HackathonTimingConfig = {
        hackathonStartDate: values.hackathonStartDate,
        hackathonStartTime: values.hackathonStartTime || '09:00',
        hackathonEndDate: values.hackathonEndDate,
        hackathonEndTime: values.hackathonEndTime || '18:00',
        hackathonStartIso: startIso,
        hackathonEndIso: endIso,
        timezone: 'Asia/Kolkata',
        round1: {
          startDate: values.r1StartDate,
          startTime: values.r1StartTime || '09:00',
          endDate: values.r1EndDate,
          endTime: values.r1EndTime || '18:00',
          startIso: r1StartIso,
          endIso: r1EndIso,
          statusOverride: values.r1Override || 'AUTO',
        },
        round2: {
          startDate: values.r2StartDate,
          startTime: values.r2StartTime || '09:00',
          endDate: values.r2EndDate,
          endTime: values.r2EndTime || '18:00',
          startIso: r2StartIso,
          endIso: r2EndIso,
          statusOverride: values.r2Override || 'AUTO',
        },
        round3: {
          startDate: values.r3StartDate,
          startTime: values.r3StartTime || '09:00',
          endDate: values.r3EndDate,
          endTime: values.r3EndTime || '18:00',
          startIso: r3StartIso,
          endIso: r3EndIso,
          statusOverride: values.r3Override || 'AUTO',
        },
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || user?.uid || 'admin',
      };

      await saveTimingConfig(updatedConfig, { uid: user?.uid, email: user?.email });
      message.success('Global Hackathon timing windows saved and synchronized to all rounds!');
    } catch (err: any) {
      message.error(err.message || 'Failed to save timing configuration.');
    } finally {
      setSavingTiming(false);
    }
  };

  const applyPresetDates = (daysCount: number, sameForAllRounds: boolean = true) => {
    const base = toIST();
    const startDay = base.format('YYYY-MM-DD');
    const endDay = base.add(daysCount, 'day').format('YYYY-MM-DD');

    const fields: any = {
      hackathonStartDate: startDay,
      hackathonStartTime: '09:00',
      hackathonEndDate: endDay,
      hackathonEndTime: '18:00',
      r1StartDate: startDay,
      r1StartTime: '09:00',
      r1EndDate: endDay,
      r1EndTime: '18:00',
      r1Override: 'AUTO',
      r2StartDate: startDay,
      r2StartTime: '09:00',
      r2EndDate: endDay,
      r2EndTime: '18:00',
      r2Override: 'AUTO',
      r3StartDate: startDay,
      r3StartTime: '09:00',
      r3EndDate: endDay,
      r3EndTime: '18:00',
      r3Override: 'AUTO',
    };

    if (!sameForAllRounds) {
      // Sequential days
      fields.r1StartDate = startDay;
      fields.r1EndDate = base.add(1, 'day').format('YYYY-MM-DD');
      fields.r2StartDate = base.add(1, 'day').format('YYYY-MM-DD');
      fields.r2EndDate = base.add(3, 'day').format('YYYY-MM-DD');
      fields.r3StartDate = base.add(3, 'day').format('YYYY-MM-DD');
      fields.r3EndDate = endDay;
    }

    timingForm.setFieldsValue(fields);
    message.info(`Applied ${daysCount}-Day preset schedule. Click "Save Timing Schedule" to commit.`);
  };

  const handleSaveAssignmentConfig = async (values: any) => {
    setSavingAssignment(true);
    try {
      const starts = values.batchStartTeamNumbers
        .split(',')
        .map((s: string) => Number(s.trim()))
        .filter((n: number) => !isNaN(n) && n > 0);

      await saveAssignmentConfig(
        {
          assignmentMode: values.assignmentMode,
          batchSize: Number(values.batchSize),
          batchStartTeamNumbers: starts,
        },
        user?.email || 'admin'
      );

      message.success('Team problem assignment strategy saved to Firestore!');
    } catch (err: any) {
      message.error(err.message || 'Failed to save assignment strategy.');
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleSaveCloudinary = async (values: any) => {
    setSavingCloudinary(true);
    try {
      await saveCloudinaryConfig({
        cloudName: values.cloudName.trim(),
        uploadPreset: values.uploadPreset.trim(),
      });
      message.success('Cloudinary upload configuration saved to Firestore!');
    } catch (err: any) {
      message.error(err.message || 'Failed to save Cloudinary configuration.');
    } finally {
      setSavingCloudinary(false);
    }
  };

  const handleSeedDatabase = async () => {
    setLoadingSeed(true);
    try {
      const res = await seedInitialFirestoreData();
      message.success(res.message);
    } catch (err: any) {
      message.error(err.message || 'Failed to initialize database.');
    } finally {
      setLoadingSeed(false);
    }
  };

  // Live evaluation badges
  const r1Eval = calculateRoundTimingEvaluation('round1', timingConfig);
  const r2Eval = calculateRoundTimingEvaluation('round2', timingConfig);
  const r3Eval = calculateRoundTimingEvaluation('round3', timingConfig);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
          System Settings & Dynamic Configuration
        </Title>
        <Text type="secondary">
          Configure centralized round timing windows, dynamic scoring bounds, team problem distribution, and storage credentials
        </Text>
      </div>

      {/* 1. Global Hackathon Timing & Round Windows */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Space>
              <ClockCircleOutlined style={{ color: '#059669', fontSize: 18 }} />
              <span style={{ fontWeight: 700 }}>Centralized Hackathon Timing & Round Windows</span>
            </Space>
            <Space>
              <Tag color={r1Eval.badgeColor}>R1: {r1Eval.state}</Tag>
              <Tag color={r2Eval.badgeColor}>R2: {r2Eval.state}</Tag>
              <Tag color={r3Eval.badgeColor}>R3: {r3Eval.state}</Tag>
            </Space>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Alert
          message="Authoritative Round Timing Control"
          description="All dates and times configured below are saved to Firebase and enforced by both the server security layer and client dashboards. A round automatically progresses: UPCOMING (before start) → ACTIVE (during window) → ENDED (after deadline)."
          type="info"
          showIcon
          style={{ marginBottom: 20, borderRadius: 8 }}
        />

        {/* Presets */}
        <div style={{ marginBottom: 20, background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <Space wrap align="center">
            <Text strong style={{ fontSize: '13px' }}>
              <FieldTimeOutlined /> Quick Timing Presets:
            </Text>
            <Button size="small" onClick={() => applyPresetDates(5, true)}>
              5-Day Simultaneous Window (20th–25th)
            </Button>
            <Button size="small" onClick={() => applyPresetDates(1, true)}>
              24-Hour Sprint
            </Button>
            <Button size="small" onClick={() => applyPresetDates(5, false)}>
              5-Day Sequential Staged Window
            </Button>
          </Space>
        </div>

        <Form
          form={timingForm}
          layout="vertical"
          onFinish={handleSaveTimingConfig}
        >
          {/* Overall Hackathon Event Window */}
          <Card
            type="inner"
            title={<span style={{ fontWeight: 600, color: '#0958d9' }}>Overall Hackathon Event Window</span>}
            style={{ borderRadius: 8, marginBottom: 20, background: '#f0f7ff' }}
          >
            <Row gutter={16}>
              <Col xs={24} sm={12} md={6}>
                <Form.Item
                  name="hackathonStartDate"
                  label="Hackathon Start Date"
                  rules={[{ required: true, message: 'Start date required' }]}
                >
                  <Input type="date" size="large" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Form.Item
                  name="hackathonStartTime"
                  label="Hackathon Start Time"
                  rules={[{ required: true, message: 'Start time required' }]}
                >
                  <Input type="time" size="large" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Form.Item
                  name="hackathonEndDate"
                  label="Hackathon End Date"
                  rules={[{ required: true, message: 'End date required' }]}
                >
                  <Input type="date" size="large" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Form.Item
                  name="hackathonEndTime"
                  label="Hackathon End Time"
                  rules={[{ required: true, message: 'End time required' }]}
                >
                  <Input type="time" size="large" />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          {/* 3 Individual Round Timing Windows */}
          <Row gutter={[16, 16]}>
            {/* Round 1 */}
            <Col xs={24} md={8}>
              <Card
                type="inner"
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#08979c', fontWeight: 600 }}>Round 1 Window</span>
                    <Tag color={r1Eval.badgeColor}>{r1Eval.state}</Tag>
                  </div>
                }
                style={{ borderRadius: 8 }}
              >
                <Form.Item
                  name="r1StartDate"
                  label="Start Date"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  name="r1StartTime"
                  label="Start Time"
                  rules={[{ required: true }]}
                >
                  <Input type="time" />
                </Form.Item>
                <Form.Item
                  name="r1EndDate"
                  label="End Date"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  name="r1EndTime"
                  label="End Time"
                  rules={[{ required: true }]}
                >
                  <Input type="time" />
                </Form.Item>
                <Form.Item
                  name="r1Override"
                  label="Status Override"
                >
                  <Select>
                    <Select.Option value="AUTO">Automatic (By Time Window)</Select.Option>
                    <Select.Option value="LOCKED">Manually Lock Round</Select.Option>
                    <Select.Option value="FORCE_CLOSED">Force End / Close Now</Select.Option>
                  </Select>
                </Form.Item>
              </Card>
            </Col>

            {/* Round 2 */}
            <Col xs={24} md={8}>
              <Card
                type="inner"
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#1d39c4', fontWeight: 600 }}>Round 2 Window</span>
                    <Tag color={r2Eval.badgeColor}>{r2Eval.state}</Tag>
                  </div>
                }
                style={{ borderRadius: 8 }}
              >
                <Form.Item
                  name="r2StartDate"
                  label="Start Date"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  name="r2StartTime"
                  label="Start Time"
                  rules={[{ required: true }]}
                >
                  <Input type="time" />
                </Form.Item>
                <Form.Item
                  name="r2EndDate"
                  label="End Date"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  name="r2EndTime"
                  label="End Time"
                  rules={[{ required: true }]}
                >
                  <Input type="time" />
                </Form.Item>
                <Form.Item
                  name="r2Override"
                  label="Status Override"
                >
                  <Select>
                    <Select.Option value="AUTO">Automatic (By Time Window)</Select.Option>
                    <Select.Option value="LOCKED">Manually Lock Round</Select.Option>
                    <Select.Option value="FORCE_CLOSED">Force End / Close Now</Select.Option>
                  </Select>
                </Form.Item>
              </Card>
            </Col>

            {/* Round 3 */}
            <Col xs={24} md={8}>
              <Card
                type="inner"
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#531dab', fontWeight: 600 }}>Round 3 Window</span>
                    <Tag color={r3Eval.badgeColor}>{r3Eval.state}</Tag>
                  </div>
                }
                style={{ borderRadius: 8 }}
              >
                <Form.Item
                  name="r3StartDate"
                  label="Start Date"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  name="r3StartTime"
                  label="Start Time"
                  rules={[{ required: true }]}
                >
                  <Input type="time" />
                </Form.Item>
                <Form.Item
                  name="r3EndDate"
                  label="End Date"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  name="r3EndTime"
                  label="End Time"
                  rules={[{ required: true }]}
                >
                  <Input type="time" />
                </Form.Item>
                <Form.Item
                  name="r3Override"
                  label="Status Override"
                >
                  <Select>
                    <Select.Option value="AUTO">Automatic (By Time Window)</Select.Option>
                    <Select.Option value="LOCKED">Manually Lock Round</Select.Option>
                    <Select.Option value="FORCE_CLOSED">Force End / Close Now</Select.Option>
                  </Select>
                </Form.Item>
              </Card>
            </Col>
          </Row>

          <Divider style={{ margin: '20px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              loading={savingTiming}
              icon={<SaveOutlined />}
              style={{ borderRadius: 8, background: '#059669', borderColor: '#059669', fontWeight: 600 }}
            >
              Save Timing Schedule & Synchronize Rounds
            </Button>
          </div>
        </Form>
      </Card>

      {/* 2. Dynamic Scoring Configuration Panel */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <TrophyOutlined style={{ color: '#1677ff', fontSize: 18 }} />
              <span style={{ fontWeight: 700 }}>Hackathon Scoring & Dynamic Round Marks Configuration</span>
            </Space>
            <Tag color="blue" style={{ fontWeight: 700 }}>
              Live Score Schema
            </Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Alert
          message="Fully Dynamic Single Source of Truth"
          description="Adjust maximum marks for each round below. When saved, all evaluation bounds, leaderboards, team scorecards, and percentages will immediately update across the entire application."
          type="info"
          showIcon
          style={{ marginBottom: 24, borderRadius: 8 }}
        />

        <Form
          form={scoringForm}
          layout="vertical"
          onFinish={handleSaveScoringConfig}
        >
          <Row gutter={[20, 20]}>
            {/* Round 1 */}
            <Col xs={24} md={8}>
              <Card type="inner" title={<span style={{ color: '#08979c', fontWeight: 600 }}>Round 1 — Architecture & Flow</span>} style={{ borderRadius: 8 }}>
                <Form.Item
                  name="round1MaxMarks"
                  label="Maximum Marks"
                  rules={[
                    { required: true, message: 'Please enter Round 1 marks' },
                    { type: 'number', min: 1, message: 'Must be positive' },
                  ]}
                >
                  <InputNumber min={1} max={500} style={{ width: '100%' }} size="large" addonAfter="Marks" />
                </Form.Item>
              </Card>
            </Col>

            {/* Round 2 */}
            <Col xs={24} md={8}>
              <Card type="inner" title={<span style={{ color: '#1d39c4', fontWeight: 600 }}>Round 2 — Presentation & PPT</span>} style={{ borderRadius: 8 }}>
                <Form.Item
                  name="round2MaxMarks"
                  label="Maximum Marks"
                  rules={[
                    { required: true, message: 'Please enter Round 2 marks' },
                    { type: 'number', min: 1, message: 'Must be positive' },
                  ]}
                >
                  <InputNumber min={1} max={500} style={{ width: '100%' }} size="large" addonAfter="Marks" />
                </Form.Item>
              </Card>
            </Col>

            {/* Round 3 */}
            <Col xs={24} md={8}>
              <Card type="inner" title={<span style={{ color: '#531dab', fontWeight: 600 }}>Round 3 — Prototype & Repo</span>} style={{ borderRadius: 8 }}>
                <Form.Item
                  name="round3MaxMarks"
                  label="Maximum Marks"
                  rules={[
                    { required: true, message: 'Please enter Round 3 marks' },
                    { type: 'number', min: 1, message: 'Must be positive' },
                  ]}
                >
                  <InputNumber min={1} max={500} style={{ width: '100%' }} size="large" addonAfter="Marks" />
                </Form.Item>
              </Card>
            </Col>
          </Row>

          <Divider style={{ margin: '24px 0 16px' }} />

          <Row gutter={16} align="middle" justify="space-between">
            <Col xs={24} sm={12}>
              <Form.Item
                name="totalMaxMarks"
                label={
                  <Space>
                    <CalculatorOutlined style={{ color: '#059669' }} />
                    <Text strong>Total Maximum Marks (Must equal Round 1 + 2 + 3)</Text>
                  </Space>
                }
                rules={[
                  { required: true, message: 'Total marks required' },
                  {
                    validator: async (_, value) => {
                      if (Number(value) !== computedTotal) {
                        return Promise.reject(
                          new Error(`Total marks must equal the sum of all round maximum marks (${computedTotal})`)
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <InputNumber
                  min={1}
                  max={1500}
                  style={{ width: '100%' }}
                  size="large"
                  addonAfter="Total Marks"
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12} style={{ textAlign: 'right', marginTop: 8 }}>
              <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, display: 'inline-block', textAlign: 'left', marginBottom: 16 }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Live Computed Total:</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: computedTotal === Number(scoringForm.getFieldValue('totalMaxMarks')) ? '#059669' : '#d97706' }}>
                  {round1Val || 0} + {round2Val || 0} + {round3Val || 0} = {computedTotal} Marks
                </div>
              </div>
            </Col>
          </Row>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
            <Button
              onClick={() => {
                scoringForm.setFieldsValue({ totalMaxMarks: computedTotal });
              }}
            >
              Auto-Calculate Total ({computedTotal})
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={savingScoring}
              icon={<SaveOutlined />}
              style={{ borderRadius: 8, background: '#1677ff' }}
            >
              Save Scoring Configuration
            </Button>
          </div>
        </Form>
      </Card>

      {/* 3. Team Problem Assignment & Distribution Rules */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <BranchesOutlined style={{ color: '#722ed1', fontSize: 18 }} />
              <span style={{ fontWeight: 700 }}>Team Problem Assignment & Distribution Rules</span>
            </Space>
            <Tag color="purple" style={{ fontWeight: 700 }}>
              Configurable Strategy
            </Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Alert
          message="Configurable Team Assignment Engine"
          description="Define the batch size and starting team numbers. In Batch/Alternating mode: Problems 1–10 assign to Teams 1–10 (TEAM001..010); Problems 11–20 assign to Teams 21–30 (TEAM021..030), etc."
          type="info"
          showIcon
          style={{ marginBottom: 20, borderRadius: 8 }}
        />

        <Form
          form={assignmentForm}
          layout="vertical"
          onFinish={handleSaveAssignmentConfig}
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="assignmentMode"
                label="Assignment Strategy Mode"
                rules={[{ required: true }]}
              >
                <Select size="large">
                  <Select.Option value="batch_alternating">Batch / Alternating (Default)</Select.Option>
                  <Select.Option value="sequential">Strict Sequential (1, 2, 3...)</Select.Option>
                  <Select.Option value="round_robin">Round Robin</Select.Option>
                </Select>
              </Form.Item>
            </Col>

            <Col xs={24} md={8}>
              <Form.Item
                name="batchSize"
                label="Problem Statements Per Batch"
                rules={[{ required: true, message: 'Batch size required' }]}
              >
                <InputNumber min={1} max={50} style={{ width: '100%' }} size="large" addonAfter="Problems" />
              </Form.Item>
            </Col>

            <Col xs={24} md={8}>
              <Form.Item
                name="batchStartTeamNumbers"
                label="Batch Starting Team Numbers"
                rules={[{ required: true, message: 'Starting team numbers required' }]}
                extra="e.g. 1, 21, 41 means Batch 1: TEAM001..010; Batch 2: TEAM021..030"
              >
                <Input placeholder="1, 21, 41, 61, 81" size="large" />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={savingAssignment}
              icon={<SaveOutlined />}
              style={{ borderRadius: 8, background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
            >
              Save Assignment Rules
            </Button>
          </div>
        </Form>
      </Card>

      {/* 4. Cloudinary Upload Configuration */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <SettingOutlined style={{ color: '#1677ff', fontSize: 18 }} />
              <span style={{ fontWeight: 700 }}>Cloudinary Unsigned Upload Configuration</span>
            </Space>
            <Tag color="green" style={{ fontWeight: 700 }}>
              Frontend Direct Uploads
            </Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Alert
          message="Direct Unsigned Browser Uploads"
          description="Teams upload Round 1 (PDF/Image) and Round 2 (PPT/PDF) submissions directly to Cloudinary using an Unsigned Upload Preset. Never expose the API Secret in the frontend."
          type="info"
          showIcon
          style={{ marginBottom: 20, borderRadius: 8 }}
        />

        <Form
          form={cloudinaryForm}
          layout="vertical"
          onFinish={handleSaveCloudinary}
          initialValues={{
            cloudName: 'netohl2a',
            uploadPreset: 'hackathon_uploads',
          }}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="cloudName"
                label="Cloudinary Cloud Name"
                rules={[{ required: true, message: 'Cloud Name is required' }]}
              >
                <Input placeholder="e.g. netohl2a" size="large" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="uploadPreset"
                label="Unsigned Upload Preset Name"
                rules={[{ required: true, message: 'Upload Preset is required' }]}
              >
                <Input placeholder="e.g. hackathon_uploads" size="large" />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={savingCloudinary}
              icon={<SaveOutlined />}
              style={{ borderRadius: 8, background: '#1677ff' }}
            >
              Save Cloudinary Configuration
            </Button>
          </div>
        </Form>
      </Card>

      {/* 5. Database Initialization */}
      <Card
        title={
          <Space>
            <CloudUploadOutlined style={{ color: '#059669', fontSize: 18 }} />
            <span style={{ fontWeight: 700 }}>Database Initialization & Schema Sync</span>
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <Alert
          message="Initialize Firestore Schema"
          description="Click below to seed default Round 1, Round 2, and Round 3 configurations and default scoring settings into your live Cloud Firestore project."
          type="info"
          showIcon
          style={{ marginBottom: 20, borderRadius: 8 }}
        />

        <Button
          type="primary"
          icon={<SafetyOutlined />}
          loading={loadingSeed}
          onClick={handleSeedDatabase}
          style={{ borderRadius: 8, background: '#059669', borderColor: '#059669' }}
        >
          Initialize Default Schema in Firestore
        </Button>
      </Card>
    </div>
  );
};
