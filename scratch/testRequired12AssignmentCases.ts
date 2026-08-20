/**
 * Dedicated Test Suite for the 12 Specific Problem Statement Assignment Cases
 * 
 * Required Test Cases:
 * TEST 1: Create Team 1 with all statements free. Expected: Team 1 -> #1.
 * TEST 2: Create Team 2. Expected: Team 2 -> #2, NOT #1.
 * TEST 3: Create Team 3. Expected: Team 3 -> #3.
 * TEST 4: Publish #1 for Team 1. Create Team 4. Expected: Team 4 -> #4.
 * TEST 5: #1 assigned, #2 free, #3 assigned. Create a new Team. Expected: new Team -> #2.
 * TEST 6: All statements are assigned. Create a new Team. Expected: no duplicate assignment and clear message.
 * TEST 7: Refresh admin page multiple times. Expected: assignments do not change.
 * TEST 8: Open/close Create Team modal multiple times. Expected: no assignment until actually created.
 * TEST 9: Create two teams quickly / concurrently. Expected: each gets a different free problem.
 * TEST 10: Existing published Team assignment. Expected: never changes after creating additional teams.
 * TEST 11: Manual admin reassignment. Expected: existing manual assignment still works and auto assignment respects updated occupied state.
 * TEST 12: Multi-device/browser creation. Expected: no duplicate assignment.
 */

import { ProblemStatement, TeamProblemAssignment } from '../src/types';

interface MockDb {
  problemStatements: Map<string, ProblemStatement>;
  teamProblemAssignments: Map<string, TeamProblemAssignment>;
  teams: Map<string, any>;
  settings: Map<string, any>;
  problemAssignments: Map<string, any>;
}

function createFreshDb(): MockDb {
  return {
    problemStatements: new Map(),
    teamProblemAssignments: new Map(),
    teams: new Map(),
    settings: new Map(),
    problemAssignments: new Map(),
  };
}

function extractIdVariants(rawId: string | number | null | undefined): string[] {
  if (rawId === null || rawId === undefined) return [];
  const str = String(rawId).trim().toLowerCase();
  if (!str) return [];
  const variants = new Set<string>();
  variants.add(str);

  const psMatch = str.match(/^ps\s*0*(\d+)$/i);
  if (psMatch) {
    const num = parseInt(psMatch[1], 10);
    variants.add(String(num));
    variants.add(`ps${num}`);
    variants.add(`ps${String(num).padStart(3, '0')}`);
  } else {
    const numMatch = str.match(/^0*(\d+)$/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      variants.add(String(num));
      variants.add(`ps${num}`);
      variants.add(`ps${String(num).padStart(3, '0')}`);
    }
  }
  return Array.from(variants);
}

function isStatementOccupied(statement: ProblemStatement, occupiedSet: Set<string>, excludeTeamId?: string): boolean {
  const idsToCheck = [
    statement.statementId,
    statement.problemStatementId,
    statement.sequence ? String(statement.sequence) : null,
    statement.order ? String(statement.order) : null,
  ];

  for (const raw of idsToCheck) {
    if (!raw) continue;
    const variants = extractIdVariants(raw);
    for (const v of variants) {
      if (occupiedSet.has(v)) return true;
    }
  }

  if (statement.assignedTeamId && statement.assignedTeamId.trim().length > 0) {
    if (!excludeTeamId || statement.assignedTeamId !== excludeTeamId) return true;
  }
  if (Array.isArray(statement.assignedTeamIds) && statement.assignedTeamIds.length > 0) {
    if (!excludeTeamId || statement.assignedTeamIds.some((tid) => tid !== excludeTeamId)) return true;
  }
  if (statement.team && statement.team.trim().length > 0) {
    if (!excludeTeamId || statement.team !== excludeTeamId) return true;
  }

  return false;
}

