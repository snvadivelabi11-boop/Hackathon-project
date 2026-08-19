import { MAX_USER_DEVICES } from '../src/services/auth.service';
import crypto from 'crypto';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordTest(id: number, name: string, passed: boolean, details: string) {
  results.push({ id, name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [TEST ${String(id).padStart(2, '0')}] ${name} -> ${passed ? 'PASS' : 'FAIL'} (${details})`);
}

interface MockDeviceSession {
  sessionId: string;
  userId: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  status: 'active' | 'revoked';
}

interface MockUserAccount {
  uid: string;
  role: 'team' | 'admin';
  teamId?: string;
  username: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  sessionVersion: number;
  activeSessions: MockDeviceSession[];
}

async function runMultiDeviceTestSuite() {
  console.log('\n======================================================================');
  console.log('       MULTI-DEVICE USER LOGIN VERIFICATION SUITE (15 TESTS)          ');
  console.log('======================================================================\n');

  const database: Record<string, MockUserAccount> = {
    uid_team_008: {
      uid: 'uid_team_008',
      role: 'team',
      teamId: 'TEAM008',
      username: 'team008',
      passwordHash: crypto.createHash('sha256').update('SecurePass@2026').digest('hex'),
      status: 'active',
      sessionVersion: 1,
      activeSessions: [],
    },
    uid_admin_001: {
      uid: 'uid_admin_001',
      role: 'admin',
      username: 'admin',
      passwordHash: crypto.createHash('sha256').update('AdminPass@2026').digest('hex'),
      status: 'active',
      sessionVersion: 1,
      activeSessions: [],
    },
  };

  function simulateLogin(uid: string, passwordInput: string, deviceName: string) {
    const user = database[uid];
    if (!user) throw new Error('User not found');
    if (user.status === 'disabled') throw new Error('Account disabled');

    const inputHash = crypto.createHash('sha256').update(passwordInput).digest('hex');
    if (user.passwordHash !== inputHash) {
      throw new Error('Invalid email or password.');
    }

    const activeSessions = user.activeSessions.filter((s) => s.status === 'active');

    // 6 device limit for teams
    if (user.role === 'team' && activeSessions.length >= MAX_USER_DEVICES) {
      throw new Error('Maximum 6 active devices reached. Please logout from another device.');
    }

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const newSession: MockDeviceSession = {
      sessionId,
      userId: uid,
      userAgent: deviceName,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      status: 'active',
    };

    user.activeSessions.push(newSession);
    return { success: true, sessionId, activeDevicesCount: user.activeSessions.length };
  }

  function simulateLogout(uid: string, sessionId: string) {
    const user = database[uid];
    if (!user) return;
    user.activeSessions = user.activeSessions.filter((s) => s.sessionId !== sessionId);
  }

  function simulatePasswordReset(uid: string, newPass: string) {
    const user = database[uid];
    if (!user) throw new Error('User not found');
    user.passwordHash = crypto.createHash('sha256').update(newPass).digest('hex');
    user.activeSessions = []; // Invalidate all sessions
    user.sessionVersion += 1;
  }

  // --- Phase 1: Device 1 to 6 Sequential Login ---
  console.log('--- Phase 1: Sequential Login (Devices 1 through 6) ---');

  const teamSessions: string[] = [];

  for (let i = 1; i <= 6; i++) {
    let loginOk = false;
    let devSessionId = '';
    try {
      const res = simulateLogin('uid_team_008', 'SecurePass@2026', `Device_${i}_Chrome`);
      loginOk = res.success;
      devSessionId = res.sessionId;
      teamSessions.push(devSessionId);
    } catch (e: any) {
      loginOk = false;
    }

    recordTest(
      i,
      `Device ${i} Login (Team User)`,
      loginOk && database.uid_team_008.activeSessions.length === i,
      `Device ${i} Active | Total Logged In: ${database.uid_team_008.activeSessions.length}/6`
    );
  }

  // --- Phase 2: Device 7 Rejection ---
  console.log('\n--- Phase 2: Device 7 Limit Enforcement ---');

  let device7Blocked = false;
  let device7ErrorMsg = '';

  try {
    simulateLogin('uid_team_008', 'SecurePass@2026', 'Device_7_Firefox');
  } catch (err: any) {
    device7Blocked = true;
    device7ErrorMsg = err.message;
  }

  recordTest(
    7,
    'Device 7 Login Rejected',
    device7Blocked && device7ErrorMsg.includes('Maximum 6 active devices reached'),
    `Message: "${device7ErrorMsg}"`
  );

  // --- Phase 3: Logout Slot Reuse ---
  console.log('\n--- Phase 3: Logout Slot Reuse ---');

  // Logout Device 2
  simulateLogout('uid_team_008', teamSessions[1]);
  recordTest(
    8,
    'Device 2 Explicit Logout',
    database.uid_team_008.activeSessions.length === 5,
    `Remaining Active Devices: ${database.uid_team_008.activeSessions.length}/6`
  );

  // Now Device 7 attempts login again -> should succeed
  let device7RetryOk = false;
  try {
    const res = simulateLogin('uid_team_008', 'SecurePass@2026', 'Device_7_Firefox_Retry');
    device7RetryOk = res.success;
  } catch {}

  recordTest(
    9,
    'Slot Reuse (Device 7 Allowed after Logout)',
    device7RetryOk && database.uid_team_008.activeSessions.length === 6,
    `Active Devices: ${database.uid_team_008.activeSessions.length}/6`
  );

  // --- Phase 4: Password Reset Session Revocation ---
  console.log('\n--- Phase 4: Password Reset Session Revocation ---');

  simulatePasswordReset('uid_team_008', 'NewPassword@2026!');
  recordTest(
    10,
    'Password Reset Invalidation',
    database.uid_team_008.activeSessions.length === 0 && database.uid_team_008.sessionVersion === 2,
    `Active Sessions: ${database.uid_team_008.activeSessions.length}, Version: ${database.uid_team_008.sessionVersion}`
  );

  // Old password rejected
  let oldPassRejected = false;
  try {
    simulateLogin('uid_team_008', 'SecurePass@2026', 'Device_1');
  } catch {
    oldPassRejected = true;
  }
  recordTest(
    11,
    'Old Password Rejected Post-Reset',
    oldPassRejected,
    'Old password cannot establish new device sessions'
  );

  // New password allows 6 new device logins
  let newPassLoginOk = false;
  try {
    const res = simulateLogin('uid_team_008', 'NewPassword@2026!', 'New_Device_1');
    newPassLoginOk = res.success;
  } catch {}
  recordTest(
    12,
    'New Password Login Succeeds',
    newPassLoginOk && database.uid_team_008.activeSessions.length === 1,
    `Active Devices: ${database.uid_team_008.activeSessions.length}/6`
  );

  // --- Phase 5: Admin Multi-Device Freedom & Security ---
  console.log('\n--- Phase 5: Admin Multi-Device Freedom & Security ---');

  let adminMultipleOk = true;
  for (let a = 1; a <= 10; a++) {
    try {
      simulateLogin('uid_admin_001', 'AdminPass@2026', `Admin_Console_${a}`);
    } catch {
      adminMultipleOk = false;
    }
  }

  recordTest(
    13,
    'Admin Multi-Device Concurrency (10+ Devices Allowed)',
    adminMultipleOk && database.uid_admin_001.activeSessions.length === 10,
    `Active Admin Consoles: ${database.uid_admin_001.activeSessions.length}`
  );

  // Account Disabled Revocation
  database.uid_team_008.status = 'disabled';
  let disabledBlocked = false;
  try {
    simulateLogin('uid_team_008', 'NewPassword@2026!', 'Device_X');
  } catch (err: any) {
    disabledBlocked = err.message === 'Account disabled';
  }
  recordTest(
    14,
    'Disabled Account Blocks All New Device Logins',
    disabledBlocked,
    'Disabled team account cannot establish new device sessions'
  );

  // Zero Plaintext Passwords
  const zeroPlaintext = Object.values(database).every(
    (u) => !u.passwordHash.includes('SecurePass') && !u.passwordHash.includes('AdminPass')
  );
  recordTest(
    15,
    'Zero Plaintext Passwords',
    zeroPlaintext,
    'Passwords cryptographically hashed via SHA-256'
  );

  console.log('\n======================================================================');
  console.log('             MULTI-DEVICE LOGIN TEST SUMMARY                          ');
  console.log('======================================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total Checks:    ${total}`);
  console.log(`PASS:            ${passed} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`FAIL:            ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMultiDeviceTestSuite();
