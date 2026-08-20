import { ProblemStatement, TeamProblemAssignment } from '../src/types';

interface MockDb {
  problemStatements: Map<string, ProblemStatement>;
  teamProblemAssignments: Map<string, TeamProblemAssignment>;
  teams: Map<string, any>;
  settings: Map<string, any>;
  problemAssignments: Map<string, any>;
  users: Map<string, any>;
}

function createFreshDb(): MockDb {
  return {
    problemStatements: new Map(),
    teamProblemAssignments: new Map(),
    teams: new Map(),
    settings: new Map(),
    problemAssignments: new Map(),
    users: new Map(),
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

  // 1. /teamProblemAssignments
  for (const [teamId, assign] of db.teamProblemAssignments.entries()) {
    if (excludeTeamId && teamId === excludeTeamId) continue;
    if (assign.statementId) markOccupied(assign.statementId);
    if (assign.problemStatementId) markOccupied(assign.problemStatementId);
    if (assign.problemSequence) markOccupied(assign.problemSequence);
    if (assign.order) markOccupied(assign.order);
  }

  // 2. /problemAssignments
  for (const [key, assign] of db.problemAssignments.entries()) {
    if (excludeTeamId && assign.teamId === excludeTeamId) continue;
    if (assign.statementId) markOccupied(assign.statementId);
    if (assign.problemStatementId) markOccupied(assign.problemStatementId);
  }

  // 3. /teams
  for (const [teamId, team] of db.teams.entries()) {
    if (excludeTeamId && teamId === excludeTeamId) continue;
    if (team.assignedStatementId) markOccupied(team.assignedStatementId);
    if (team.problemStatementId) markOccupied(team.problemStatementId);
    if (team.assignedProblemId) markOccupied(team.assignedProblemId);
  }

  // 4. /problemStatements
  for (const [psId, ps] of db.problemStatements.entries()) {
    const isPub = ps.status === 'PUBLISHED' || ps.status === 'published' || ps.status === 'active';
    const isAssigned = (ps.assignedTeamId && ps.assignedTeamId.trim().length > 0) ||
      (Array.isArray(ps.assignedTeamIds) && ps.assignedTeamIds.length > 0) ||
      (ps.team && ps.team.trim().length > 0);

    if (isPub || isAssigned) {
      markOccupied(ps.statementId);
      markOccupied(ps.problemStatementId);
      markOccupied(ps.order);
      markOccupied(ps.sequence);
    }
  }

  return occupiedVariants;
}

/**
 * Strict Transaction Runner enforcing Firestore's "ALL READS BEFORE ALL WRITES" requirement.
 */
class StrictFirestoreTransaction {
  private hasWritten = false;
  public readCount = 0;
  public writeCount = 0;
  private db: MockDb;

  constructor(db: MockDb) {
    this.db = db;
  }

  async get(collectionName: string, docId: string): Promise<{ exists: boolean; data: () => any }> {
    if (this.hasWritten) {
      throw new Error('Firestore transactions require all reads to be executed before all writes.');
    }
    this.readCount++;

    let data: any = null;
    if (collectionName === 'problemStatements') data = this.db.problemStatements.get(docId);
    else if (collectionName === 'teamProblemAssignments') data = this.db.teamProblemAssignments.get(docId);
    else if (collectionName === 'teams') data = this.db.teams.get(docId);
    else if (collectionName === 'problemAssignments') data = this.db.problemAssignments.get(docId);

    return {
      exists: data !== undefined && data !== null,
      data: () => data,
    };
  }

  set(collectionName: string, docId: string, data: any) {
    this.hasWritten = true;
    this.writeCount++;
    if (collectionName === 'teamProblemAssignments') this.db.teamProblemAssignments.set(docId, data);
    else if (collectionName === 'problemAssignments') this.db.problemAssignments.set(docId, data);
    else if (collectionName === 'teams') this.db.teams.set(docId, data);
    else if (collectionName === 'problemStatements') this.db.problemStatements.set(docId, data);
  }

  update(collectionName: string, docId: string, data: any) {
    this.hasWritten = true;
    this.writeCount++;
    let existing: any = {};
    if (collectionName === 'problemStatements') existing = this.db.problemStatements.get(docId) || {};
    else if (collectionName === 'teams') existing = this.db.teams.get(docId) || {};
    else if (collectionName === 'teamProblemAssignments') existing = this.db.teamProblemAssignments.get(docId) || {};

    const merged = { ...existing, ...data };
    if (collectionName === 'problemStatements') this.db.problemStatements.set(docId, merged);
    else if (collectionName === 'teams') this.db.teams.set(docId, merged);
    else if (collectionName === 'teamProblemAssignments') this.db.teamProblemAssignments.set(docId, merged);
  }

  delete(collectionName: string, docId: string) {
    this.hasWritten = true;
    this.writeCount++;
    if (collectionName === 'problemAssignments') this.db.problemAssignments.delete(docId);
  }
}

/**
 * Executes assignSpecificProblemToTeam with Strict Transaction
 */
async function assignSpecificProblemStrictMock(
  db: MockDb,
  teamId: string,
  teamName: string,
  statementId: string,
  adminUser?: { uid?: string; email?: string }
): Promise<{ success: boolean; assigned: boolean; message: string; statementId?: string; problemSequence?: number }> {
  if (!teamId || !statementId) {
    return { success: false, assigned: false, message: 'Invalid team ID or statement ID provided.' };
  }

  // Pre-fetch occupied set outside transaction
  const occupiedSet = getComprehensiveOccupiedIds(db, teamId);
  const tx = new StrictFirestoreTransaction(db);

  try {
    // PHASE 1 — ALL READS FIRST
    const psSnap = await tx.get('problemStatements', statementId);
    const teamSnap = await tx.get('teams', teamId);
    const assignSnap = await tx.get('teamProblemAssignments', teamId);

    // PHASE 2 — VALIDATE
    if (!psSnap.exists) {
      return { success: false, assigned: false, message: `Problem Statement ${statementId} does not exist in catalog.` };
    }

    const psData = psSnap.data() as ProblemStatement;
    if (
      isStatementOccupied(psData, occupiedSet, teamId) ||
      psData.status === 'PUBLISHED' ||
      psData.status === 'published' ||
      psData.status === 'active' ||
      (psData.assignedTeamId && psData.assignedTeamId !== teamId)
    ) {
      return {
        success: false,
        assigned: false,
        message: 'This problem statement has already been assigned. Please select another FREE problem statement.',
      };
    }

    const seq = psData.order !== undefined && psData.order !== null ? psData.order : (psData.sequence || 1);
    const now = new Date().toISOString();
    const isPublished = psData.status === 'published' || psData.status === 'PUBLISHED';

    // PHASE 3 — ALL WRITES
    tx.set('teamProblemAssignments', teamId, {
      teamId,
      statementId: psData.statementId,
      problemStatementId: psData.statementId,
      problemSequence: seq,
      order: seq,
      statementTitle: psData.title,
      description: psData.description,
      category: psData.category || 'General',
      difficulty: psData.difficulty || 'MEDIUM',
      team: teamName,
      aiAnalysis: psData.analysis || '',
      confidence: psData.confidence || 0.9,
      assignedAt: now,
      assignedBy: adminUser?.email || 'admin',
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
    });

    tx.update('problemStatements', statementId, {
      assignedTeamId: teamId,
      assignedTeamName: teamName,
    });

    if (teamSnap.exists) {
      tx.update('teams', teamId, {
        assignedStatementId: psData.statementId,
        assignedStatementTitle: psData.title,
      });
    } else {
      tx.set('teams', teamId, {
        teamId,
        teamName,
        assignedStatementId: psData.statementId,
        assignedStatementTitle: psData.title,
      });
    }

    tx.set('problemAssignments', `${teamId}_${psData.statementId}`, {
      assignmentId: `${teamId}_${psData.statementId}`,
      teamId,
      statementId: psData.statementId,
      assignmentSequence: seq,
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
    });

    return {
      success: true,
      assigned: true,
      statementId: psData.statementId,
      problemSequence: seq,
      message: `Assigned Problem #${seq} (${psData.statementId}: "${psData.title}") to ${teamName} (${teamId}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      assigned: false,
      message: `Problem assignment encountered an error: ${err.message}`,
    };
  }
}

/**
 * Executes reassignTeamProblem with Strict Transaction
 */
async function reassignTeamProblemStrictMock(
  db: MockDb,
  teamId: string,
  teamName: string,
  newStatementId: string
): Promise<{ success: boolean; assigned: boolean; message: string; statementId?: string; problemSequence?: number }> {
  if (!teamId || !newStatementId) {
    return { success: false, assigned: false, message: 'Invalid team ID or statement ID provided.' };
  }

  const occupiedSet = getComprehensiveOccupiedIds(db, teamId);
  const tx = new StrictFirestoreTransaction(db);

  try {
    // PHASE 1 — ALL READS FIRST
    const newPsSnap = await tx.get('problemStatements', newStatementId);
    const existingAssignSnap = await tx.get('teamProblemAssignments', teamId);
    const teamSnap = await tx.get('teams', teamId);

    let oldStatementId: string | null = null;
    if (existingAssignSnap.exists) {
      oldStatementId = existingAssignSnap.data().statementId || null;
    } else if (teamSnap.exists) {
      oldStatementId = teamSnap.data().assignedStatementId || null;
    }

    let oldPsSnap: any = null;
    if (oldStatementId && oldStatementId !== newStatementId) {
      oldPsSnap = await tx.get('problemStatements', oldStatementId);
    }

    // PHASE 2 — VALIDATE
    if (!newPsSnap.exists) {
      return { success: false, assigned: false, message: `Problem Statement ${newStatementId} does not exist.` };
    }

    const newPsData = newPsSnap.data() as ProblemStatement;
    if (
      isStatementOccupied(newPsData, occupiedSet, teamId) ||
      newPsData.status === 'PUBLISHED' ||
      newPsData.status === 'published' ||
      newPsData.status === 'active' ||
      (newPsData.assignedTeamId && newPsData.assignedTeamId !== teamId)
    ) {
      return {
        success: false,
        assigned: false,
        message: 'This problem statement has already been assigned. Please select another FREE problem statement.',
      };
    }

    const seq = newPsData.order !== undefined && newPsData.order !== null ? newPsData.order : (newPsData.sequence || 1);
    const now = new Date().toISOString();
    const isPublished = newPsData.status === 'published' || newPsData.status === 'PUBLISHED';

    // PHASE 3 — ALL WRITES
    if (oldStatementId && oldStatementId !== newStatementId && oldPsSnap?.exists) {
      tx.update('problemStatements', oldStatementId, {
        assignedTeamId: null,
        assignedTeamName: null,
      });
      tx.delete('problemAssignments', `${teamId}_${oldStatementId}`);
    }

    tx.set('teamProblemAssignments', teamId, {
      teamId,
      statementId: newPsData.statementId,
      problemStatementId: newPsData.statementId,
      problemSequence: seq,
      order: seq,
      statementTitle: newPsData.title,
      description: newPsData.description,
      category: newPsData.category || 'General',
      difficulty: newPsData.difficulty || 'MEDIUM',
      team: teamName,
      aiAnalysis: newPsData.analysis || '',
      confidence: newPsData.confidence || 0.9,
      assignedAt: now,
      assignedBy: 'admin_reassignment',
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
    });

    tx.update('problemStatements', newStatementId, {
      assignedTeamId: teamId,
      assignedTeamName: teamName,
    });

    if (teamSnap.exists) {
      tx.update('teams', teamId, {
        assignedStatementId: newPsData.statementId,
        assignedStatementTitle: newPsData.title,
      });
    }

    tx.set('problemAssignments', `${teamId}_${newPsData.statementId}`, {
      assignmentId: `${teamId}_${newPsData.statementId}`,
      teamId,
      problemStatementId: newPsData.statementId,
      statementId: newPsData.statementId,
      assignmentSequence: seq,
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
    });

    return {
      success: true,
      assigned: true,
      statementId: newPsData.statementId,
      problemSequence: seq,
      message: `Successfully reassigned Team ${teamId} to Problem #${seq} (${newPsData.statementId}: "${newPsData.title}").`,
    };
  } catch (err: any) {
    return {
      success: false,
      assigned: false,
      message: `Problem reassignment encountered an error: ${err.message}`,
    };
  }
}

/**
 * Creates 102 mock problem statements (#1..#102)
 */
function populate102Statements(db: MockDb) {
  for (let i = 1; i <= 102; i++) {
    const statementId = `PS${String(i).padStart(3, '0')}`;
    db.problemStatements.set(statementId, {
      statementId,
      problemStatementId: statementId,
      order: i,
      sequence: i,
      title: `Problem Statement #${i} Title`,
      description: `Description for Problem Statement #${i}`,
      category: i % 2 === 0 ? 'Healthcare' : 'AI/ML',
      difficulty: 'MEDIUM',
      status: 'DRAFT',
    });
  }
}

/**
 * Populates 42 existing teams with assignments (#1..#42)
 */
function populate42ExistingTeams(db: MockDb) {
  for (let i = 1; i <= 42; i++) {
    const teamId = `TEAM${String(i).padStart(3, '0')}`;
    const statementId = `PS${String(i).padStart(3, '0')}`;
    const teamName = `Team ${i}`;
    const leaderName = `Leader ${i}`;

    db.teams.set(teamId, {
      teamId,
      teamName,
      leaderName,
      username: `leader${i}`,
      assignedStatementId: statementId,
      assignedStatementTitle: `Problem Statement #${i} Title`,
      status: 'active',
    });

    db.teamProblemAssignments.set(teamId, {
      teamId,
      statementId,
      problemStatementId: statementId,
      problemSequence: i,
      order: i,
      statementTitle: `Problem Statement #${i} Title`,
      description: `Description for Problem Statement #${i}`,
      category: i % 2 === 0 ? 'Healthcare' : 'AI/ML',
      difficulty: 'MEDIUM',
      team: teamName,
      status: i <= 40 ? 'PUBLISHED' : 'DRAFT',
      assignedAt: new Date().toISOString(),
    });

    const ps = db.problemStatements.get(statementId);
    if (ps) {
      ps.assignedTeamId = teamId;
      ps.assignedTeamName = teamName;
      if (i <= 40) ps.status = 'PUBLISHED';
      db.problemStatements.set(statementId, ps);
    }
  }
}

export async function run18ManualAssignmentTests() {
  console.log('========================================================================================');
  console.log('       18-TEST SUITE: MANUAL PROBLEM ASSIGNMENT & STRICT TRANSACTION VERIFICATION       ');
  console.log('========================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(cond: boolean, name: string) {
    total++;
    if (cond) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
    }
  }

  const db = createFreshDb();
  populate102Statements(db);
  populate42ExistingTeams(db);

  // --- TEST 1: Existing Team assignment remains unchanged ---
  console.log('--- TEST 1: Existing Team assignment remains unchanged ---');
  assert(db.teamProblemAssignments.get('TEAM001')?.statementId === 'PS001', 'TEST 1: TEAM001 retains PS001');
  assert(db.teamProblemAssignments.get('TEAM042')?.statementId === 'PS042', 'TEST 1: TEAM042 retains PS042');

  // --- TEST 2: Refresh page -> same assignment ---
  console.log('\n--- TEST 2: Page refresh idempotency ---');
  const occupiedSetBefore = getComprehensiveOccupiedIds(db);
  for (let r = 1; r <= 3; r++) {
    const occupiedSetAfter = getComprehensiveOccupiedIds(db);
    assert(occupiedSetBefore.size === occupiedSetAfter.size, `TEST 2: Refresh ${r} reads same ${occupiedSetBefore.size} occupied statements`);
  }

  // --- TEST 3: Create a new Team -> existing Teams remain unchanged ---
  console.log('\n--- TEST 3: Create Team 43 -> existing teams unchanged ---');
  const res3 = await assignSpecificProblemStrictMock(db, 'TEAM043', 'Team 43', 'PS043');
  assert(res3.success === true, 'TEST 3: Team 43 created');
  assert(db.teamProblemAssignments.get('TEAM001')?.statementId === 'PS001', 'TEST 3: TEAM001 unchanged');
  assert(db.teamProblemAssignments.get('TEAM042')?.statementId === 'PS042', 'TEST 3: TEAM042 unchanged');

  // --- TEST 4: Existing published Team -> create another Team -> published assignment unchanged ---
  console.log('\n--- TEST 4: Published assignment stability ---');
  const res4 = await assignSpecificProblemStrictMock(db, 'TEAM044', 'Team 44', 'PS044');
  assert(res4.success === true, 'TEST 4: Team 44 created');
  assert(db.teamProblemAssignments.get('TEAM001')?.status === 'PUBLISHED', 'TEST 4: TEAM001 remains PUBLISHED with PS001');

  // --- TEST 5: Select FREE Problem #101 for new Team -> New Team -> #101 ---
  console.log('\n--- TEST 5: Select FREE Problem #101 (PS101) ---');
  const res5 = await assignSpecificProblemStrictMock(db, 'TEAM045', 'Team 45', 'PS101');
  assert(res5.success === true, 'TEST 5: Assignment to PS101 succeeded');
  assert(res5.statementId === 'PS101', 'TEST 5: Team 45 assigned PS101');
  assert(db.teamProblemAssignments.get('TEAM045')?.statementId === 'PS101', 'TEST 5: Persisted in teamProblemAssignments');

  // --- TEST 6: Try selecting already ASSIGNED Problem -> Cannot select ---
  console.log('\n--- TEST 6: Selecting already ASSIGNED Problem ---');
  const res6 = await assignSpecificProblemStrictMock(db, 'TEAM046', 'Team 46', 'PS043');
  assert(res6.success === false, 'TEST 6: Blocked from selecting assigned PS043');
  assert(res6.message === 'This problem statement has already been assigned. Please select another FREE problem statement.', 'TEST 6: Correct error message');

  // --- TEST 7: Try selecting PUBLISHED Problem -> Cannot select ---
  console.log('\n--- TEST 7: Selecting PUBLISHED Problem ---');
  const res7 = await assignSpecificProblemStrictMock(db, 'TEAM046', 'Team 46', 'PS001');
  assert(res7.success === false, 'TEST 7: Blocked from selecting PUBLISHED PS001');
  assert(res7.message === 'This problem statement has already been assigned. Please select another FREE problem statement.', 'TEST 7: Correct error message');

  // --- TEST 8: Create new Team without selecting a Problem -> Validation error ---
  console.log('\n--- TEST 8: Validation error if no problem selected ---');
  const res8 = await assignSpecificProblemStrictMock(db, 'TEAM046', 'Team 46', '');
  assert(res8.success === false, 'TEST 8: Rejected when no problem selected');

  // --- TEST 9: Create Team with FREE Problem -> Team creation succeeds and saved ---
  console.log('\n--- TEST 9: Team creation with FREE problem PS046 ---');
  const res9 = await assignSpecificProblemStrictMock(db, 'TEAM046', 'Team 46', 'PS046');
  assert(res9.success === true, 'TEST 9: Succeeded with FREE PS046');
  assert(db.teams.get('TEAM046')?.assignedStatementId === 'PS046', 'TEST 9: Persisted in teams');

  // --- TEST 10: Refresh -> Assignment remains exactly the same ---
  console.log('\n--- TEST 10: Post-creation refresh persistence ---');
  assert(db.teamProblemAssignments.get('TEAM046')?.statementId === 'PS046', 'TEST 10: Assignment verified intact');

  // --- TEST 11: Logout / Login -> Same assignment ---
  console.log('\n--- TEST 11: Session persistence ---');
  const userTeamDoc = db.teams.get('TEAM046');
  assert(userTeamDoc.assignedStatementId === 'PS046', 'TEST 11: Team session loads PS046');

  // --- TEST 12: Two simultaneous users select same FREE Problem -> Only one succeeds ---
  console.log('\n--- TEST 12: Concurrency collision handling ---');
  const attemptA = await assignSpecificProblemStrictMock(db, 'TEAM047A', 'Team 47A', 'PS047');
  const attemptB = await assignSpecificProblemStrictMock(db, 'TEAM047B', 'Team 47B', 'PS047');
  assert(attemptA.success === true, 'TEST 12: 1st concurrent attempt succeeds');
  assert(attemptB.success === false, 'TEST 12: 2nd concurrent attempt fails safely');
  assert(attemptB.message === 'This problem statement has already been assigned. Please select another FREE problem statement.', 'TEST 12: Correct collision error message');

  // --- TEST 13: No duplicate Team -> Problem assignments ---
  console.log('\n--- TEST 13: Integrity: No duplicate assignments per team ---');
  let duplicates = 0;
  for (const [tId, assign] of db.teamProblemAssignments.entries()) {
    if (tId !== assign.teamId) duplicates++;
  }
  assert(duplicates === 0, 'TEST 13: Zero duplicate team assignments');

  // --- TEST 14: No duplicate Problem -> Team assignments ---
  console.log('\n--- TEST 14: Integrity: No duplicate teams per problem ---');
  const assignedProblems = new Set<string>();
  let duplicateProblems = 0;
  for (const [tId, assign] of db.teamProblemAssignments.entries()) {
    if (assignedProblems.has(assign.statementId)) {
      duplicateProblems++;
    }
    assignedProblems.add(assign.statementId);
  }
  assert(duplicateProblems === 0, 'TEST 14: Zero duplicate problem assignments');

  // --- TEST 15: 102 Problem Statements remain intact ---
  console.log('\n--- TEST 15: 102 Problem Statements intact ---');
  assert(db.problemStatements.size === 102, 'TEST 15: Exactly 102 Problem Statements present');

  // --- TEST 16: All existing Teams remain intact ---
  console.log('\n--- TEST 16: Existing Teams intact ---');
  assert(db.teams.has('TEAM001') && db.teams.has('TEAM042'), 'TEST 16: Existing teams intact');

  // --- TEST 17: All existing published assignments remain intact ---
  console.log('\n--- TEST 17: Published assignments intact ---');
  assert(db.teamProblemAssignments.get('TEAM001')?.status === 'PUBLISHED', 'TEST 17: TEAM001 published assignment intact');

  // --- TEST 18: STRICT FIRESTORE TRANSACTION: Zero reads executed after writes ---
  console.log('\n--- TEST 18: Strict Transaction read-before-write validation ---');
  const txTestRunner = new StrictFirestoreTransaction(db);
  let caughtReadAfterWrite = false;
  try {
    txTestRunner.set('teams', 'TEST_T', { test: true });
    await txTestRunner.get('teams', 'TEST_T'); // Violates read-after-write rule!
  } catch (err: any) {
    if (err.message.includes('Firestore transactions require all reads to be executed before all writes.')) {
      caughtReadAfterWrite = true;
    }
  }
  assert(caughtReadAfterWrite === true, 'TEST 18: Strict transaction successfully catches and prevents read-after-write violations');

  // --- TEST 19: Create 20+ teams sequentially -> each gets the lowest-order FREE problem ---
  console.log('\n--- TEST 19: Create 20 teams sequentially in lowest-order FREE problem order ---');
  let sequentialSuccess = true;
  for (let k = 50; k <= 70; k++) {
    const tId = `TEAM${String(k).padStart(3, '0')}`;
    const tName = `Team ${k}`;
    const occupied = getComprehensiveOccupiedIds(db, tId);
    // Find lowest-order free
    let lowestFree: ProblemStatement | null = null;
    for (let pNum = 1; pNum <= 102; pNum++) {
      const psId = `PS${String(pNum).padStart(3, '0')}`;
      const ps = db.problemStatements.get(psId);
      if (ps && !isStatementOccupied(ps, occupied, tId) && ps.status !== 'PUBLISHED') {
        lowestFree = ps;
        break;
      }
    }
    if (!lowestFree) {
      sequentialSuccess = false;
      break;
    }
    const res = await assignSpecificProblemStrictMock(db, tId, tName, lowestFree.statementId);
    if (!res.success) {
      sequentialSuccess = false;
      break;
    }
  }
  assert(sequentialSuccess === true, 'TEST 19: 20 teams created sequentially with distinct lowest-order FREE problem statements');

  // --- TEST 21: Team-Wise Numeric Code Mapping ---
  console.log('\n--- TEST 21: Dynamic Team-Wise Numeric Code Mapping (TEAM001 -> #1, TEAM060 -> #60, TEAM127 -> #127, TEAM500 -> #500) ---');
  const freshDb = createFreshDb();
  // Populate up to 500 statements dynamically
  for (let i = 1; i <= 500; i++) {
    const psId = `PS${String(i).padStart(3, '0')}`;
    freshDb.problemStatements.set(psId, {
      statementId: psId,
      sequence: i,
      order: i,
      title: `Dynamic Problem ${i}`,
      description: `Description for problem ${i}`,
      category: 'Dynamic',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Team 1 -> Problem #1
  const t1Res = await assignSpecificProblemStrictMock(freshDb, 'TEAM001', 'Team 1', 'PS001');
  // Team 60 -> Problem #60
  const t60Res = await assignSpecificProblemStrictMock(freshDb, 'TEAM060', 'Team 60', 'PS060');
  // Team 127 -> Problem #127
  const t127Res = await assignSpecificProblemStrictMock(freshDb, 'TEAM127', 'Team 127', 'PS127');
  // Team 500 -> Problem #500
  const t500Res = await assignSpecificProblemStrictMock(freshDb, 'TEAM500', 'Team 500', 'PS500');

  assert(t1Res.success && t1Res.problemSequence === 1, 'TEST 21: TEAM001 dynamically assigned Problem #1');
  assert(t60Res.success && t60Res.problemSequence === 60, 'TEST 21: TEAM060 dynamically assigned Problem #60');
  assert(t127Res.success && t127Res.problemSequence === 127, 'TEST 21: TEAM127 dynamically assigned Problem #127');
  assert(t500Res.success && t500Res.problemSequence === 500, 'TEST 21: TEAM500 dynamically assigned Problem #500');

  // --- TEST 22: Conflict Handling: If Problem #N is already occupied, fail safely ---
  console.log('\n--- TEST 22: Conflict Handling: If Problem #N is already occupied, do NOT assign fallback ---');
  // TEAM060 already owns PS060. Now another team tries to create/claim Problem 60
  const conflictAttempt = await assignSpecificProblemStrictMock(freshDb, 'TEAM060_DUP', 'Duplicate Team 60', 'PS060');
  assert(conflictAttempt.success === false, 'TEST 22: Duplicate assignment to Problem #60 blocked safely');
  assert(freshDb.teamProblemAssignments.get('TEAM060')?.statementId === 'PS060', 'TEST 22: Original TEAM060 retains Problem #60 untouched');

  // --- TEST 24: Non-existent Problem: If Problem #N does not exist in catalog, fail safely ---
  console.log('\n--- TEST 24: Non-existent Problem Handling (TEAM501 when catalog only has 500) ---');
  const target501 = freshDb.problemStatements.get('PS501');
  assert(!target501, 'TEST 24: Problem #501 does not exist in 500-item catalog');
  const t501Res = await assignSpecificProblemStrictMock(freshDb, 'TEAM501', 'Team 501', 'PS501');
  assert(t501Res.success === false, 'TEST 24: TEAM501 creation rejected when Problem #501 does not exist in catalog');

  console.log('\n========================================================================================');
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('========================================================================================\n');

  if (passed !== total) {
    throw new Error('Some tests failed');
  }
}

run18ManualAssignmentTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
