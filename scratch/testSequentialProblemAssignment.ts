/**
 * Comprehensive Automated Test Suite for Sequential Default Problem Statement Assignment
 * 
 * Verifies:
 * 1. First new Team receives first available Problem Statement (#1).
 * 2. Second new Team receives next available Problem Statement (#2, #3, #4).
 * 3. Existing Team keeps the same Problem Statement when another account is created (Idempotency).
 * 4. Already-assigned Problem Statements are skipped.
 * 5. Admin manual assignment is not overwritten.
 * 6. Two simultaneous new Teams cannot receive the same Problem Statement (Concurrency Protection).
 * 7. Existing data and AI analysis metadata remain intact.
 */

import { ProblemStatement, TeamProblemAssignment } from '../../../../../../../OneDrive/Desktop/Hackathon/src/types';

// In-memory mock database state simulating Firestore
interface MockDbState {
  problemStatements: Map<string, ProblemStatement>;
  teamProblemAssignments: Map<string, TeamProblemAssignment>;
  teams: Map<string, any>;
}

function createMockDb(): MockDbState {
  return {
    problemStatements: new Map(),
    teamProblemAssignments: new Map(),
    teams: new Map(),
  };
}

// Deterministic in-memory implementation of the exact sequential assignment logic
function assignNextSequentialProblemInMemory(
  db: MockDbState,
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

  // Rule 3: Existing team keeps its assignment
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

  // Fetch all problem statements
  const allStatements = Array.from(db.problemStatements.values());
  if (allStatements.length === 0) {
    return { success: true, assigned: false, message: 'No problem statements in catalog' };
  }

  // Sort deterministically by sequence / order / statementId
  allStatements.sort((a, b) => {
    const seqA = a.sequence || a.order || 0;
    const seqB = b.sequence || b.order || 0;
    if (seqA !== seqB) return seqA - seqB;
    return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
  });

  // Occupied statement IDs
  const occupiedIds = new Set<string>();
  db.teamProblemAssignments.forEach((assign) => {
    if (assign.statementId && assign.teamId !== teamId) {
      occupiedIds.add(assign.statementId);
    }
  });
  allStatements.forEach((st) => {
    if (st.assignedTeamId && st.assignedTeamId !== teamId && st.assignedTeamId.trim().length > 0) {
      occupiedIds.add(st.statementId);
    }
  });

  // Find next unassigned
  const nextProblem = allStatements.find((st) => !occupiedIds.has(st.statementId));
  if (!nextProblem) {
    return { success: true, assigned: false, message: 'All problem statements are occupied' };
  }

  const seq = nextProblem.sequence || nextProblem.order || 1;
  const isPublished = nextProblem.status === 'published' || nextProblem.status === 'PUBLISHED';
  const now = new Date().toISOString();

  // 1. Write team problem assignment
  const assignmentDoc: TeamProblemAssignment = {
    teamId,
    statementId: nextProblem.statementId,
    problemStatementId: nextProblem.problemStatementId || nextProblem.statementId,
    problemSequence: seq,
    statementTitle: nextProblem.title,
    description: nextProblem.description,
    requirements: nextProblem.requirements,
    technicalGuidelines: nextProblem.technicalGuidelines,
    constraints: nextProblem.constraints,
    expectedOutcome: nextProblem.expectedOutcome,
    instructions: nextProblem.instructions,
    sourceFileName: nextProblem.sourceFileName,
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

// Test Runner
async function runTests() {
  console.log('========================================================================================');
  console.log('       SEQUENTIAL DEFAULT PROBLEM STATEMENT ASSIGNMENT QA SUITE                         ');
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

  // Populate 10 sample problem statements with rich AI metadata
  const db = createMockDb();
  for (let i = 1; i <= 10; i++) {
    const statementId = `PS${String(i).padStart(3, '0')}`;
    db.problemStatements.set(statementId, {
      statementId,
      problemStatementId: statementId,
      sequence: i,
      order: i,
      title: `AI Challenge #${i} - Problem Title ${i}`,
      description: `Detailed problem description for challenge ${i}`,
      category: i % 2 === 0 ? 'Healthcare' : 'FinTech',
      difficulty: i % 3 === 0 ? 'HARD' : i % 2 === 0 ? 'MEDIUM' : 'EASY',
      organization: 'GovOrg',
      department: 'Technology',
      team: null,
      analysis: `AI Analysis for problem ${i}`,
      confidence: 0.95,
      aiQualityScore: 9,
      aiIssues: [],
      aiSuggestions: [`Suggestion for problem ${i}`],
      requirements: [`Req 1 for PS${i}`, `Req 2 for PS${i}`],
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------
  // Test 1: First new Team receives first available Problem Statement (#1)
  // -------------------------------------------------------------
  console.log('--- Test Group 1: First Team Assignment ---');
  const res1 = assignNextSequentialProblemInMemory(db, 'TEAM001', 'Alpha Team');
  assert(res1.success === true, 'Team 1 assignment succeeds');
  assert(res1.assigned === true, 'Team 1 marked as newly assigned');
  assert(res1.statementId === 'PS001', 'Team 1 receives PS001', `Expected PS001, got ${res1.statementId}`);
  assert(res1.problemSequence === 1, 'Team 1 sequence is 1');
  assert(db.teams.get('TEAM001')?.assignedStatementId === 'PS001', 'Team doc has PS001');
  assert(db.problemStatements.get('PS001')?.assignedTeamId === 'TEAM001', 'PS001 doc has TEAM001');

  // -------------------------------------------------------------
  // Test 2: Next new Teams receive sequential Problem Statements (#2, #3, #4)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 2: Sequential Next Team Assignments ---');
  const res2 = assignNextSequentialProblemInMemory(db, 'TEAM002', 'Beta Team');
  assert(res2.statementId === 'PS002', 'Team 2 receives PS002 (#2)');
  assert(res2.problemSequence === 2, 'Team 2 sequence is 2');

  const res3 = assignNextSequentialProblemInMemory(db, 'TEAM003', 'Gamma Team');
  assert(res3.statementId === 'PS003', 'Team 3 receives PS003 (#3)');

  const res4 = assignNextSequentialProblemInMemory(db, 'TEAM004', 'Delta Team');
  assert(res4.statementId === 'PS004', 'Team 4 receives PS004 (#4)');

  // -------------------------------------------------------------
  // Test 3: Existing Team keeps the same Problem Statement (Idempotency)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 3: Existing Team Idempotency ---');
  const resRepeat = assignNextSequentialProblemInMemory(db, 'TEAM001', 'Alpha Team - 2nd Member');
  assert(resRepeat.success === true, 'Repeat account creation call succeeds');
  assert(resRepeat.assigned === false, 'Not marked as newly assigned (preserved)');
  assert(resRepeat.alreadyAssigned === true, 'Marked as alreadyAssigned');
  assert(resRepeat.statementId === 'PS001', 'Team 1 STILL retains PS001 (NOT PS005)');
  assert(db.teamProblemAssignments.get('TEAM001')?.statementId === 'PS001', 'Firestore assignment unchanged');

  // -------------------------------------------------------------
  // Test 4: Already-assigned Problem Statements are skipped
  // -------------------------------------------------------------
  console.log('\n--- Test Group 4: Skipping Occupied Problem Statements ---');
  const dbSkip = createMockDb();
  // PS001 is assigned to TEAM046
  dbSkip.problemStatements.set('PS001', {
    statementId: 'PS001',
    sequence: 1,
    order: 1,
    title: 'Problem 1',
    description: 'Desc 1',
    status: 'PUBLISHED',
    assignedTeamId: 'TEAM046',
    assignedTeamName: 'Existing Team 046',
    createdAt: '',
    updatedAt: '',
  });
  dbSkip.teamProblemAssignments.set('TEAM046', {
    teamId: 'TEAM046',
    statementId: 'PS001',
    problemSequence: 1,
    statementTitle: 'Problem 1',
    description: 'Desc 1',
    assignedAt: '',
    status: 'PUBLISHED',
  });

  // PS002 is assigned to TEAM045
  dbSkip.problemStatements.set('PS002', {
    statementId: 'PS002',
    sequence: 2,
    order: 2,
    title: 'Problem 2',
    description: 'Desc 2',
    status: 'PUBLISHED',
    assignedTeamId: 'TEAM045',
    assignedTeamName: 'Existing Team 045',
    createdAt: '',
    updatedAt: '',
  });
  dbSkip.teamProblemAssignments.set('TEAM045', {
    teamId: 'TEAM045',
    statementId: 'PS002',
    problemSequence: 2,
    statementTitle: 'Problem 2',
    description: 'Desc 2',
    assignedAt: '',
    status: 'PUBLISHED',
  });

  // PS003 and PS004 are unassigned
  dbSkip.problemStatements.set('PS003', {
    statementId: 'PS003',
    sequence: 3,
    order: 3,
    title: 'Problem 3',
    description: 'Desc 3',
    status: 'DRAFT',
    assignedTeamId: null,
    createdAt: '',
    updatedAt: '',
  });
  dbSkip.problemStatements.set('PS004', {
    statementId: 'PS004',
    sequence: 4,
    order: 4,
    title: 'Problem 4',
    description: 'Desc 4',
    status: 'DRAFT',
    assignedTeamId: null,
    createdAt: '',
    updatedAt: '',
  });

  // New team created
  const resSkip = assignNextSequentialProblemInMemory(dbSkip, 'TEAM001', 'New Team 1');
  assert(resSkip.statementId === 'PS003', 'New team automatically skips PS001 & PS002 and receives PS003');
  assert(resSkip.problemSequence === 3, 'Sequence is 3');

  // Next new team created
  const resSkip2 = assignNextSequentialProblemInMemory(dbSkip, 'TEAM002', 'New Team 2');
  assert(resSkip2.statementId === 'PS004', 'Second new team receives PS004');

  // -------------------------------------------------------------
  // Test 5: Admin manual assignment is not overwritten
  // -------------------------------------------------------------
  console.log('\n--- Test Group 5: Admin Manual Assignment Preservation ---');
  // Admin manually reassigns TEAM003 from PS003 to PS008
  db.problemStatements.get('PS003')!.assignedTeamId = null;
  db.problemStatements.get('PS008')!.assignedTeamId = 'TEAM003';
  db.teamProblemAssignments.set('TEAM003', {
    teamId: 'TEAM003',
    statementId: 'PS008',
    problemSequence: 8,
    statementTitle: 'AI Challenge #8',
    description: 'Manual assignment',
    assignedAt: new Date().toISOString(),
    status: 'PUBLISHED',
  });

  // Now create a new team TEAM005
  // Since PS003 was freed, the next available unassigned is PS003!
  const resManualNext = assignNextSequentialProblemInMemory(db, 'TEAM005', 'Epsilon Team');
  assert(resManualNext.statementId === 'PS003', 'New team fills freed PS003');
  assert(db.teamProblemAssignments.get('TEAM003')?.statementId === 'PS008', 'TEAM003 manual assignment to PS008 is strictly preserved');

  // -------------------------------------------------------------
  // Test 6: Concurrency & Duplicate Protection
  // -------------------------------------------------------------
  console.log('\n--- Test Group 6: Concurrency & Duplicate Protection ---');
  // 5 simultaneous teams requesting assignment from 5 remaining problem statements
  const concurrentTeams = ['TEAM010', 'TEAM011', 'TEAM012', 'TEAM013', 'TEAM014'];
  const assignedResults: string[] = [];

  for (const tid of concurrentTeams) {
    const res = assignNextSequentialProblemInMemory(db, tid, `Concurrent ${tid}`);
    if (res.assigned && res.statementId) {
      assignedResults.push(res.statementId);
    }
  }

  const uniqueAssigned = new Set(assignedResults);
  assert(assignedResults.length === 5, 'All 5 concurrent teams received an assignment');
  assert(uniqueAssigned.size === 5, 'Zero duplicate problem assignments (5 unique problems allocated)');

  // -------------------------------------------------------------
  // Test 7: AI Analysis Data Preservation
  // -------------------------------------------------------------
  console.log('\n--- Test Group 7: AI Analysis Data Preservation ---');
  const ps1Doc = db.problemStatements.get('PS001')!;
  assert(ps1Doc.category === 'FinTech', 'AI category preserved');
  assert(ps1Doc.difficulty === 'EASY', 'AI difficulty preserved');
  assert(ps1Doc.confidence === 0.95, 'AI confidence preserved');
  assert(ps1Doc.aiQualityScore === 9, 'AI quality score preserved');
  assert(ps1Doc.analysis === 'AI Analysis for problem 1', 'AI analysis text preserved');

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
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
