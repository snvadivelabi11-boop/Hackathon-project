import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { logAudit } from '../audit/auditLogger';
import { verifyAdmin } from '../utils/adminAuth';

/**
 * Normalizes a leader name into a clean username (e.g. "Abhishek Kumar" -> "abhishekkumar")
 */
function normalizeUsername(name: string): string {
  let clean = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
  return clean || 'team';
}

/**
 * Finds the next available unique username by appending 2, 3, etc. if conflicts exist.
 */
async function getUniqueUsername(db: admin.firestore.Firestore, baseUsername: string): Promise<string> {
  let candidate = baseUsername;
  let counter = 2;

  while (true) {
    const email = `${candidate}@hackathon.internal`;

    // Check in Firestore users & teams collection
    const [userSnap, teamSnap] = await Promise.all([
      db.collection('users').where('username', '==', candidate).limit(1).get(),
      db.collection('teams').where('username', '==', candidate).limit(1).get(),
    ]);

    // Check in Firebase Authentication
    let authUserExists = false;
    try {
      await admin.auth().getUserByEmail(email);
      authUserExists = true;
    } catch {
      authUserExists = false;
    }

    if (userSnap.empty && teamSnap.empty && !authUserExists) {
      return candidate;
    }

    candidate = `${baseUsername}${counter}`;
    counter++;
  }
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

async function getComprehensiveOccupiedStatementIdsBackend(db: FirebaseFirestore.Firestore, excludeTeamId?: string): Promise<Set<string>> {
  const occupiedVariants = new Set<string>();

  const markOccupied = (rawId: string | number | null | undefined) => {
    if (!rawId) return;
    const variants = extractIdVariants(rawId);
    variants.forEach((v) => occupiedVariants.add(v));
  };

  try {
    const [teamAssignsSnap, problemAssignsSnap, teamsSnap, draftSnap, psSnap] = await Promise.all([
      db.collection('teamProblemAssignments').get().catch(() => null),
      db.collection('problemAssignments').get().catch(() => null),
      db.collection('teams').get().catch(() => null),
      db.collection('settings').doc('problemDistributionDraft').get().catch(() => null),
      db.collection('problemStatements').get().catch(() => null),
    ]);

    if (teamAssignsSnap) {
      teamAssignsSnap.forEach((d) => {
        const data = d.data();
        const teamId = data.teamId || d.id;
        if (excludeTeamId && teamId === excludeTeamId) return;
        markOccupied(data.statementId);
        markOccupied(data.problemStatementId);
        markOccupied(data.problemId);
        if (data.problemSequence) markOccupied(data.problemSequence);
      });
    }

    if (problemAssignsSnap) {
      problemAssignsSnap.forEach((d) => {
        const data = d.data();
        if (excludeTeamId && data.teamId === excludeTeamId) return;
        markOccupied(data.problemStatementId);
        markOccupied(data.statementId);
        if (data.assignmentSequence) markOccupied(data.assignmentSequence);
      });
    }

    if (teamsSnap) {
      teamsSnap.forEach((d) => {
        const teamId = d.id;
        if (excludeTeamId && teamId === excludeTeamId) return;
        const data = d.data();
        markOccupied(data.assignedStatementId);
        markOccupied(data.problemStatementId);
        markOccupied(data.assignedProblemId);
      });
    }

    if (draftSnap && draftSnap.exists) {
      const draftData = draftSnap.data() as any;
      if (Array.isArray(draftData?.mapping)) {
        draftData.mapping.forEach((group: any) => {
          if (Array.isArray(group.assignedTeams) && group.assignedTeams.length > 0) {
            const hasOtherTeam = excludeTeamId
              ? group.assignedTeams.some((t: any) => (t.teamId || t) !== excludeTeamId)
              : true;
            if (hasOtherTeam) {
              markOccupied(group.statementId);
              markOccupied(group.problemStatementId);
            }
          }
        });
      }
    }

    if (psSnap) {
      psSnap.forEach((d) => {
        const st = d.data() as any;
        const statementId = d.id;
        const isPublished = st.status === 'PUBLISHED' || st.status === 'published' || st.status === 'active';

        const hasAssignedTeam = Boolean(
          (st.assignedTeamId && String(st.assignedTeamId).trim().length > 0 && (!excludeTeamId || st.assignedTeamId !== excludeTeamId)) ||
          (Array.isArray(st.assignedTeamIds) && st.assignedTeamIds.some((tid: any) => !excludeTeamId || tid !== excludeTeamId)) ||
          (Array.isArray(st.assignedTeams) && st.assignedTeams.some((t: any) => !excludeTeamId || (t.teamId || t) !== excludeTeamId)) ||
          (st.team && String(st.team).trim().length > 0 && (!excludeTeamId || st.team !== excludeTeamId))
        );

        if (hasAssignedTeam || (isPublished && (st.assignedTeamId || st.team))) {
          markOccupied(statementId);
          markOccupied(st.statementId);
          markOccupied(st.problemStatementId);
          if (st.sequence) markOccupied(st.sequence);
          if (st.order) markOccupied(st.order);
        }
      });
    }
  } catch (err) {
    console.warn('[CloudFunctions] Error computing occupied statement IDs:', err);
  }

  return occupiedVariants;
}

function isStatementOccupiedBackend(statement: any, occupiedSet: Set<string>, excludeTeamId?: string): boolean {
  const idsToCheck = [
    statement.statementId,
    statement.problemStatementId,
    statement.id,
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

  if (statement.assignedTeamId && String(statement.assignedTeamId).trim().length > 0) {
    if (!excludeTeamId || statement.assignedTeamId !== excludeTeamId) return true;
  }
  if (Array.isArray(statement.assignedTeamIds) && statement.assignedTeamIds.length > 0) {
    if (!excludeTeamId || statement.assignedTeamIds.some((tid: any) => tid !== excludeTeamId)) return true;
  }
  if (Array.isArray(statement.assignedTeams) && statement.assignedTeams.length > 0) {
    if (!excludeTeamId || statement.assignedTeams.some((t: any) => (t.teamId || t) !== excludeTeamId)) return true;
  }
  if (statement.team && String(statement.team).trim().length > 0) {
    if (!excludeTeamId || statement.team !== excludeTeamId) return true;
  }

  return false;
}

/**
 * Preview next sequential Team ID and generated username for Admin UI.
 */
export const getNextTeamPreview = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { leaderName } = data || {};

  const db = admin.firestore();
  const teamsSnap = await db.collection('teams').get();
  let max = 0;

  teamsSnap.forEach((doc) => {
    const match = doc.id.match(/^TEAM(\d+)$/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });

  const nextNum = max + 1;
  const generatedTeamId = `TEAM${String(nextNum).padStart(3, '0')}`;
  const baseUsername = leaderName ? normalizeUsername(leaderName) : '';
  const generatedUsername = baseUsername ? await getUniqueUsername(db, baseUsername) : '';

  return {
    nextTeamNumber: nextNum,
    generatedTeamId,
    generatedUsername,
    defaultProblemStatement: null,
  };
});

/**
 * Creates a team account with atomic sequential Team ID generation, unique username,
 * Firebase Auth credentials, Custom Claims, and Firestore documents.
 */
export const createTeamAccount = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { teamName, leaderName, password, selectedStatementId } = data || {};

  if (!teamName || !leaderName || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Team Name, Leader Name, and Password are required.');
  }

  if (password.length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters.');
  }

  const db = admin.firestore();
  const trimmedTeamName = teamName.trim();
  const trimmedLeaderName = leaderName.trim();
  const baseUsername = normalizeUsername(trimmedLeaderName);

  // 1. Generate unique username
  const normalizedUsername = await getUniqueUsername(db, baseUsername);
  const email = `${normalizedUsername}@hackathon.internal`;

  // 2. Determine next sequential Team ID
  const teamsSnap = await db.collection('teams').get();
  let max = 0;
  teamsSnap.forEach((doc) => {
    const match = doc.id.match(/^TEAM(\d+)$/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });

  const nextNum = max + 1;
  const allocatedTeamId = `TEAM${String(nextNum).padStart(3, '0')}`;

  let createdUserUid = '';

  try {
    // 3. Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: trimmedTeamName,
      disabled: false,
    });
    createdUserUid = userRecord.uid;

    // 4. Set Custom Claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'team',
      teamId: allocatedTeamId,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();

    // 5. Create Firestore User Document (Password is NEVER stored)
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      role: 'team',
      teamId: allocatedTeamId,
      username: normalizedUsername,
      displayName: trimmedTeamName,
      leaderName: trimmedLeaderName,
      status: 'active',
      sessionVersion: 1,
      activeSessionId: null,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Create Firestore Team Document
    await db.collection('teams').doc(allocatedTeamId).set({
      teamId: allocatedTeamId,
      teamCode: allocatedTeamId,
      teamName: trimmedTeamName,
      leaderName: trimmedLeaderName,
      username: normalizedUsername,
      authUid: userRecord.uid,
      userUid: userRecord.uid,
      assignedStatementId: null,
      assignedStatementTitle: null,
      assignedProblemId: null,
      assignedProblemCode: null,
      assignedProblemOrder: null,
      assignmentStatus: 'UNASSIGNED',
      assignmentLocked: false,
      status: 'active',
      round1Submitted: false,
      round2Submitted: false,
      round3Submitted: false,
      round1Score: null,
      round2Score: null,
      round3Score: null,
      totalScore: null,
      selected: false,
      selectionStatus: 'NOT_SELECTED',
      createdAt: now,
      updatedAt: now,
    });

    // 7. Automatically register Leader as the first team member
    const leaderMemberId = `${allocatedTeamId}_M01`;
    const leaderMemberPayload = {
      memberId: leaderMemberId,
      teamId: allocatedTeamId,
      memberName: trimmedLeaderName,
      role: 'Team Leader',
      certificateStatus: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('teamMembers').doc(leaderMemberId).set(leaderMemberPayload, { merge: true });
    await db.collection('teams').doc(allocatedTeamId).collection('members').doc(leaderMemberId).set(leaderMemberPayload, { merge: true });

    // Update settings counter
    await db.collection('settings').doc('teamCounter').set({
      nextTeamNumber: nextNum + 1,
      updatedAt: now,
    }, { merge: true }).catch(() => {});

    // 7. Audit Log
    await logAudit(
      context.auth!.uid,
      context.auth!.token.email,
      'Team Account Created',
      'account',
      allocatedTeamId,
      { teamName: trimmedTeamName, leaderName: trimmedLeaderName, username: normalizedUsername }
    );

    // 8. Problem statement assignment (first available auto-assignment or specified)
    let assignedStatementId: string | null = null;
    let assignedStatementTitle: string | null = null;
    let assignedProblemSequence: number | null = null;

    let targetStatementId = selectedStatementId && String(selectedStatementId).trim().length > 0
      ? String(selectedStatementId).trim()
      : null;

    const occupiedIds = await getComprehensiveOccupiedStatementIdsBackend(db, allocatedTeamId);

    if (!targetStatementId) {
      // Automatic selection finding the FIRST available unassigned Problem Statement in problem order
      const allPsSnap = await db.collection('problemStatements').get();
      const allPsList: any[] = [];
      allPsSnap.forEach((d) => allPsList.push({ statementId: d.id, ...d.data() }));

      allPsList.sort((a, b) => {
        const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence !== undefined && a.sequence !== null ? a.sequence : 0);
        const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence !== undefined && b.sequence !== null ? b.sequence : 0);
        if (ordA !== ordB) return ordA - ordB;
        return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
      });

      // Find the first unassigned / available Problem Statement
      const chosenPs = allPsList.find((p) => !isStatementOccupiedBackend(p, occupiedIds, allocatedTeamId));

      if (!chosenPs) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'No available Problem Statements. Please add another Problem Statement before creating a new Team.'
        );
      }

      targetStatementId = chosenPs.statementId;
    }

    if (targetStatementId) {
      const psRef = db.collection('problemStatements').doc(targetStatementId);
      const psSnap = await psRef.get();

      if (!psSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `Problem Statement ${targetStatementId} does not exist.`
        );
      }

      const psData = psSnap.data() as any;
      const seq = psData.order !== undefined && psData.order !== null ? psData.order : (psData.sequence || 1);

      if (isStatementOccupiedBackend(psData, occupiedIds, allocatedTeamId)) {
        throw new functions.https.HttpsError(
          'already-exists',
          `Problem #${seq} is already assigned. Team creation was not completed.`
        );
      }

      const isPublished = psData.status === 'published' || psData.status === 'PUBLISHED';
      const nowIso = new Date().toISOString();

      await db.collection('teamProblemAssignments').doc(allocatedTeamId).set({
        teamId: allocatedTeamId,
        statementId: psData.statementId || targetStatementId,
        problemStatementId: psData.problemStatementId || targetStatementId,
        problemSequence: seq,
        order: seq,
        statementTitle: psData.title,
        description: psData.description,
        category: psData.category || 'General',
        difficulty: psData.difficulty || 'MEDIUM',
        organization: psData.organization || null,
        department: psData.department || null,
        team: psData.team || trimmedTeamName,
        aiAnalysis: psData.analysis || psData.evaluationNotes || '',
        confidence: psData.confidence || 0.9,
        qualityScore: psData.aiQualityScore || 8,
        aiIssues: psData.aiIssues || [],
        aiSuggestions: psData.aiSuggestions || [],
        requirements: psData.requirements || [],
        examples: psData.examples || '',
        technicalGuidelines: psData.technicalGuidelines || '',
        constraints: psData.constraints || '',
        expectedOutcome: psData.expectedOutcome || '',
        instructions: psData.instructions || (psData.technicalGuidelines ? [psData.technicalGuidelines] : []),
        sourceFileName: psData.sourceFileName || '',
        assignedAt: nowIso,
        publishedAt: isPublished ? nowIso : null,
        assignedBy: context.auth!.token.email || context.auth!.uid || 'system_auto_assignment',
        status: isPublished ? 'PUBLISHED' : 'DRAFT',
      }, { merge: true });

      await psRef.update({
        assignedTeamId: allocatedTeamId,
        assignedTeamName: trimmedTeamName,
        updatedAt: now,
      });

      await db.collection('teams').doc(allocatedTeamId).update({
        assignedStatementId: psData.statementId || targetStatementId,
        assignedStatementTitle: psData.title,
        assignedProblemId: psData.statementId || targetStatementId,
        assignedProblemCode: psData.statementId || targetStatementId,
        assignedProblemOrder: seq,
        problemStatementId: psData.statementId || targetStatementId,
        problemStatementCode: psData.statementId || targetStatementId,
        problemStatementOrder: seq,
        assignmentStatus: 'ASSIGNED',
        assignmentLocked: true,
        assignmentSource: 'AUTO',
        assignedAt: nowIso,
        updatedAt: now,
      });

      // Legacy table
      await db.collection('problemAssignments').doc(`${allocatedTeamId}_${targetStatementId}`).set({
        assignmentId: `${allocatedTeamId}_${targetStatementId}`,
        teamId: allocatedTeamId,
        problemStatementId: targetStatementId,
        statementId: targetStatementId,
        assignmentSequence: seq,
        status: isPublished ? 'PUBLISHED' : 'DRAFT',
        assignedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      }, { merge: true });

      assignedStatementId = targetStatementId;
      assignedStatementTitle = psData.title;
      assignedProblemSequence = seq;
    }

    return {
      success: true,
      teamId: allocatedTeamId,
      teamName: trimmedTeamName,
      leaderName: trimmedLeaderName,
      username: normalizedUsername,
      authUid: userRecord.uid,
      assignedStatementId,
      assignedStatementTitle,
      assignedProblemSequence,
      message: `Team ${allocatedTeamId} created successfully!`,
    };
  } catch (error: any) {
    console.error('Error during team account creation:', error);
    // Cleanup created auth user if Firestore write failed
    if (createdUserUid) {
      await admin.auth().deleteUser(createdUserUid).catch(() => {});
    }

    if (error.code === 'auth/email-already-exists') {
      throw new functions.https.HttpsError('already-exists', 'An account with this username already exists in Authentication.');
    }
    throw new functions.https.HttpsError('internal', error.message || 'Failed to create team account.');
  }
});

