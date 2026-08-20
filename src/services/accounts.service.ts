import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  where,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { initializeApp, deleteApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions, isFirebaseConfigured, firebaseConfig } from '../firebase/config';
import { Team, UserProfile } from '../types';

import {
  getNextAvailableProblemStatement,
  assignNextSequentialProblemToTeam,
  assignSpecificProblemToTeam,
} from './problemAssignment.service';

export interface CreateAccountInput {
  teamName: string;
  leaderName: string;
  password: string;
  selectedStatementId?: string | null;
}

export interface NextTeamPreview {
  nextTeamNumber: number;
  generatedTeamId: string;
  generatedUsername: string;
  defaultProblemStatement?: {
    statementId: string;
    sequence?: number;
    title: string;
  } | null;
}

export interface CreateAccountResult {
  success: boolean;
  message: string;
  teamId: string;
  username: string;
  teamName: string;
  leaderName: string;
  authUid: string;
  assignedStatementId?: string | null;
  assignedStatementTitle?: string | null;
  assignedProblemSequence?: number | null;
}

/**
 * Normalizes leader name to a clean, lowercase username without spaces or special characters
 */
export function generateLocalUsername(name: string): string {
  let clean = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
  return clean || 'team';
}

/**
 * Maps Firebase Auth and Firestore error codes to friendly, safe user messages for Team Creation
 */
export function formatTeamCreationError(error: any): string {
  console.error('[TeamCreation] Detailed error:', error);

  if (!error) return 'Failed to create team account. Please try again.';

  const code = error.code || '';
  const msg = error.message || error.details || '';

  if (code === 'auth/email-already-in-use' || msg.includes('already exists') || msg.includes('already-exists')) {
    return 'An account with this generated username already exists. Please modify the leader name.';
  }
  if (code === 'auth/invalid-email') {
    return 'Generated username or email is invalid.';
  }
  if (code === 'auth/weak-password' || msg.includes('at least 6 characters') || msg.includes('weak-password')) {
    return 'Password must be at least 6 characters.';
  }
  if (code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('Permission denied') || msg.includes('privileges required')) {
    return 'Permission denied. You must have Administrator privileges.';
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable' || msg.includes('network') || msg.includes('offline')) {
    return 'Network connection error. Please verify your internet connection.';
  }
  if (code === 'unauthenticated' || msg.includes('unauthenticated')) {
    return 'Session expired. Please log in again as Admin.';
  }
  if (msg && msg !== 'internal' && msg !== 'INTERNAL' && !msg.startsWith('INTERNAL')) {
    return msg;
  }

  return 'Team account creation failed. Please check network and permissions.';
}

/**
 * Maps Firebase Auth and Cloud Function error codes to specific messages for Password Reset
 */
export function formatPasswordResetError(error: any): string {
  console.error('[PasswordReset] Detailed error:', error);

  if (!error) return 'Password reset failed. Please try again.';

  const code = error.code || '';
  const msg = error.message || error.details || '';

  if (code === 'auth/weak-password' || msg.includes('at least 6 characters') || msg.includes('weak-password') || msg.includes('security rules')) {
    return 'New password does not meet the required security rules. Must be at least 6 characters.';
  }
  if (code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('Permission denied') || msg.includes('privileges required')) {
    return 'You do not have permission to reset this password.';
  }
  if (code === 'not-found' || msg.includes('not found') || msg.includes('not-found')) {
    return 'Team account was not found.';
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable' || msg.includes('network') || msg.includes('offline')) {
    return 'Network connection error. Please verify your internet connection.';
  }
  if (code === 'unauthenticated' || msg.includes('unauthenticated')) {
    return 'Session expired. Please log in again as Admin.';
  }
  if (msg && msg !== 'internal' && msg !== 'INTERNAL' && !msg.startsWith('INTERNAL')) {
    return msg;
  }

  return 'Password reset failed. Please try again.';
}

/**
 * Maps error codes for Account Activation/Deactivation operations
 */
export function formatAccountStatusError(error: any): string {
  console.error('[AccountStatus] Detailed error:', error);
  if (!error) return 'Failed to update account status. Please try again.';

  const code = error.code || '';
  const msg = error.message || error.details || '';

  if (code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('Permission denied')) {
    return 'Permission denied. Administrator privileges required.';
  }
  if (code === 'not-found' || msg.includes('not found')) {
    return 'Team account was not found.';
  }
  if (msg && msg !== 'internal' && msg !== 'INTERNAL' && !msg.startsWith('INTERNAL')) {
    return msg;
  }

  return 'Failed to update account status. Please check network and permissions.';
}