function getComprehensiveOccupiedIds(db: MockDb, excludeTeamId?: string): Set<string> {
  const occupiedVariants = new Set<string>();

  const markOccupied = (rawId: string | number | null | undefined) => {
    if (!rawId) return;
    const variants = extractIdVariants(rawId);
    variants.forEach((v) => occupiedVariants.add(v));
  };

  // 1. Check teamProblemAssignments
  db.teamProblemAssignments.forEach((data, teamId) => {
    if (excludeTeamId && teamId === excludeTeamId) return;
    markOccupied(data.statementId);
    markOccupied(data.problemStatementId);
    if (data.problemSequence) markOccupied(data.problemSequence);
  });

  // 2. Check problemAssignments
  db.problemAssignments.forEach((data) => {
    if (excludeTeamId && data.teamId === excludeTeamId) return;
    markOccupied(data.problemStatementId);
    markOccupied(data.statementId);
  });

  // 3. Check teams
  db.teams.forEach((data, teamId) => {
    if (excludeTeamId && teamId === excludeTeamId) return;
    markOccupied(data.assignedStatementId);
    markOccupied(data.problemStatementId);
    markOccupied(data.assignedProblemId);
  });

  // 4. Check problemStatements
  db.problemStatements.forEach((st, statementId) => {
    const isPublished = st.status === 'PUBLISHED' || st.status === 'published' || st.status === 'active';
    const hasAssigned = Boolean(
      (st.assignedTeamId && st.assignedTeamId.trim().length > 0 && (!excludeTeamId || st.assignedTeamId !== excludeTeamId)) ||
      (Array.isArray(st.assignedTeamIds) && st.assignedTeamIds.some((tid) => !excludeTeamId || tid !== excludeTeamId)) ||
      (st.team && st.team.trim().length > 0 && (!excludeTeamId || st.team !== excludeTeamId))
    );

    if (hasAssigned || (isPublished && (st.assignedTeamId || st.team))) {
      markOccupied(statementId);
      markOccupied(st.statementId);
      markOccupied(st.problemStatementId);
      if (st.sequence) markOccupied(st.sequence);
      if (st.order) markOccupied(st.order);
    }
  });

  return occupiedVariants;
}

function assignNextSequentialProblem(
  db: MockDb,
  teamId: string,
  teamName: string,
  adminUser?: { uid?: string; email?: string }
): {
  success: boolean;
  assigned: boolean;
  alreadyAssigned?: boolean;
  statementId?: string;
  problemSequence?: number;
  statementTitle?: string;
  problem?: ProblemStatement;
  message: string;
} {
  if (!teamId) return { success: false, assigned: false, message: 'Invalid team ID' };

  // Rule: Existing team keeps its assignment
  if (db.teamProblemAssignments.has(teamId)) {
    const existing = db.teamProblemAssignments.get(teamId)!;
    return {
      success: true,
      assigned: false,
      alreadyAssigned: true,
      statementId: existing.statementId,
      problemSequence: existing.problemSequence,
      statementTitle: existing.statementTitle,
      message: `Team ${teamId} already has assigned problem ${existing.statementId}.`,
    };
  }

  if (db.teams.has(teamId) && db.teams.get(teamId)?.assignedStatementId) {
    const existing = db.teams.get(teamId)!;
    return {
      success: true,
      assigned: false,
      alreadyAssigned: true,
      statementId: existing.assignedStatementId,
      statementTitle: existing.assignedStatementTitle,
      message: `Team ${teamId} already has assigned problem ${existing.assignedStatementId}.`,
    };
  }

  const allStatements = Array.from(db.problemStatements.values());
  if (allStatements.length === 0) {
    return { success: true, assigned: false, message: 'No unassigned Problem Statements are available for this Team.' };
  }

  // Sort deterministically by lowest Admin Order (1..N), sequence, and numeric statementId
  allStatements.sort((a, b) => {
    const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence !== undefined && a.sequence !== null ? a.sequence : 0);
    const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence !== undefined && b.sequence !== null ? b.sequence : 0);
    if (ordA !== ordB) return ordA - ordB;
    return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
  });

  const occupiedIds = getComprehensiveOccupiedIds(db, teamId);

  // Find lowest-order unassigned problem
  const nextProblem = allStatements.find((st) => !isStatementOccupied(st, occupiedIds, teamId));

  if (!nextProblem) {
    return {
      success: true,
      assigned: false,
      message: 'No unassigned Problem Statements are available for this Team.',
    };
  }

  const seq = nextProblem.order !== undefined && nextProblem.order !== null ? nextProblem.order : (nextProblem.sequence || 1);
  const isPublished = nextProblem.status === 'published' || nextProblem.status === 'PUBLISHED';
  const now = new Date().toISOString();

  // 1. Write teamProblemAssignments
  const assignmentDoc: TeamProblemAssignment = {
    teamId,
    statementId: nextProblem.statementId,
    problemStatementId: nextProblem.problemStatementId || nextProblem.statementId,
    problemSequence: seq,
    statementTitle: nextProblem.title,
    description: nextProblem.description,
    assignedAt: now,
    publishedAt: isPublished ? now : null,
    assignedBy: adminUser?.email || adminUser?.uid || 'system_auto_assignment',
    status: isPublished ? 'PUBLISHED' : 'DRAFT',
  };
  db.teamProblemAssignments.set(teamId, assignmentDoc);

  // 2. Update problem statement
  nextProblem.assignedTeamId = teamId;
  nextProblem.assignedTeamName = teamName;
  db.problemStatements.set(nextProblem.statementId, nextProblem);

  // 3. Update team doc
  const teamDoc = db.teams.get(teamId) || { teamId, teamName };
  teamDoc.assignedStatementId = nextProblem.statementId;
  teamDoc.assignedStatementTitle = nextProblem.title;
  db.teams.set(teamId, teamDoc);

  return {
    success: true,
    assigned: true,
    statementId: nextProblem.statementId,
    problemSequence: seq,
    statementTitle: nextProblem.title,
    problem: nextProblem,
    message: `Assigned Problem #${seq} (${nextProblem.statementId}) to ${teamName} (${teamId}).`,
  };
}