/**
 * Disables a team account in Auth and Firestore, immediately terminating active sessions.
 */
export const disableTeamAccount = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { teamId } = data;
  if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId is required.');

  const db = admin.firestore();
  const teamDoc = await db.collection('teams').doc(teamId).get();
  if (!teamDoc.exists) throw new functions.https.HttpsError('not-found', 'Team not found.');

  const teamData = teamDoc.data()!;
  const userUid = teamData.authUid || teamData.userUid;

  if (userUid) {
    await admin.auth().updateUser(userUid, { disabled: true });
    await admin.auth().revokeRefreshTokens(userUid);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('teams').doc(teamId).update({ status: 'disabled', updatedAt: now });
  if (userUid) {
    await db.collection('users').doc(userUid).update({
      status: 'disabled',
      activeSessionId: null,
      sessionVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    });
  }

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Account Disabled', 'account', teamId);
  return { success: true, message: `Team ${teamId} has been disabled.` };
});

/**
 * Enables a disabled team account.
 */
export const enableTeamAccount = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { teamId } = data;
  if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId is required.');

  const db = admin.firestore();
  const teamDoc = await db.collection('teams').doc(teamId).get();
  if (!teamDoc.exists) throw new functions.https.HttpsError('not-found', 'Team not found.');

  const teamData = teamDoc.data()!;
  const userUid = teamData.authUid || teamData.userUid;

  if (userUid) {
    await admin.auth().updateUser(userUid, { disabled: false });
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('teams').doc(teamId).update({ status: 'active', updatedAt: now });
  if (userUid) {
    await db.collection('users').doc(userUid).update({ status: 'active', updatedAt: now });
  }

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Account Enabled', 'account', teamId);
  return { success: true, message: `Team ${teamId} has been enabled.` };
});

