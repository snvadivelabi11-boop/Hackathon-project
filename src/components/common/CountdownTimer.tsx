import React from 'react';
import { Card, Typography, Space } from 'antd';
import { ClockCircleOutlined, AlertOutlined, PlayCircleOutlined, LockOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { useCountdown } from '../../hooks/useCountdown';
import { toIST } from '../../utils/date';
import { RoundStatus } from '../../types';

const { Text } = Typography;

interface CountdownTimerProps {
  startTime?: any;
  endTime?: any;
  status?: RoundStatus | 'WAITING' | string;
  title?: string;
  size?: 'small' | 'default' | 'large';
  showCard?: boolean;
  onExpire?: () => void;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  startTime,
  endTime,
  status,
  title,
  size = 'default',
  showCard = true,
  onExpire,
}) => {
  const upperStatus = String(status || '').toUpperCase();
  const isScheduled =
    upperStatus === 'SCHEDULED' ||
    upperStatus === 'UPCOMING' ||
    upperStatus === 'NOT_STARTED' ||
    upperStatus === 'WAITING';
  const targetTime = isScheduled ? startTime : endTime;
  const countdown = useCountdown(targetTime, onExpire);

  const isUrgent = !countdown.isExpired && status === 'ACTIVE' && countdown.totalSeconds < 900; // < 15 mins

  const renderContent = () => {
    if (status === 'LOCKED') {
      return (
        <Space direction="vertical" size={2} align="center" style={{ width: '100%' }}>
          <Text type="secondary" strong style={{ fontSize: size === 'large' ? '18px' : '14px' }}>
            <LockOutlined /> ROUND LOCKED BY ADMINISTRATOR
          </Text>
        </Space>
      );
    }

    if (status === 'PAUSED') {
      return (
        <Space direction="vertical" size={2} align="center" style={{ width: '100%' }}>
          <Text style={{ color: '#d97706', fontSize: size === 'large' ? '18px' : '14px', fontWeight: 700 }}>
            <PauseCircleOutlined /> ROUND PAUSED BY ADMINISTRATOR
          </Text>
        </Space>
      );
    }

    if (isScheduled) {
      return (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <Text type="secondary" strong style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <ClockCircleOutlined style={{ marginRight: 6, color: '#1677ff' }} />
            Timer: Not Running
          </Text>
          <div
            style={{
              fontFamily: 'monospace, monospace',
              fontWeight: 700,
              fontSize: size === 'large' ? '20px' : size === 'small' ? '14px' : '16px',
              color: '#1677ff',
              marginTop: 4,
            }}
          >
            Waiting for Admin to Start
          </div>
        </div>
      );
    }

    if (countdown.isExpired || status === 'ENDED') {
      return (
        <Space direction="vertical" size={2} align="center" style={{ width: '100%' }}>
          <Text type="danger" strong style={{ fontSize: size === 'large' ? '18px' : '14px' }}>
            <AlertOutlined /> ROUND HAS ENDED — SUBMISSIONS CLOSED
          </Text>
        </Space>
      );
    }

    return (
      <div style={{ textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          <ClockCircleOutlined style={{ marginRight: 4 }} />
          {title || 'Time Remaining'}
        </Text>
        <div
          style={{
            fontFamily: 'monospace, monospace',
            fontWeight: 700,
            fontSize: size === 'large' ? '32px' : size === 'small' ? '18px' : '24px',
            color: isUrgent ? '#cf1322' : '#059669',
            letterSpacing: '2px',
            marginTop: 4,
          }}
        >
          {countdown.formatted}
        </div>
      </div>
    );
  };

  if (!showCard) {
    return renderContent();
  }

  const isEnded = countdown.isExpired || status === 'ENDED';
  const isPaused = status === 'PAUSED';

  return (
    <Card
      size="small"
      style={{
        background: isEnded
          ? '#fff1f0'
          : isPaused
          ? '#fffbe6'
          : isScheduled
          ? '#eff6ff'
          : isUrgent
          ? '#fff2e8'
          : '#ecfdf5',
        borderColor: isEnded
          ? '#ffa39e'
          : isPaused
          ? '#ffe58f'
          : isScheduled
          ? '#bfdbfe'
          : isUrgent
          ? '#ffbb96'
          : '#a7f3d0',
        borderRadius: 8,
      }}
    >
      {renderContent()}
    </Card>
  );
};
