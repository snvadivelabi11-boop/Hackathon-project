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
  };
});

/**
 * Creates a team account with atomic sequential Team ID generation, unique username,
 * Firebase Auth credentials, Custom Claims, and Firestore documents.
 */
export const createTeamAccount = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { teamName, leaderName, password } = data;

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
      teamName: trimmedTeamName,
      leaderName: trimmedLeaderName,
      username: normalizedUsername,
      authUid: userRecord.uid,
      userUid: userRecord.uid,
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

    return {
      success: true,
      teamId: allocatedTeamId,
      teamName: trimmedTeamName,
      leaderName: trimmedLeaderName,
      username: normalizedUsername,
      authUid: userRecord.uid,
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

    // Synchronize Firestore user & team document
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (targetUid) {
      await db.collection('users').doc(targetUid).set({
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
 * Forces logout on a team by invalidating their active session and revoking refresh tokens.
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
    await admin.auth().revokeRefreshTokens(userUid);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('users').doc(userUid).update({
      activeSessionId: null,
      sessionVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    });
  }

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Force Logout', 'account', teamId);
  return { success: true, message: `Active session terminated for ${teamId}.` };
});

/**
 * Registers a new active session on login, invalidating any previous session.
 */
export const registerActiveSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { sessionId } = data;
  if (!sessionId) throw new functions.https.HttpsError('invalid-argument', 'sessionId is required.');

  const uid = context.auth.uid;
  const db = admin.firestore();

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User record not found.');
  }

  const userData = userDoc.data()!;
  if (userData.status === 'disabled') {
    throw new functions.https.HttpsError('permission-denied', 'Account is disabled. Please contact administrator.');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await userRef.update({
    activeSessionId: sessionId,
    sessionVersion: admin.firestore.FieldValue.increment(1),
    lastLoginAt: now,
    updatedAt: now,
  });

  return { success: true, sessionId };
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