/**
 * Securely resets a team's password server-side and invalidates their active sessions.
 */
export const resetTeamPassword = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { teamId, newPassword } = data;
  if (!teamId || !newPassword) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and newPassword are required.');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'New password does not meet the required security rules. Must be at least 6 characters.');
  }

  const cleanTeamId = String(teamId).trim();
  const db = admin.firestore();

  // 1. Case-insensitive / alias document lookup
  let teamDoc = await db.collection('teams').doc(cleanTeamId).get();
  if (!teamDoc.exists) {
    teamDoc = await db.collection('teams').doc(cleanTeamId.toUpperCase()).get();
  }
  if (!teamDoc.exists) {
    teamDoc = await db.collection('teams').doc(cleanTeamId.toLowerCase()).get();
  }
  if (!teamDoc.exists) {
    const querySnap = await db.collection('teams').where('teamId', '==', cleanTeamId).limit(1).get();
    if (!querySnap.empty) {
      teamDoc = querySnap.docs[0];
    }
  }

  if (!teamDoc.exists) {
    throw new functions.https.HttpsError('not-found', `Team account '${cleanTeamId}' was not found in database.`);
  }

  const teamData = teamDoc.data() || {};
  const canonicalTeamId = teamDoc.id;
  let targetUid: string | null = teamData.authUid || teamData.userUid || null;

  // Fallback 1: Lookup user record by username in Firestore
  if (!targetUid) {
    const normalizedUsername = (teamData.username || cleanTeamId).toLowerCase().trim();
    const userQuery = await db.collection('users').where('username', '==', normalizedUsername).limit(1).get();
    if (!userQuery.empty) {
      targetUid = userQuery.docs[0].id;
    }
  }

  // Fallback 2: Lookup user in Firebase Auth directly by email patterns
  if (!targetUid) {
    const normalizedUsername = (teamData.username || cleanTeamId).toLowerCase().trim();
    const emailsToTry = [
      `${normalizedUsername}@hackathon.internal`,
      `${normalizedUsername}@hackathon.local`,
      `${cleanTeamId.toLowerCase()}@hackathon.internal`,
      `${cleanTeamId.toLowerCase()}@hackathon.local`,
      `${cleanTeamId.toUpperCase()}@hackathon.internal`,
    ];

    for (const em of emailsToTry) {
      try {
        const authUser = await admin.auth().getUserByEmail(em);
        if (authUser && authUser.uid) {
          targetUid = authUser.uid;
          break;
        }
      } catch {
        // Continue trying next pattern
      }
    }
  }

  try {
    // If targetUid exists, attempt to update password
    if (targetUid) {
      try {
        await admin.auth().updateUser(targetUid, { password: newPassword });
      } catch (authUpdateErr: any) {
        console.warn(`[resetTeamPassword] updateUser failed on targetUid ${targetUid}:`, authUpdateErr.code);
        if (authUpdateErr.code === 'auth/user-not-found') {
          targetUid = null; // Recreate or lookup below
        } else {
          throw authUpdateErr;
        }
      }
    }

    // Fallback 3: If user did not exist or was deleted, provision/sync the Auth user
    if (!targetUid) {
      const normalizedUsername = (teamData.username || cleanTeamId).toLowerCase().trim();
      const email = `${normalizedUsername}@hackathon.internal`;
      try {
        const newUser = await admin.auth().createUser({
          email,
          password: newPassword,
          displayName: teamData.teamName || canonicalTeamId,
          disabled: teamData.status === 'disabled',
        });
        targetUid = newUser.uid;
        await admin.auth().setCustomUserClaims(targetUid, {
          role: 'team',
          teamId: canonicalTeamId,
        });
      } catch (createErr: any) {
        if (createErr.code === 'auth/email-already-in-use') {
          const existing = await admin.auth().getUserByEmail(email);
          targetUid = existing.uid;
          await admin.auth().updateUser(targetUid, { password: newPassword });
        } else {
          throw createErr;
        }
      }
    }

    // Revoke refresh tokens to invalidate current sessions
    if (targetUid) {
      await admin.auth().revokeRefreshTokens(targetUid).catch(() => {});
    }

    // Synchronize Firestore user & team document (clearing activeSessions for security)
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (targetUid) {
      await db.collection('users').doc(targetUid).set({
        activeSessions: [],
        activeSessionId: null,
        sessionVersion: admin.firestore.FieldValue.increment(1),
        teamId: canonicalTeamId,
        username: teamData.username || cleanTeamId.toLowerCase(),
        status: teamData.status || 'active',
        role: 'team',
        updatedAt: now,
      }, { merge: true });
    }

    await db.collection('teams').doc(canonicalTeamId).set({
      authUid: targetUid,
      updatedAt: now,
    }, { merge: true });

    // Server-side audit log
    await logAudit(context.auth!.uid, context.auth!.token.email, 'Password Reset', 'account', canonicalTeamId, {
      teamId: canonicalTeamId,
      userUid: targetUid,
    });

    return { success: true, message: 'Password updated successfully.' };
  } catch (error: any) {
    console.error(`[resetTeamPassword] Firebase error for team ${cleanTeamId}:`, {
      code: error.code,
      message: error.message,
    });
    if (error.code === 'auth/weak-password') {
      throw new functions.https.HttpsError('invalid-argument', 'New password does not meet the required security rules. Must be at least 6 characters.');
    }
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('unknown', error.message || 'Password reset failed in Firebase Auth.');
  }
});

