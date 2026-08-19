import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Avatar, Dropdown, Space, Typography, Tag, Drawer, Grid } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  UploadOutlined,
  CheckSquareOutlined,
  TrophyOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  HistoryOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  UserOutlined,
  GlobalOutlined,
  FileTextOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { formatISTTime } from '../../utils/date';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

export const AdminLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>(formatISTTime());
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();

  const isMobile = !screens.md;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(formatISTTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const menuItems = [
    {
      key: '/admin/dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    {
      key: '/admin/teams',
      icon: <TeamOutlined />,
      label: 'Teams',
    },
    {
      key: '/admin/problems',
      icon: <FileTextOutlined />,
      label: 'Problem Statements',
    },
    {
      key: '/admin/rounds',
      icon: <ClockCircleOutlined />,
      label: 'Rounds',
    },
    {
      key: '/admin/submissions',
      icon: <UploadOutlined />,
      label: 'Submissions',
    },
    {
      key: '/admin/evaluations',
      icon: <CheckSquareOutlined />,
      label: 'Evaluations',
    },
    {
      key: '/admin/analytics',
      icon: <RobotOutlined />,
      label: 'AI Analytics',
    },
    {
      key: '/admin/selection',
      icon: <CheckCircleOutlined />,
      label: 'Team Selection',
    },
    {
      key: '/admin/certificates',
      icon: <SafetyCertificateOutlined />,
      label: 'Certificates',
    },
    {
      key: '/admin/results',
      icon: <TrophyOutlined />,
      label: 'Results & Leaderboard',
    },
    {
      key: '/admin/audit-logs',
      icon: <HistoryOutlined />,
      label: 'Audit Logs',
    },
    {
      key: '/admin/settings',
      icon: <SettingOutlined />,
      label: 'Settings',
    },
  ];

  const handleMenuClick = (info: { key: string }) => {
    navigate(info.key);
    if (isMobile) setMobileDrawerOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/admin');
  };

  const profileMenuItems = [
    {
      key: 'role-tag',
      disabled: true,
      label: (
        <Space direction="vertical" size={0}>
          <Text strong>{user?.displayName || 'Administrator'}</Text>
          <Text type="secondary" style={{ fontSize: '12px' }}>{user?.username || 'admin'}</Text>
        </Space>
      ),
    },
    { type: 'divider' as const },
    {
      key: 'public-selection',
      icon: <GlobalOutlined />,
      label: 'View Public Selection (/selection)',
      onClick: () => window.open('/selection', '_blank'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'System Settings',
      onClick: () => navigate('/admin/settings'),
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
      onClick: handleLogout,
    },
  ];

  const sidebarContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 800,
            fontSize: '18px',
          }}
        >
          H
        </div>
        {(!collapsed || isMobile) && (
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#141414', lineHeight: 1.2 }}>
              HackPortal
            </div>
            <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Admin Console
            </Text>
          </div>
        )}
      </div>

      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={handleMenuClick}
        style={{ borderRight: 0, flex: 1, paddingTop: 8 }}
      />

      {(!collapsed || isMobile) && (
        <div style={{ padding: '16px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
          <Text type="secondary" style={{ fontSize: '11px', display: 'block' }}>
            Timezone (IST)
          </Text>
          <Text strong style={{ fontSize: '13px' }}>
            {currentTime}
          </Text>
        </div>
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={(value) => setCollapsed(value)}
          trigger={null}
          width={240}
          theme="light"
          style={{
            boxShadow: '1px 0 6px rgba(0,21,41,0.08)',
            zIndex: 10,
          }}
        >
          {sidebarContent}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          placement="left"
          onClose={() => setMobileDrawerOpen(false)}
          open={mobileDrawerOpen}
          bodyStyle={{ padding: 0 }}
          width={260}
        >
          {sidebarContent}
        </Drawer>
      )}

      <Layout>
        <Header
          style={{
            padding: '0 20px',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 9,
            height: 64,
          }}
        >
          <Space size="middle">
            <Button
              type="text"
              icon={isMobile ? <MenuUnfoldOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => (isMobile ? setMobileDrawerOpen(true) : setCollapsed(!collapsed))}
              style={{ fontSize: '16px', width: 40, height: 40 }}
            />
            <div style={{ display: screens.xs ? 'none' : 'block' }}>
              <Text strong style={{ fontSize: '16px' }}>
                Hackathon Management Control (100 Teams)
              </Text>
            </div>
          </Space>

          <Space size="middle">
            <Tag color="blue" style={{ margin: 0, padding: '4px 10px', borderRadius: 4 }}>
              <Space size={4}>
                <ClockCircleOutlined />
                <span style={{ fontWeight: 600 }}>{currentTime}</span>
              </Space>
            </Tag>

            <Dropdown menu={{ items: profileMenuItems }} placement="bottomRight" arrow>
              <Space style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>
                <Avatar style={{ backgroundColor: '#1677ff', verticalAlign: 'middle' }} icon={<UserOutlined />} />
                <div style={{ display: isMobile ? 'none' : 'block', textAlign: 'left' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.2 }}>
                    {user?.displayName || 'Admin'}
                  </div>
                  <Tag color="purple" style={{ fontSize: '10px', padding: '0 4px', margin: 0, lineHeight: '14px' }}>
                    ADMIN
                  </Tag>
                </div>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ margin: isMobile ? '12px' : '20px', minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};