/**
 * Maps error codes for Team Deletion operations
 */
export function formatTeamDeletionError(error: any): string {
  console.error('[TeamDeletion] Detailed error:', error);
  if (!error) return 'Failed to delete team account. Please try again.';

  const code = error.code || '';
  const msg = error.message || error.details || '';

  if (code === 'permission-denied' || msg.includes('permission-denied')) {
    return 'Permission denied. Administrator privileges required.';
  }
  if (code === 'not-found' || msg.includes('not found')) {
    return 'Team account was not found.';
  }
  if (msg && msg !== 'internal' && msg !== 'INTERNAL' && !msg.startsWith('INTERNAL')) {
    return msg;
  }

  return 'Team deletion failed. Please try again.';
}

const USERNAME_BLACKLIST = new Set([
  'admin',
  'administrator',
  'evaluator',
  'judge',
  'root',
  'system',
  'test',
  'null',
  'undefined',
  'hackathon',
  'superuser',
]);

/**
 * Ensures username uniqueness in Firestore users and teams collections
 */
export async function findUniqueUsername(baseUsername: string): Promise<string> {
  const safeBase = USERNAME_BLACKLIST.has(baseUsername) ? `${baseUsername}_team` : baseUsername;
  let candidate = safeBase;
  let suffix = 1;

  while (true) {
    const [userCheck, teamCheck] = await Promise.all([
      getDocs(query(collection(db, 'users'), where('username', '==', candidate))),
      getDocs(query(collection(db, 'teams'), where('username', '==', candidate))),
    ]);

    if (userCheck.empty && teamCheck.empty) {
      return candidate;
    }

    candidate = `${baseUsername}${suffix}`;
    suffix++;
  }
}

/**
 * Calculates the next sequential Team ID (TEAM001, TEAM002... TEAM100) from Firestore
 */