/**
 * Forces logout on a team by invalidating all their active sessions and revoking refresh tokens.
 */
export const forceLogout = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { teamId } = data;
  if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId is required.');

  const db = admin.firestore();
  const teamDoc = await db.collection('teams').doc(teamId).get();
  if (!teamDoc.exists) throw new functions.https.HttpsError('not-found', 'Team not found.');

  const userUid = teamDoc.data()!.authUid || teamDoc.data()!.userUid;

  if (userUid) {
    await admin.auth().revokeRefreshTokens(userUid).catch(() => {});
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('users').doc(userUid).set({
      activeSessions: [],
      activeSessionId: null,
      sessionVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    }, { merge: true });
  }

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Force Logout', 'account', teamId);
  return { success: true, message: `All active device sessions terminated for ${teamId}.` };
});

/**
 * Registers a new active session on login, enforcing a 6-device limit for team users.
 */
export const registerActiveSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { sessionId, userAgent } = data;
  if (!sessionId) throw new functions.https.HttpsError('invalid-argument', 'sessionId is required.');

  const uid = context.auth.uid;
  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  return await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);

    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User record not found.');
    }

    const userData = userDoc.data()!;
    if (userData.status === 'disabled') {
      throw new functions.https.HttpsError('permission-denied', 'Account is disabled. Please contact administrator.');
    }

    const isTeam = userData.role === 'team' || (!userData.role && !context.auth?.token.admin);
    const existingSessions: any[] = Array.isArray(userData.activeSessions)
      ? userData.activeSessions.filter((s: any) => s && s.status === 'active')
      : [];

    const existingIndex = existingSessions.findIndex((s: any) => s.sessionId === sessionId);
    if (existingIndex >= 0) {
      existingSessions[existingIndex].lastSeenAt = new Date().toISOString();
      transaction.update(userRef, {
        activeSessions: existingSessions,
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, sessionId, activeDevicesCount: existingSessions.length };
    }

    // Enforce 6 devices limit for teams
    if (isTeam && existingSessions.length >= 6) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Maximum 6 active devices reached. Please logout from another device.'
      );
    }

    const newSession = {
      sessionId,
      userId: uid,
      userAgent: userAgent || 'Unknown Device',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      status: 'active',
    };

    const updatedSessions = [...existingSessions, newSession];
    const now = admin.firestore.FieldValue.serverTimestamp();

    transaction.update(userRef, {
      activeSessions: updatedSessions,
      lastLoginAt: now,
      updatedAt: now,
    });

    return { success: true, sessionId, activeDevicesCount: updatedSessions.length };
  });
});

