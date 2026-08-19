import React from 'react';
import { Tag, Badge } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LockOutlined,
  StopOutlined,
  SyncOutlined,
  FileDoneOutlined,
} from '@ant-design/icons';
import { RoundStatus, AccountStatus } from '../../types';

interface StatusBadgeProps {
  status: RoundStatus | AccountStatus | 'SUBMITTED' | 'EVALUATED' | 'PENDING' | 'NOT_STARTED' | string;
  type?: 'tag' | 'badge';
  size?: 'small' | 'default';
  customText?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'tag', customText }) => {
  const upper = String(status || '').toUpperCase();

  let color = 'default';
  let icon: React.ReactNode = null;
  let text = customText || upper;

  switch (upper) {
    case 'ACTIVE':
    case 'LIVE':
      color = 'success';
      icon = <SyncOutlined spin />;
      text = customText || 'ACTIVE';
      break;
    case 'LOCKED':
      color = 'default';
      icon = <LockOutlined />;
      text = customText || 'LOCKED';
      break;
    case 'SCHEDULED':
    case 'NOT_STARTED':
    case 'NOT STARTED':
    case 'WAITING':
    case 'WAITING_FOR_ADMIN':
    case 'UPCOMING':
      color = 'blue';
      icon = <ClockCircleOutlined />;
      text = customText || 'Waiting for Admin to Start';
      break;
    case 'ENDED':
    case 'CLOSED':
      color = 'error';
      icon = <StopOutlined />;
      text = customText || 'ENDED';
      break;
    case 'SUBMITTED':
      color = 'success';
      icon = <CheckCircleOutlined />;
      text = customText || 'SUBMITTED';
      break;
    case 'EVALUATED':
      color = 'purple';
      icon = <FileDoneOutlined />;
      text = customText || 'EVALUATED';
      break;
    case 'PENDING':
    case 'IN PROGRESS':
      color = 'warning';
      icon = <ClockCircleOutlined />;
      text = customText || 'PENDING';
      break;
    case 'DISABLED':
      color = 'error';
      icon = <StopOutlined />;
      text = customText || 'DISABLED';
      break;
    default:
      color = 'default';
      text = customText || upper;
  }

  if (type === 'badge') {
    const badgeStatus =
      upper === 'ACTIVE' || upper === 'LIVE'
        ? 'processing'
        : upper === 'SUBMITTED'
        ? 'success'
        : 'default';
    return <Badge status={badgeStatus} text={text} />;
  }

  return (
    <Tag color={color} icon={icon} style={{ fontWeight: 600, padding: '3px 10px', borderRadius: '6px', fontSize: '13px' }}>
      {text}
    </Tag>
  );
};