async function calculateNextSequentialTeamId(): Promise<{ nextNum: number; teamId: string }> {
  try {
    const teamsSnap = await getDocs(collection(db, 'teams'));
    let max = 0;

    teamsSnap.forEach((doc) => {
      const match = doc.id.match(/^TEAM(\d+)$/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });

    const nextNum = max + 1;
    const teamId = `TEAM${String(nextNum).padStart(3, '0')}`;
    return { nextNum, teamId };
  } catch (err) {
    console.warn('[AccountsService] Could not calculate team ID from collection, defaulting to TEAM001:', err);
    return { nextNum: 1, teamId: 'TEAM001' };
  }
}

/**
 * Previews the next sequential Team ID and generated username for the Admin UI.
 */
export async function getNextTeamPreview(leaderName?: string): Promise<NextTeamPreview> {
  const { nextNum, teamId } = await calculateNextSequentialTeamId();
  const baseUsername = leaderName ? generateLocalUsername(leaderName) : '';
  let generatedUsername = baseUsername;

  if (baseUsername) {
    try {
      generatedUsername = await findUniqueUsername(baseUsername);
    } catch {
      generatedUsername = baseUsername;
    }
  }

  return {
    nextTeamNumber: nextNum,
    generatedTeamId: teamId,
    generatedUsername: generatedUsername || (leaderName ? generateLocalUsername(leaderName) : ''),
    defaultProblemStatement: null,
  };
}

/**
 * Creates a new team account with sequential Team ID (TEAM001..TEAM100), unique username,
 * Firebase Authentication credentials, and Firestore documents.
 * Explicitly assigns the Admin-selected Problem Statement if provided.
 */
export async function createTeamAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  const teamName = input.teamName.trim();
  const leaderName = input.leaderName.trim();
  const password = input.password;
  const selectedStatementId = input.selectedStatementId ? input.selectedStatementId.trim() : null;

  if (!teamName) throw new Error('Please enter Team Name.');
  if (!leaderName) throw new Error('Please enter Leader Name.');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  // 1. Try Cloud Function first if available and configured
  try {
    const createFn = httpsCallable<any, any>(functions, 'createTeamAccount');
    const response = await createFn({
      teamName,
      leaderName,
      password,
      selectedStatementId,
    });
    if (response.data?.success) {
      if (selectedStatementId && !response.data.assignedStatementId) {
        try {
          await assignSpecificProblemToTeam(response.data.teamId, teamName, selectedStatementId, {
            uid: auth.currentUser?.uid,
            email: auth.currentUser?.email,
          });
        } catch (e) {
          console.warn('[AccountsService] Cloud Function follow-up problem assignment warning:', e);
        }
      }
      return response.data;
    }
  } catch (cloudFnError: any) {
    console.warn('[AccountsService] Cloud Function creation unavailable/failed, executing direct Firebase creation:', cloudFnError);
    // If it was a validation error from cloud function, rethrow with friendly message
    if (cloudFnError.code === 'invalid-argument' || cloudFnError.code === 'already-exists') {
      throw new Error(formatTeamCreationError(cloudFnError));
    }
  }

  // 2. Direct Resilient Firebase Client Creation using Secondary Firebase App
  // (Secondary app ensures the currently logged-in Admin is NEVER signed out)
  const { nextNum, teamId } = await calculateNextSequentialTeamId();
  const baseUsername = generateLocalUsername(leaderName);
  const username = await findUniqueUsername(baseUsername);
  const authEmail = `${username}@hackathon.internal`;

  const tempAppName = `team_creator_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let tempApp: any = null;

  try {
    tempApp = initializeApp(firebaseConfig, tempAppName);
    const tempAuth = getAuth(tempApp);

    // Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(tempAuth, authEmail, password);
    const authUid = userCredential.user.uid;

    // Sign out from temporary instance immediately
    await signOut(tempAuth).catch(() => {});

    // Save to Firestore: /teams/{teamId}
    const teamDocRef = doc(db, 'teams', teamId);
    await setDoc(teamDocRef, {
      teamId,
      teamCode: teamId,
      teamName,
      leaderName,
      username,
      authUid,
      userUid: authUid,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Save to Firestore: /users/{authUid}
    const userDocRef = doc(db, 'users', authUid);
    await setDoc(userDocRef, {
      uid: authUid,
      role: 'team',
      teamId,
      username,
      displayName: teamName,
      leaderName,
      status: 'active',
      sessionVersion: 1,
      activeSessionId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Automatically register Leader as the first team member
    const leaderMemberId = `${teamId}_M01`;
    const leaderMemberPayload = {
      memberId: leaderMemberId,
      teamId,
      memberName: leaderName.trim(),
      role: 'Team Leader',
      certificateStatus: 'PENDING',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'teamMembers', leaderMemberId), leaderMemberPayload, { merge: true });
    await setDoc(doc(db, 'teams', teamId, 'members', leaderMemberId), leaderMemberPayload, { merge: true }).catch(() => {});

    // Update atomic counter in settings
    const counterRef = doc(db, 'settings', 'teamCounter');
    await setDoc(counterRef, { nextTeamNumber: nextNum + 1, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});

    // Save audit log
    const auditDocRef = doc(collection(db, 'auditLogs'));
    await setDoc(auditDocRef, {
      id: auditDocRef.id,
      adminUid: auth.currentUser?.uid || 'admin',
      adminEmail: auth.currentUser?.email || 'admin@hackathon.org',
      action: 'Team Account Created',
      targetType: 'account',
      targetId: teamId,
      timestamp: new Date().toISOString(),
      metadata: { teamName, leaderName, username, teamId, selectedStatementId },
    }).catch(() => {});

    // Explicit manual problem assignment if requested by Admin
    let assignedStatementId: string | null = null;
    let assignedStatementTitle: string | null = null;
    let assignedProblemSequence: number | null = null;

    if (selectedStatementId) {
      const assignResult = await assignSpecificProblemToTeam(teamId, teamName, selectedStatementId, {
        uid: auth.currentUser?.uid,
        email: auth.currentUser?.email,
      });
      if (assignResult.success && assignResult.assigned) {
        assignedStatementId = assignResult.statementId || null;
        assignedStatementTitle = assignResult.statementTitle || null;
        assignedProblemSequence = assignResult.problemSequence || null;
      } else if (!assignResult.success) {
        throw new Error(assignResult.message || 'This problem statement has already been assigned. Please select another FREE problem statement.');
      }
    }

    return {
      success: true,
      teamId,
      username,
      teamName,
      leaderName,
      authUid,
      assignedStatementId,
      assignedStatementTitle,
      assignedProblemSequence,
      message: `Team account created successfully for ${teamName} (${teamId})${assignedStatementId ? ` with assigned problem ${assignedStatementId}` : ''}.`,
    };
  } catch (err: any) {
    throw new Error(formatTeamCreationError(err));
  } finally {
    if (tempApp) {
      deleteApp(tempApp).catch(() => {});
    }
  }
}

import { normalizeTeam } from '../utils/normalize';

/**
 * Fetches all teams with live Firestore subscription support (Real data only, no mock data)
 */
export function subscribeToTeams(callback: (teams: Team[]) => void): () => void {
  const q = query(collection(db, 'teams'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const teams: Team[] = [];
      snapshot.forEach((doc) => {
        teams.push(normalizeTeam(doc.data(), doc.id));
      });
      callback(teams);
    },
    (err) => {
      console.error('[AccountsService] subscribeToTeams listener error:', err);
      // Try un-ordered query as fallback in case composite index is building
      const fallbackQuery = query(collection(db, 'teams'));
      getDocs(fallbackQuery).then((snap) => {
        const list: Team[] = [];
        snap.forEach((d) => list.push(normalizeTeam(d.data(), d.id)));
        callback(list);
      }).catch(() => callback([]));
    }
  );
}

/**
 * Disables a team account
 */
export async function disableTeam(teamId: string): Promise<void> {
  const teamDoc = doc(db, 'teams', teamId);
  const snap = await getDoc(teamDoc);
  if (!snap.exists()) throw new Error('Team not found');

  const teamData = snap.data();
  const uid = teamData.authUid || teamData.userUid;

  await updateDoc(teamDoc, {
    status: 'disabled',
    updatedAt: serverTimestamp(),
  });

  if (uid) {
    const userDoc = doc(db, 'users', uid);
    await updateDoc(userDoc, {
      status: 'disabled',
      activeSessionId: null,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

/**
 * Enables a team account
 */
export async function enableTeam(teamId: string): Promise<void> {
  const teamDoc = doc(db, 'teams', teamId);
  const snap = await getDoc(teamDoc);
  if (!snap.exists()) throw new Error('Team not found');

  const teamData = snap.data();
  const uid = teamData.authUid || teamData.userUid;

  await updateDoc(teamDoc, {
    status: 'active',
    updatedAt: serverTimestamp(),
  });

  if (uid) {
    const userDoc = doc(db, 'users', uid);
    await updateDoc(userDoc, {
      status: 'active',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

/**
 * Resets a team password
 */
export async function resetTeamPassword(teamId: string, newPassword: string): Promise<void> {
  const cleanId = (teamId || '').trim();
  const cleanPassword = (newPassword || '').trim();

  if (!cleanId) {
    throw new Error('Team ID is required.');
  }
  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error('New password does not meet the required security rules. Must be at least 6 characters.');
  }

  try {
    const fn = httpsCallable(functions, 'resetTeamPassword');
    await fn({ teamId: cleanId, newPassword: cleanPassword });
  } catch (err: any) {
    console.warn('[AccountsService] resetTeamPassword Cloud Function failed:', err);
    throw new Error(formatPasswordResetError(err));
  }
}

/**
 * Forces logout on a team (invalidates their active session)
 */
export async function forceLogoutTeam(teamId: string): Promise<void> {
  const teamDoc = doc(db, 'teams', teamId);
  const snap = await getDoc(teamDoc);
  if (!snap.exists()) return;

  const teamData = snap.data();
  const uid = teamData.authUid || teamData.userUid;

  if (uid) {
    const userDoc = doc(db, 'users', uid);
    await updateDoc(userDoc, {
      activeSessionId: null,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Updates team info (Team name, Leader name)
 */
export async function updateTeamInfo(teamId: string, teamName: string, leaderName: string): Promise<void> {
  const teamDoc = doc(db, 'teams', teamId);
  await updateDoc(teamDoc, {
    teamName: teamName.trim(),
    leaderName: leaderName.trim(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Completely and permanently deletes a team across Firebase Auth, Firestore, and Cloudinary.
 */
export async function deleteTeamAccountCascade(teamId: string): Promise<void> {
  if (!teamId) throw new Error('Team ID is required.');

  // 1. Try Cloud Function first (which deletes Firebase Auth user & Cloudinary assets securely)
  try {
    const fn = httpsCallable(functions, 'deleteTeamAccount');
    await fn({ teamId });
    return;
  } catch (cloudFnErr: any) {
    console.warn('[AccountsService] deleteTeamAccount Cloud Function fallback to direct Firestore batch:', cloudFnErr.message);
  }

  // 2. Direct Firestore fallback cascade deletion
  const teamDocRef = doc(db, 'teams', teamId);
  const teamSnap = await getDoc(teamDocRef);
  if (!teamSnap.exists()) {
    throw new Error(`Team ${teamId} not found.`);
  }

  const teamData = teamSnap.data();
  const userUid = teamData.authUid || teamData.userUid;

  const batch = writeBatch(db);

  // (a) Delete /teams/{teamId}
  batch.delete(teamDocRef);

  // (b) Delete /users/{userUid}
  if (userUid) {
    batch.delete(doc(db, 'users', userUid));
  }

  // (c) Delete subcollection /teams/{teamId}/members
  const subMembersSnap = await getDocs(collection(db, 'teams', teamId, 'members'));
  subMembersSnap.forEach((d) => batch.delete(d.ref));

  // (d) Delete /teamMembers where teamId == teamId
  const membersSnap = await getDocs(query(collection(db, 'teamMembers'), where('teamId', '==', teamId)));
  membersSnap.forEach((d) => batch.delete(d.ref));

  // (e) Delete /submissions where teamId == teamId
  const submissionsSnap = await getDocs(query(collection(db, 'submissions'), where('teamId', '==', teamId)));
  submissionsSnap.forEach((d) => batch.delete(d.ref));

  // (f) Delete /scores where teamId == teamId
  const scoresSnap = await getDocs(query(collection(db, 'scores'), where('teamId', '==', teamId)));
  scoresSnap.forEach((d) => batch.delete(d.ref));

  // (g) Delete /selections/{teamId}
  batch.delete(doc(db, 'selections', teamId));

  // (h) Delete /certificates where teamId == teamId
  const certsSnap = await getDocs(query(collection(db, 'certificates'), where('teamId', '==', teamId)));
  certsSnap.forEach((d) => batch.delete(d.ref));

  // (i) Delete /teamAssignments where teamId == teamId
  const assignsSnap = await getDocs(query(collection(db, 'teamAssignments'), where('teamId', '==', teamId)));
  assignsSnap.forEach((d) => batch.delete(d.ref));

  // (j) Delete /teamProblemAssignments/{teamId}
  batch.delete(doc(db, 'teamProblemAssignments', teamId));

  // (k) Delete /evaluations where teamId == teamId
  const evalsSnap = await getDocs(query(collection(db, 'evaluations'), where('teamId', '==', teamId)));
  evalsSnap.forEach((d) => batch.delete(d.ref));

  // (l) Delete /evaluationHistory where teamId == teamId
  const evalHistSnap = await getDocs(query(collection(db, 'evaluationHistory'), where('teamId', '==', teamId)));
  evalHistSnap.forEach((d) => batch.delete(d.ref));

  // (m) Update /selection/current
  const currentSelRef = doc(db, 'selection', 'current');
  const currentSelSnap = await getDoc(currentSelRef);
  if (currentSelSnap.exists()) {
    const curData = currentSelSnap.data();
    if (Array.isArray(curData.selectedTeamIds) && curData.selectedTeamIds.includes(teamId)) {
      const updatedList = curData.selectedTeamIds.filter((id: string) => id !== teamId);
      batch.update(currentSelRef, {
        selectedTeamIds: updatedList,
        totalSelected: updatedList.length,
        updatedAt: serverTimestamp(),
      });
    }
  }

  await batch.commit();

  // Audit log
  const auditDocRef = doc(collection(db, 'auditLogs'));
  await setDoc(auditDocRef, {
    id: auditDocRef.id,
    adminUid: auth.currentUser?.uid || 'admin',
    adminEmail: auth.currentUser?.email || 'admin@hackathon.org',
    action: 'Team Deleted Permanently',
    targetType: 'account',
    targetId: teamId,
    timestamp: new Date().toISOString(),
    metadata: { teamId, teamName: teamData.teamName, leaderName: teamData.leaderName },
  }).catch(() => {});
}