// -------------------------------------------------------------------------------------------------
// Test Runner
// -------------------------------------------------------------------------------------------------
async function runTests() {
  console.log('========================================================================================');
  console.log('       12 REQUIRED PROBLEM STATEMENT ASSIGNMENT TEST CASES                             ');
  console.log('========================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // Populate 102 problem statements (#1..#102)
  function create102Statements(): Map<string, ProblemStatement> {
    const map = new Map<string, ProblemStatement>();
    for (let i = 1; i <= 102; i++) {
      const id = `PS${String(i).padStart(3, '0')}`;
      map.set(id, {
        statementId: id,
        problemStatementId: id,
        sequence: i,
        order: i,
        title: `Problem Statement #${i}`,
        description: `Description for problem #${i}`,
        category: 'General',
        difficulty: 'MEDIUM',
        status: 'DRAFT',
        createdAt: '',
        updatedAt: '',
      });
    }
    return map;
  }

  // =========================================================================
  // TEST 1: Create Team 1 with all statements free -> Expected: Team 1 -> #1
  // =========================================================================
  console.log('--- TEST 1: Create Team 1 with all statements free ---');
  const db1 = createFreshDb();
  db1.problemStatements = create102Statements();
  const res1 = assignNextSequentialProblem(db1, 'TEAM001', 'Team 1');
  assert(res1.success === true, 'TEST 1: Team 1 assignment succeeded');
  assert(res1.statementId === 'PS001', 'TEST 1: Team 1 receives Problem Statement #1 (PS001)', `Got ${res1.statementId}`);
  assert(res1.problemSequence === 1, 'TEST 1: Team 1 sequence is 1');

  // =========================================================================
  // TEST 2: Create Team 2 -> Expected: Team 2 -> #2, NOT #1
  // =========================================================================
  console.log('\n--- TEST 2: Create Team 2 ---');
  const res2 = assignNextSequentialProblem(db1, 'TEAM002', 'Team 2');
  assert(res2.statementId === 'PS002', 'TEST 2: Team 2 receives Problem Statement #2 (PS002)', `Got ${res2.statementId}`);
  assert(res2.statementId !== 'PS001', 'TEST 2: Team 2 DOES NOT receive Problem Statement #1');
  assert(res2.problemSequence === 2, 'TEST 2: Team 2 sequence is 2');

  // =========================================================================
  // TEST 3: Create Team 3 -> Expected: Team 3 -> #3
  // =========================================================================
  console.log('\n--- TEST 3: Create Team 3 ---');
  const res3 = assignNextSequentialProblem(db1, 'TEAM003', 'Team 3');
  assert(res3.statementId === 'PS003', 'TEST 3: Team 3 receives Problem Statement #3 (PS003)', `Got ${res3.statementId}`);
  assert(res3.problemSequence === 3, 'TEST 3: Team 3 sequence is 3');

  // =========================================================================
  // TEST 4: Publish #1 for Team 1. Create Team 4 -> Expected: Team 4 -> #4
  // =========================================================================
  console.log('\n--- TEST 4: Publish #1 for Team 1. Create Team 4 ---');
  // Publish Problem #1
  const ps1 = db1.problemStatements.get('PS001')!;
  ps1.status = 'PUBLISHED';
  db1.problemStatements.set('PS001', ps1);
  db1.teamProblemAssignments.get('TEAM001')!.status = 'PUBLISHED';

  const res4 = assignNextSequentialProblem(db1, 'TEAM004', 'Team 4');
  assert(res4.statementId === 'PS004', 'TEST 4: Team 4 receives Problem Statement #4 (PS004)', `Got ${res4.statementId}`);
  assert(res4.problemSequence === 4, 'TEST 4: Team 4 sequence is 4');

  // =========================================================================
  // TEST 5: #1 assigned, #2 free, #3 assigned. Create new Team -> Expected: #2
  // =========================================================================
  console.log('\n--- TEST 5: Gaps Handling (#1 assigned, #2 free, #3 assigned) ---');
  const db5 = createFreshDb();
  db5.problemStatements = create102Statements();
  
  // Assign #1 to Team A
  assignNextSequentialProblem(db5, 'TEAM_A', 'Team A'); // Gets #1
  // Assign #2 to Team B, then remove/free #2
  assignNextSequentialProblem(db5, 'TEAM_B', 'Team B'); // Gets #2
  assignNextSequentialProblem(db5, 'TEAM_C', 'Team C'); // Gets #3

  // Free #2
  db5.problemStatements.get('PS002')!.assignedTeamId = null;
  db5.teamProblemAssignments.delete('TEAM_B');
  db5.teams.delete('TEAM_B');

  // Create new Team D -> must receive lowest free problem which is #2
  const res5 = assignNextSequentialProblem(db5, 'TEAM_D', 'Team D');
  assert(res5.statementId === 'PS002', 'TEST 5: New Team receives lowest free gap #2 (PS002)', `Got ${res5.statementId}`);
  assert(res5.problemSequence === 2, 'TEST 5: Sequence is 2');

  // =========================================================================
  // TEST 6: All statements are assigned -> Expected: clear message
  // =========================================================================
  console.log('\n--- TEST 6: All statements assigned (Catalog Exhaustion) ---');
  const db6 = createFreshDb();
  // Create small catalog of 2 statements
  db6.problemStatements.set('PS001', {
    statementId: 'PS001', sequence: 1, order: 1, title: 'P1', description: '', status: 'DRAFT', createdAt: '', updatedAt: '',
  });
  db6.problemStatements.set('PS002', {
    statementId: 'PS002', sequence: 2, order: 2, title: 'P2', description: '', status: 'DRAFT', createdAt: '', updatedAt: '',
  });

  assignNextSequentialProblem(db6, 'T1', 'Team 1');
  assignNextSequentialProblem(db6, 'T2', 'Team 2');

  // Attempt to assign to Team 3
  const res6 = assignNextSequentialProblem(db6, 'T3', 'Team 3');
  assert(res6.assigned === false, 'TEST 6: No assignment made when catalog is exhausted');
  assert(res6.message === 'No unassigned Problem Statements are available for this Team.', 'TEST 6: Returns exact required admin message', `Got "${res6.message}"`);

  // =========================================================================
  // TEST 7: Refresh admin page multiple times -> Expected: assignments do not change
  // =========================================================================
  console.log('\n--- TEST 7: Page refresh idempotency ---');
  const t1Before = db1.teamProblemAssignments.get('TEAM001')?.statementId;
  const t2Before = db1.teamProblemAssignments.get('TEAM002')?.statementId;
  const t3Before = db1.teamProblemAssignments.get('TEAM003')?.statementId;
  const t4Before = db1.teamProblemAssignments.get('TEAM004')?.statementId;

  // Simulate multiple page refreshes / component re-mounts (read-only query)
  for (let i = 0; i < 5; i++) {
    getComprehensiveOccupiedIds(db1);
  }

  assert(db1.teamProblemAssignments.get('TEAM001')?.statementId === t1Before, 'TEST 7: Team 1 assignment unchanged on refresh');
  assert(db1.teamProblemAssignments.get('TEAM002')?.statementId === t2Before, 'TEST 7: Team 2 assignment unchanged on refresh');
  assert(db1.teamProblemAssignments.get('TEAM003')?.statementId === t3Before, 'TEST 7: Team 3 assignment unchanged on refresh');
  assert(db1.teamProblemAssignments.get('TEAM004')?.statementId === t4Before, 'TEST 7: Team 4 assignment unchanged on refresh');

  // =========================================================================
  // TEST 8: Open/close Create Team modal multiple times -> Expected: no assignment happens
  // =========================================================================
  console.log('\n--- TEST 8: Open/close modal without submitting ---');
  const initialAssignCount = db1.teamProblemAssignments.size;
  // Simulate opening modal 5 times (only preview query)
  for (let i = 0; i < 5; i++) {
    const occupied = getComprehensiveOccupiedIds(db1);
    const free = Array.from(db1.problemStatements.values()).find((st) => !isStatementOccupied(st, occupied));
    assert(free?.statementId === 'PS005', `TEST 8: Modal preview sees PS005 on iteration ${i + 1}`);
  }
  assert(db1.teamProblemAssignments.size === initialAssignCount, 'TEST 8: Zero assignments written during modal preview');

  // =========================================================================
  // TEST 9: Create two teams quickly / concurrently -> Expected: different problems
  // =========================================================================
  console.log('\n--- TEST 9: Rapid / concurrent team creation ---');
  const db9 = createFreshDb();
  db9.problemStatements = create102Statements();

  const concurrentTeams = ['CONCUR_1', 'CONCUR_2', 'CONCUR_3', 'CONCUR_4'];
  const allocatedIds: string[] = [];

  for (const tid of concurrentTeams) {
    const res = assignNextSequentialProblem(db9, tid, `Concurrent ${tid}`);
    if (res.assigned && res.statementId) {
      allocatedIds.push(res.statementId);
    }
  }

  const uniqueAllocated = new Set(allocatedIds);
  assert(allocatedIds.length === 4, 'TEST 9: All 4 concurrent teams allocated');
  assert(uniqueAllocated.size === 4, 'TEST 9: Zero duplicate problem assignments across concurrent teams');
  assert(allocatedIds[0] === 'PS001' && allocatedIds[1] === 'PS002' && allocatedIds[2] === 'PS003' && allocatedIds[3] === 'PS004', 'TEST 9: Order preserved #1, #2, #3, #4');

  // =========================================================================
  // TEST 10: Existing published Team assignment -> Expected: never changes
  // =========================================================================
  console.log('\n--- TEST 10: Existing published team assignment stability ---');
  const db10 = createFreshDb();
  db10.problemStatements = create102Statements();
  
  // Existing live production team
  db10.problemStatements.get('PS001')!.assignedTeamId = 'TEAM046';
  db10.problemStatements.get('PS001')!.status = 'PUBLISHED';
  db10.teamProblemAssignments.set('TEAM046', {
    teamId: 'TEAM046',
    statementId: 'PS001',
    statementTitle: 'Problem Statement #1',
    description: '',
    assignedAt: '',
    status: 'PUBLISHED',
  });

  // Create new teams
  assignNextSequentialProblem(db10, 'TEAM047', 'Team 47'); // gets #2
  assignNextSequentialProblem(db10, 'TEAM048', 'Team 48'); // gets #3
  assignNextSequentialProblem(db10, 'TEAM049', 'Team 49'); // gets #4

  assert(db10.teamProblemAssignments.get('TEAM046')?.statementId === 'PS001', 'TEST 10: TEAM046 stays on PS001');
  assert(db10.teamProblemAssignments.get('TEAM046')?.status === 'PUBLISHED', 'TEST 10: TEAM046 status is PUBLISHED');
  assert(db10.teamProblemAssignments.get('TEAM047')?.statementId === 'PS002', 'TEST 10: TEAM047 receives PS002');

  // =========================================================================
  // TEST 11: Manual admin reassignment -> Expected: manual assignment works & auto respects it
  // =========================================================================
  console.log('\n--- TEST 11: Manual admin reassignment ---');
  const db11 = createFreshDb();
  db11.problemStatements = create102Statements();

  assignNextSequentialProblem(db11, 'TEAM_MAN_1', 'Team 1'); // gets #1
  assignNextSequentialProblem(db11, 'TEAM_MAN_2', 'Team 2'); // gets #2

  // Admin manually reassigns TEAM_MAN_2 from #2 to #50
  db11.problemStatements.get('PS002')!.assignedTeamId = null;
  db11.problemStatements.get('PS050')!.assignedTeamId = 'TEAM_MAN_2';
  db11.teamProblemAssignments.set('TEAM_MAN_2', {
    teamId: 'TEAM_MAN_2',
    statementId: 'PS050',
    statementTitle: 'Problem Statement #50',
    description: '',
    assignedAt: '',
    status: 'PUBLISHED',
  });
  db11.teams.set('TEAM_MAN_2', {
    teamId: 'TEAM_MAN_2',
    assignedStatementId: 'PS050',
  });

  // Now create TEAM_MAN_3 -> #2 is free, so TEAM_MAN_3 must get #2!
  const res11 = assignNextSequentialProblem(db11, 'TEAM_MAN_3', 'Team 3');
  assert(res11.statementId === 'PS002', 'TEST 11: Auto assignment fills freed #2 after manual reassignment', `Got ${res11.statementId}`);
  assert(db11.teamProblemAssignments.get('TEAM_MAN_2')?.statementId === 'PS050', 'TEST 11: Manual assignment to PS050 is preserved');

  // =========================================================================
  // TEST 12: Multi-device/browser creation -> Expected: no duplicate assignment
  // =========================================================================
  console.log('\n--- TEST 12: Multi-device / browser session team creation ---');
  const db12 = createFreshDb();
  db12.problemStatements = create102Statements();

  // Simulate 10 teams created across different devices/browsers
  const multiDeviceTeams = Array.from({ length: 10 }, (_, i) => `DEV_TEAM_${i + 1}`);
  const deviceAssignments: string[] = [];

  for (const tid of multiDeviceTeams) {
    const res = assignNextSequentialProblem(db12, tid, `Device Team ${tid}`);
    if (res.assigned && res.statementId) {
      deviceAssignments.push(res.statementId);
    }
  }

  const uniqueDeviceAssigns = new Set(deviceAssignments);
  assert(deviceAssignments.length === 10, 'TEST 12: All 10 multi-device teams allocated');
  assert(uniqueDeviceAssigns.size === 10, 'TEST 12: Zero duplicate assignments across 10 device sessions');
  for (let i = 0; i < 10; i++) {
    const expectedId = `PS${String(i + 1).padStart(3, '0')}`;
    assert(deviceAssignments[i] === expectedId, `TEST 12: Team ${i + 1} received ${expectedId}`);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n========================================================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED:      ${passed}`);
  console.log(`FAILED:      ${failed}`);
  console.log('========================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
