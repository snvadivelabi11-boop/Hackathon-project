import React, { useState, useEffect } from 'react';
import { Card, Table, Typography, Tag, Space, Input } from 'antd';
import { HistoryOutlined, SearchOutlined } from '@ant-design/icons';
import { subscribeToAuditLogs } from '../../services/audit.service';
import { AuditLog } from '../../types';
import { formatISTDateTime, formatISTFromNow } from '../../utils/date';

const { Title, Text } = Typography;

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsub = subscribeToAuditLogs(setLogs);
    return () => unsub();
  }, []);

  const query = (search || '').trim().toLowerCase();
  const filteredLogs = logs.filter((l) => {
    if (!query) return true;
    const action = (l.action || '').toLowerCase();
    const targetId = (l.targetId || '').toLowerCase();
    const adminEmail = (l.adminEmail || '').toLowerCase();
    return action.includes(query) || targetId.includes(query) || adminEmail.includes(query);
  });

  const getActionColor = (action?: string) => {
    const act = action || '';
    if (act.includes('Created')) return 'green';
    if (act.includes('Disabled') || act.includes('Stopped')) return 'red';
    if (act.includes('Enabled') || act.includes('Started')) return 'cyan';
    if (act.includes('Password') || act.includes('Logout')) return 'orange';
    if (act.includes('Score')) return 'purple';
    return 'blue';
  };

  const columns = [
    {
      title: 'Timestamp (IST)',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (time: any) => (
        <div>
          <div style={{ fontSize: '13px' }}>{formatISTDateTime(time)}</div>
          <Text type="secondary" style={{ fontSize: '11px' }}>{formatISTFromNow(time)}</Text>
        </div>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (act: string) => (
        <Tag color={getActionColor(act)} style={{ fontWeight: 600 }}>
          {act}
        </Tag>
      ),
    },
    {
      title: 'Target Type',
      dataIndex: 'targetType',
      key: 'targetType',
      render: (t: string) => <Tag>{t.toUpperCase()}</Tag>,
    },
    {
      title: 'Target ID',
      dataIndex: 'targetId',
      key: 'targetId',
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: 'Triggered By',
      dataIndex: 'adminEmail',
      key: 'adminEmail',
      render: (email?: string) => <Text>{email || 'Super Admin'}</Text>,
    },
    {
      title: 'Details',
      dataIndex: 'metadata',
      key: 'metadata',
      render: (meta?: any) => {
        if (!meta || Object.keys(meta).length === 0) return <Text type="secondary">—</Text>;
        return (
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {JSON.stringify(meta)}
          </Text>
        );
      },
    },
  ];

  return (
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
        <div>
          <Title level={3} style={{ margin: 0 }}>
            System Audit Trail
          </Title>
          <Text type="secondary">
            Immutable log of all administrative actions, account updates, and round triggers
          </Text>
        </div>
        <Input
          placeholder="Filter audit events..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260, borderRadius: 8 }}
          allowClear
        />
      </div>

      <Table
        dataSource={filteredLogs}
        columns={columns}
        rowKey="id"
        pagination={{ pageSize: 12 }}
        size="middle"
      />
    </Card>
  );
};
