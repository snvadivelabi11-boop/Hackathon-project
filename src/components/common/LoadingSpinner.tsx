import React from 'react';
import { Spin, Typography } from 'antd';

interface LoadingSpinnerProps {
  tip?: string;
  minHeight?: string | number;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  tip = 'Loading...',
  minHeight = '300px',
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight,
        width: '100%',
      }}
    >
      <Spin size="large" />
      <Typography.Text type="secondary" style={{ marginTop: 16 }}>
        {tip}
      </Typography.Text>
    </div>
  );
};