/**
 * Completely and permanently deletes a team across Firebase Auth, Firestore, and Cloudinary.
 */
export const deleteTeamAccount = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { teamId } = data || {};
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId is required.');
  }

  const db = admin.firestore();
  const teamDoc = await db.collection('teams').doc(teamId).get();
  if (!teamDoc.exists) {
    throw new functions.https.HttpsError('not-found', `Team ${teamId} not found.`);
  }

  const teamData = teamDoc.data()!;
  const userUid = teamData.authUid || teamData.userUid;

  // 1. Delete Firebase Auth User & Revoke Tokens
  if (userUid) {
    try {
      await admin.auth().revokeRefreshTokens(userUid);
      await admin.auth().deleteUser(userUid);
    } catch (authErr: any) {
      console.warn(`[deleteTeamAccount] Auth delete note for UID ${userUid}:`, authErr.message);
    }
  }

  // 2. Cascade Delete all Firestore documents
  const batch = db.batch();

  // (a) Delete /teams/{teamId}
  batch.delete(db.collection('teams').doc(teamId));

  // (b) Delete /users/{userUid}
  if (userUid) {
    batch.delete(db.collection('users').doc(userUid));
  }

  // (c) Delete all documents in /teams/{teamId}/members subcollection
  const teamMembersSubSnap = await db.collection('teams').doc(teamId).collection('members').get();
  teamMembersSubSnap.forEach((d) => batch.delete(d.ref));

  // (d) Delete /teamMembers where teamId == teamId
  const teamMembersSnap = await db.collection('teamMembers').where('teamId', '==', teamId).get();
  teamMembersSnap.forEach((d) => batch.delete(d.ref));

  // (e) Delete /submissions where teamId == teamId
  const submissionsSnap = await db.collection('submissions').where('teamId', '==', teamId).get();
  submissionsSnap.forEach((d) => batch.delete(d.ref));

  // (f) Delete /scores where teamId == teamId
  const scoresSnap = await db.collection('scores').where('teamId', '==', teamId).get();
  scoresSnap.forEach((d) => batch.delete(d.ref));

  // (g) Delete /selections/{teamId}
  batch.delete(db.collection('selections').doc(teamId));

  // (h) Delete /certificates where teamId == teamId
  const certificatesSnap = await db.collection('certificates').where('teamId', '==', teamId).get();
  certificatesSnap.forEach((d) => batch.delete(d.ref));

  // (i) Delete /teamAssignments where teamId == teamId
  const assignmentsSnap = await db.collection('teamAssignments').where('teamId', '==', teamId).get();
  assignmentsSnap.forEach((d) => batch.delete(d.ref));

  // (j) Delete /teamProblemAssignments/{teamId}
  batch.delete(db.collection('teamProblemAssignments').doc(teamId));

  // (k) Delete /evaluations where teamId == teamId
  const evalsSnap = await db.collection('evaluations').where('teamId', '==', teamId).get();
  evalsSnap.forEach((d) => batch.delete(d.ref));

  // (l) Delete /evaluationHistory where teamId == teamId
  const evalHistSnap = await db.collection('evaluationHistory').where('teamId', '==', teamId).get();
  evalHistSnap.forEach((d) => batch.delete(d.ref));

  // (m) Update /selection/current to remove teamId if present
  const currentSelDoc = await db.collection('selection').doc('current').get();
  if (currentSelDoc.exists) {
    const curData = currentSelDoc.data()!;
    if (Array.isArray(curData.selectedTeamIds) && curData.selectedTeamIds.includes(teamId)) {
      const updatedList = curData.selectedTeamIds.filter((id: string) => id !== teamId);
      batch.update(currentSelDoc.ref, {
        selectedTeamIds: updatedList,
        totalSelected: updatedList.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  await batch.commit();

  // 3. Delete Cloudinary assets belonging to this team (if Cloudinary credentials available)
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
  const apiKey = process.env.CLOUDINARY_API_KEY || '';
  const apiSecret = process.env.CLOUDINARY_API_SECRET || '';

  if (cloudName && apiKey && apiSecret) {
    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const foldersToDelete = [
      `hackathon/teams/${teamId}`,
      `hackathon/submissions/${teamId}`,
      `hackathon/certificates/${teamId}`,
      `hackathon/round1/${teamId}`,
      `hackathon/round2/${teamId}`,
    ];

    for (const folder of foldersToDelete) {
      try {
        await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/folders/${folder}`, {
          method: 'DELETE',
          headers: { Authorization: authHeader },
        }).catch(() => {});
      } catch (cErr: any) {
        console.warn(`[deleteTeamAccount] Cloudinary folder delete note for ${folder}:`, cErr.message);
      }
    }
  }

  // 4. Record Audit Log
  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Team Account Deleted',
    'account',
    teamId,
    { teamName: teamData.teamName, leaderName: teamData.leaderName }
  );

  return {
    success: true,
    message: `Team ${teamId} and all associated data permanently deleted.`,
  };
});
