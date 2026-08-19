import React, { useState, useEffect } from 'react';
import {
  Typography,
  Row,
  Col,
  Card,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  message,
  Statistic,
  Alert,
  Tooltip,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  EditOutlined,
  FieldTimeOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LockOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  subscribeToRounds,
  startRound,
  stopRound,
  saveRoundSchedule,
  resetRoundState,
  subscribeToTimingConfig,
} from '../../services/rounds.service';
import { Round, HackathonTimingConfig } from '../../types';
import {
  formatISTDateTime,
  formatISTScheduleRange,
  formatISTTime,
  calculateDurationFormatted,
  parseDateAndTimeToIso,
  toIST,
} from '../../utils/date';
import {
  calculateLiveRoundTiming,
  formatRemainingSecondsDetailed,
} from '../../services/timing.service';
import { Schedule12HourPicker, ScheduleValues } from '../../components/admin/Schedule12HourPicker';

const { Title, Text, Paragraph } = Typography;

export const RoundsPage: React.FC = () => {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [timingConfig, setTimingConfig] = useState<HackathonTimingConfig | null>(null);
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({});

  // Active / selected round for modals
  const [selectedRound, setSelectedRound] = useState<Round | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Track inline schedule inputs per round
  const [inlineSchedules, setInlineSchedules] = useState<Record<string, ScheduleValues>>({});

  // Modal schedule state
  const [modalSchedule, setModalSchedule] = useState<ScheduleValues>({
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
  });

  // Ticking state for live countdown display
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubRounds = subscribeToRounds((rList) => {
      setRounds(rList);
      setInlineSchedules((prev) => {
        const next = { ...prev };
        rList.forEach((r) => {
          if (!next[r.id]) {
            const sM = toIST(r.startTime || r.scheduledStartAt);
            const eM = toIST(r.endTime || r.scheduledEndAt);
            next[r.id] = {
              startDate: sM.format('YYYY-MM-DD'),
              startTime: sM.format('h:mm A'),
              endDate: eM.format('YYYY-MM-DD'),
              endTime: eM.format('h:mm A'),
            };
          }
        });
        return next;
      });
    });

    const unsubTiming = subscribeToTimingConfig(setTimingConfig);
    return () => {
      unsubRounds();
      unsubTiming();
    };
  }, []);

  const setRoundLoading = (roundId: string, isLoading: boolean) => {
    setActionLoadingMap((prev) => ({ ...prev, [roundId]: isLoading }));
  };

  // --- SAVE SCHEDULE (INLINE) ---
  const handleSaveInlineSchedule = async (round: Round) => {
    const vals = inlineSchedules[round.id];
    if (!vals || !vals.startDate || !vals.startTime || !vals.endDate || !vals.endTime) {
      message.error('Please select valid Start Date, Start Time, End Date, and End Time.');
      return;
    }

    const startIso = parseDateAndTimeToIso(vals.startDate, vals.startTime);
    const endIso = parseDateAndTimeToIso(vals.endDate, vals.endTime);

    if (!startIso || !endIso) {
      message.error('Could not parse schedule timestamps. Please check your inputs.');
      return;
    }

    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      message.error('End Date & Time must be after the Start Date & Time.');
      return;
    }

    setRoundLoading(round.id, true);
    try {
      await saveRoundSchedule(round.id, {
        startDate: vals.startDate,
        startTime: vals.startTime,
        endDate: vals.endDate,
        endTime: vals.endTime,
        startIso,
        endIso,
      });
      message.success(`Schedule saved for ${round.name}. Status remains SCHEDULED until START ROUND is clicked.`);
    } catch (err: any) {
      message.error(err.message || 'Failed to save schedule.');
    } finally {
      setRoundLoading(round.id, false);
    }
  };

  // --- START ROUND (MANUAL ADMIN ACTIVATION) ---
  const handleStartRound = (round: Round) => {
    const vals = inlineSchedules[round.id];
    const sStr = vals ? `${vals.startDate} at ${vals.startTime}` : formatISTDateTime(round.startTime);
    const eStr = vals ? `${vals.endDate} at ${vals.endTime}` : formatISTDateTime(round.endTime);

    Modal.confirm({
      title: `Start ${round.name} now?`,
      content: (
        <div>
          <Paragraph>
            Are you sure you want to start <strong>{round.name}</strong>?
          </Paragraph>
          <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, fontSize: '12px' }}>
            <div><strong>Start:</strong> {sStr}</div>
            <div><strong>End:</strong> {eStr}</div>
          </div>
          <Paragraph style={{ marginTop: 10, color: '#059669', fontWeight: 600 }}>
            • Round will become live immediately.<br />
            • User upload functionality will become available.<br />
            • Live countdown timer will run for all participants.
          </Paragraph>
        </div>
      ),
      okText: 'START ROUND',
      okType: 'primary',
      cancelText: 'CANCEL',
      okButtonProps: { style: { background: '#059669', borderColor: '#059669', fontWeight: 700 } },
      onOk: async () => {
        setRoundLoading(round.id, true);
        try {
          await startRound(round.id);
          message.success(`${round.name} is now LIVE! Submissions are open.`);
        } catch (err: any) {
          message.error(err.message || `Failed to start ${round.name}`);
        } finally {
          setRoundLoading(round.id, false);
        }
      },
    });
  };

  // --- END ROUND ---
  const handleEndRound = (round: Round) => {
    Modal.confirm({
      title: `End ${round.name}?`,
      content: `Are you sure you want to end ${round.name}? This will lock submissions for all teams immediately.`,
      okText: 'END ROUND',
      okType: 'danger',
      cancelText: 'CANCEL',
      onOk: async () => {
        setRoundLoading(round.id, true);
        try {
          await stopRound(round.id);
          message.success(`${round.name} has been marked as ENDED. Submissions are closed.`);
        } catch (err: any) {
          message.error(err.message || `Failed to end ${round.name}`);
        } finally {
          setRoundLoading(round.id, false);
        }
      },
    });
  };

  // --- RESET ROUND ---
  const handleConfirmReset = async () => {
    if (!selectedRound) return;
    setRoundLoading(selectedRound.id, true);
    try {
      await resetRoundState(selectedRound.id);
      message.success(`${selectedRound.name} execution state reset to SCHEDULED successfully.`);
      setIsResetModalOpen(false);
      setSelectedRound(null);
    } catch (err: any) {
      message.error(err.message || 'Failed to reset round.');
    } finally {
      if (selectedRound) {
        setRoundLoading(selectedRound.id, false);
      }
    }
  };

  // Open Edit Schedule Modal
  const openEditModal = (round: Round) => {
    setSelectedRound(round);
    const sM = toIST(round.startTime || round.scheduledStartAt);
    const eM = toIST(round.endTime || round.scheduledEndAt);
    setModalSchedule({
      startDate: sM.format('YYYY-MM-DD'),
      startTime: sM.format('h:mm A'),
      endDate: eM.format('YYYY-MM-DD'),
      endTime: eM.format('h:mm A'),
    });
    setIsEditModalOpen(true);
  };

  const handleSaveModalSchedule = async () => {
    if (!selectedRound) return;
    const startIso = parseDateAndTimeToIso(modalSchedule.startDate, modalSchedule.startTime);
    const endIso = parseDateAndTimeToIso(modalSchedule.endDate, modalSchedule.endTime);

    if (!startIso || !endIso) {
      message.error('Please enter valid Start and End dates and times.');
      return;
    }

    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      message.error('End Date & Time must be after Start Date & Time.');
      return;
    }

    setRoundLoading(selectedRound.id, true);
    try {
      await saveRoundSchedule(selectedRound.id, {
        startDate: modalSchedule.startDate,
        startTime: modalSchedule.startTime,
        endDate: modalSchedule.endDate,
        endTime: modalSchedule.endTime,
        startIso,
        endIso,
      });
      message.success(`Schedule updated for ${selectedRound.name}.`);
      setIsEditModalOpen(false);
      setSelectedRound(null);
    } catch (err: any) {
      message.error(err.message || 'Failed to update schedule.');
    } finally {
      if (selectedRound) setRoundLoading(selectedRound.id, false);
    }
  };

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
            Round Management & Manual Lifecycle Control
          </Title>
          <Text type="secondary">
            Configure 12-hour AM/PM schedules, manually start rounds, and manage execution states safely.
          </Text>
        </div>
      </div>

      <Alert
        message="Admin Manual Activation Policy"
        description="Rounds do not automatically start when the scheduled start time arrives. The Admin must explicitly click START ROUND to open submissions and start the live countdown for participants."
        type="info"
        showIcon
        style={{ marginBottom: 24, borderRadius: 8 }}
      />

      {/* Rounds Grid */}
      <Row gutter={[24, 24]}>
        {rounds.map((round) => {
          const timing = calculateLiveRoundTiming(round, timingConfig);
          const liveStatus = timing.liveStatus;
          const isLive = liveStatus === 'ACTIVE';
          const isEnded = liveStatus === 'ENDED';
          const isScheduled = !isLive && !isEnded;
          const isLoading = Boolean(actionLoadingMap[round.id]);

          const inlineVal = inlineSchedules[round.id] || {
            startDate: '',
            startTime: '',
            endDate: '',
            endTime: '',
          };

          return (
            <Col xs={24} lg={8} key={round.id}>
              <Card
                bordered={false}
                style={{
                  borderRadius: 14,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                  border: isLive ? '2px solid #10b981' : isEnded ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                }}
              >
                {/* Header Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Tag color={isLive ? 'green' : isEnded ? 'default' : 'blue'} style={{ fontSize: '13px', padding: '4px 10px', fontWeight: 800, borderRadius: 6 }}>
                    {round.name.toUpperCase()}
                  </Tag>

                  {isLive ? (
                    <Tag color="success" icon={<PlayCircleOutlined />} style={{ fontWeight: 700 }}>
                      LIVE NOW
                    </Tag>
                  ) : isEnded ? (
                    <Tag color="default" icon={<StopOutlined />}>
                      ENDED
                    </Tag>
                  ) : (
                    <Tag color="processing" icon={<ClockCircleOutlined />}>
                      SCHEDULED (WAITING ADMIN)
                    </Tag>
                  )}
                </div>

                <Paragraph type="secondary" style={{ fontSize: '13px', minHeight: 38, marginBottom: 12 }}>
                  {round.description}
                </Paragraph>

                {/* --- STATE 1: SCHEDULED (BEFORE START ROUND) --- */}
                {isScheduled && (
                  <div style={{ margin: '10px 0' }}>
                    <Schedule12HourPicker
                      value={inlineVal}
                      disabled={isLoading}
                      onChange={(newVal) =>
                        setInlineSchedules((prev) => ({
                          ...prev,
                          [round.id]: newVal,
                        }))
                      }
                    />

                    <Space direction="vertical" style={{ width: '100%', marginTop: 14 }} size={8}>
                      <Button
                        type="default"
                        block
                        icon={<SaveOutlined />}
                        loading={isLoading}
                        onClick={() => handleSaveInlineSchedule(round)}
                        style={{ borderRadius: 8, fontWeight: 600 }}
                      >
                        SAVE SCHEDULE
                      </Button>

                      <Button
                        type="primary"
                        block
                        icon={<PlayCircleOutlined />}
                        loading={isLoading}
                        onClick={() => handleStartRound(round)}
                        style={{
                          borderRadius: 8,
                          fontWeight: 700,
                          background: '#059669',
                          borderColor: '#059669',
                          height: 40,
                        }}
                      >
                        START ROUND
                      </Button>

                      <Button
                        danger
                        type="text"
                        block
                        icon={<ReloadOutlined />}
                        loading={isLoading}
                        onClick={() => {
                          setSelectedRound(round);
                          setIsResetModalOpen(true);
                        }}
                        style={{ borderRadius: 8, fontSize: '12px', marginTop: 4 }}
                      >
                        RESET
                      </Button>
                    </Space>
                  </div>
                )}

                {/* --- STATE 2: ACTIVE (ROUND IS LIVE) --- */}
                {isLive && (
                  <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: 10, border: '1px solid #bbf7d0', margin: '10px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <PlayCircleOutlined style={{ color: '#16a34a', fontSize: '18px' }} />
                      <Text strong style={{ color: '#166534', fontSize: '14px' }}>
                        Round is Live
                      </Text>
                    </div>

                    <div style={{ fontSize: '12px', color: '#334155', marginBottom: 12, lineHeight: 1.6 }}>
                      <div><strong>Started:</strong> {formatISTDateTime(round.actualStartedAt || round.startTime)}</div>
                      <div><strong>Deadline:</strong> {formatISTDateTime(round.endTime)}</div>
                      <div><strong>Duration:</strong> {calculateDurationFormatted(round.actualStartedAt || round.startTime, round.endTime)}</div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: 8, border: '1px solid #dcfce7', textAlign: 'center', marginBottom: 16 }}>
                      <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Time Remaining
                      </Text>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#15803d', marginTop: 2 }}>
                        {formatRemainingSecondsDetailed(timing.remainingSeconds)}
                      </div>
                    </div>

                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <Button
                        danger
                        type="primary"
                        block
                        icon={<StopOutlined />}
                        loading={isLoading}
                        onClick={() => handleEndRound(round)}
                        style={{ borderRadius: 8, fontWeight: 700, height: 40 }}
                      >
                        END ROUND
                      </Button>

                      <Button
                        type="default"
                        block
                        icon={<EditOutlined />}
                        onClick={() => openEditModal(round)}
                        style={{ borderRadius: 8, fontSize: '12px' }}
                      >
                        Edit Schedule
                      </Button>

                      <Button
                        danger
                        type="text"
                        block
                        icon={<ReloadOutlined />}
                        onClick={() => {
                          setSelectedRound(round);
                          setIsResetModalOpen(true);
                        }}
                        style={{ borderRadius: 8, fontSize: '12px' }}
                      >
                        RESET
                      </Button>
                    </Space>
                  </div>
                )}

                {/* --- STATE 3: ENDED --- */}
                {isEnded && (
                  <div style={{ background: '#f8fafc', padding: '16px', borderRadius: 10, border: '1px solid #e2e8f0', margin: '10px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <CheckCircleOutlined style={{ color: '#64748b', fontSize: '18px' }} />
                      <Text strong style={{ color: '#334155', fontSize: '14px' }}>
                        Round Completed
                      </Text>
                    </div>

                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: 16, lineHeight: 1.6 }}>
                      <div><strong>Started:</strong> {formatISTDateTime(round.actualStartedAt || round.startTime)}</div>
                      <div><strong>Ended:</strong> {formatISTDateTime(round.actualEndedAt || round.endTime)}</div>
                      <div><strong>Uploads:</strong> Locked (Submissions closed)</div>
                    </div>

                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <Button
                        type="default"
                        block
                        icon={<EditOutlined />}
                        onClick={() => openEditModal(round)}
                        style={{ borderRadius: 8, fontWeight: 600 }}
                      >
                        Edit Schedule
                      </Button>

                      <Button
                        type="primary"
                        block
                        icon={<PlayCircleOutlined />}
                        loading={isLoading}
                        onClick={() => handleStartRound(round)}
                        style={{ borderRadius: 8, fontWeight: 700, background: '#059669', borderColor: '#059669' }}
                      >
                        START ROUND
                      </Button>

                      <Button
                        danger
                        type="text"
                        block
                        icon={<ReloadOutlined />}
                        onClick={() => {
                          setSelectedRound(round);
                          setIsResetModalOpen(true);
                        }}
                        style={{ borderRadius: 8, fontSize: '12px' }}
                      >
                        RESET
                      </Button>
                    </Space>
                  </div>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* --- EDIT SCHEDULE MODAL --- */}
      <Modal
        title={
          <Space>
            <SettingOutlined style={{ color: '#1677ff' }} />
            <span>Edit Schedule — {selectedRound?.name}</span>
          </Space>
        }
        open={isEditModalOpen}
        onOk={handleSaveModalSchedule}
        onCancel={() => {
          setIsEditModalOpen(false);
          setSelectedRound(null);
        }}
        okText="SAVE SCHEDULE"
        cancelText="CANCEL"
        confirmLoading={selectedRound ? Boolean(actionLoadingMap[selectedRound.id]) : false}
      >
        <div style={{ padding: '12px 0' }}>
          <Paragraph type="secondary" style={{ fontSize: '13px' }}>
            Update the Start Date, Start Time (12-hour AM/PM), End Date, and End Time for {selectedRound?.name}.
          </Paragraph>

          <Schedule12HourPicker
            value={modalSchedule}
            onChange={(newVal) => setModalSchedule(newVal)}
          />
        </div>
      </Modal>

      {/* --- RESET MODAL --- */}
      <Modal
        title={
          <Space>
            <ReloadOutlined style={{ color: '#dc2626' }} />
            <span>Reset {selectedRound?.name}?</span>
          </Space>
        }
        open={isResetModalOpen}
        onOk={handleConfirmReset}
        onCancel={() => {
          setIsResetModalOpen(false);
          setSelectedRound(null);
        }}
        okText="CONFIRM RESET"
        okType="danger"
        cancelText="CANCEL"
        confirmLoading={selectedRound ? Boolean(actionLoadingMap[selectedRound.id]) : false}
      >
        <div style={{ padding: '8px 0' }}>
          <Alert
            message="Are you sure you want to reset this round?"
            description="The round will return to its initial not-started state. Uploads will be locked and live timers stopped. Participant submissions and scores remain safely preserved."
            type="warning"
            showIcon
            style={{ marginBottom: 14 }}
          />
          <Paragraph style={{ fontSize: '13px', color: '#475569' }}>
            • Execution status reverts to <strong>SCHEDULED</strong>.<br />
            • Users will see <em>"Waiting for Admin to start this round."</em><br />
            • Submissions will be disabled until Admin clicks <strong>START ROUND</strong> again.
          </Paragraph>
        </div>
      </Modal>
    </div>
  );
};
