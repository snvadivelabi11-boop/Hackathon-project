import {
  signInWithEmailAndPassword,
  signOut,
  User as FirebaseUser,
  getIdTokenResult,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { UserProfile } from '../types';

export const SESSION_STORAGE_KEY = 'hackathon_active_session_id';

export function generateSessionId(): string {
  return 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

/**
 * Maps Firebase Auth error codes to user-friendly messages.
 */
export function formatFirebaseAuthError(error: any): string {
  if (!error) return 'Unable to sign in. Please try again.';

  const code = error.code || '';
  const msg = error.message || '';

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    msg.includes('invalid-credential') ||
    msg.includes('user-not-found') ||
    msg.includes('wrong-password')
  ) {
    return 'Invalid email or password.';
  }

  if (code === 'auth/invalid-email' || msg.includes('invalid-email')) {
    return 'Please enter a valid email address.';
  }

  if (code === 'auth/user-disabled' || msg.includes('user-disabled')) {
    return 'This account has been disabled. Please contact the administrator.';
  }

  if (code === 'auth/too-many-requests' || msg.includes('too-many-requests')) {
    return 'Too many login attempts. Please try again later.';
  }

  if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
    return 'Network error. Please check your internet connection and try again.';
  }

  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password authentication is not enabled in the Firebase Console.';
  }

  if (msg === 'Access denied.' || msg.includes('not authorized')) {
    return 'You are not authorized to access the Admin Portal.';
  }

  return msg || 'Unable to sign in. Please check your credentials and try again.';
}

/**
 * Universal helper to verify if an authenticated Firebase User is an authorized Admin.
 * Inspects:
 * 1. Firebase Custom Claims (role: 'admin' or admin: true)
 * 2. Firestore document users/{uid}
 * 3. Firestore document admin/{uid} or admins/{uid}
 * 4. Firestore query on 'admin' collection where email == fbUser.email
 * 5. Firestore query on 'admins' collection where email == fbUser.email
 * 6. Firestore query on 'users' collection where email == fbUser.email
 */
export async function verifyAdminStatus(fbUser: FirebaseUser): Promise<{ isAdmin: boolean; data?: any }> {
  try {
    // 1. Check Custom Claims
    const tokenResult = await getIdTokenResult(fbUser, false);
    if (tokenResult.claims.role === 'admin' || tokenResult.claims.admin === true) {
      return { isAdmin: true, data: tokenResult.claims };
    }

    const uid = fbUser.uid;
    const cleanEmail = fbUser.email ? fbUser.email.toLowerCase().trim() : '';

    // 2. Direct document checks by UID
    const [uSnap, aSnap, asSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid)).catch(() => null),
      getDoc(doc(db, 'admin', uid)).catch(() => null),
      getDoc(doc(db, 'admins', uid)).catch(() => null),
    ]);

    if (uSnap?.exists() && (uSnap.data()?.role === 'admin' || uSnap.data()?.isAdmin === true)) {
      return { isAdmin: true, data: uSnap.data() };
    }
    if (aSnap?.exists() && (aSnap.data()?.role === 'admin' || aSnap.data()?.role === undefined || aSnap.data()?.isAdmin !== false)) {
      return { isAdmin: true, data: aSnap.data() };
    }
    if (asSnap?.exists() && (asSnap.data()?.role === 'admin' || asSnap.data()?.role === undefined || asSnap.data()?.isAdmin !== false)) {
      return { isAdmin: true, data: asSnap.data() };
    }

    // 3. Query collections by Email
    if (cleanEmail) {
      const [adminEmailSnap, adminsEmailSnap, usersEmailSnap] = await Promise.all([
        getDocs(query(collection(db, 'admin'), where('email', '==', cleanEmail), limit(1))).catch(() => null),
        getDocs(query(collection(db, 'admins'), where('email', '==', cleanEmail), limit(1))).catch(() => null),
        getDocs(query(collection(db, 'users'), where('email', '==', cleanEmail), limit(1))).catch(() => null),
      ]);

      if (adminEmailSnap && !adminEmailSnap.empty) {
        const d = adminEmailSnap.docs[0].data();
        if (d.role === 'admin' || d.role === undefined || d.isAdmin !== false) {
          return { isAdmin: true, data: d };
        }
      }

      if (adminsEmailSnap && !adminsEmailSnap.empty) {
        const d = adminsEmailSnap.docs[0].data();
        if (d.role === 'admin' || d.role === undefined || d.isAdmin !== false) {
          return { isAdmin: true, data: d };
        }
      }

      if (usersEmailSnap && !usersEmailSnap.empty) {
        const d = usersEmailSnap.docs[0].data();
        if (d.role === 'admin' || d.isAdmin === true) {
          return { isAdmin: true, data: d };
        }
      }
    }

    return { isAdmin: false };
  } catch (err) {
    console.error('Error during verifyAdminStatus:', err);
    return { isAdmin: false };
  }
}

import { runTransaction } from 'firebase/firestore';
import { DeviceSession } from '../types';

export const MAX_USER_DEVICES = 6;

/**
 * Registers a device session with atomic concurrency protection and 6-device limit enforcement
 */
export async function registerDeviceSession(
  uid: string,
  sessionId: string,
  role: 'team' | 'admin',
  userAgent: string = ''
): Promise<{ success: boolean; activeCount: number }> {
  const userDocRef = doc(db, 'users', uid);
  const cleanUA = userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser Device');
  const nowIso = new Date().toISOString();

  let activeCount = 1;

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userDocRef);

    let existingSessions: DeviceSession[] = [];
    let isUserDisabled = false;

    if (userSnap.exists()) {
      const data = userSnap.data() as any;
      if (data.status === 'disabled') {
        isUserDisabled = true;
      }
      if (Array.isArray(data.activeSessions)) {
        existingSessions = data.activeSessions.filter(
          (s: DeviceSession) => s && s.sessionId && s.status === 'active'
        );
      }
    }

    if (isUserDisabled) {
      throw new Error('This account has been disabled. Please contact the administrator.');
    }

    // Check if this exact session ID is already registered
    const existingIndex = existingSessions.findIndex((s) => s.sessionId === sessionId);
    if (existingIndex >= 0) {
      existingSessions[existingIndex].lastSeenAt = nowIso;
      activeCount = existingSessions.length;
      transaction.set(
        userDocRef,
        {
          activeSessions: existingSessions,
          activeSessionId: sessionId,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    // Enforce maximum 6 active devices limit for team participants
    if (role === 'team' && existingSessions.length >= MAX_USER_DEVICES) {
      throw new Error('Maximum 6 active devices reached. Please logout from another device.');
    }

    const newSession: DeviceSession = {
      sessionId,
      userId: uid,
      userAgent: cleanUA,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      status: 'active',
    };

    const updatedSessions = [...existingSessions, newSession];
    activeCount = updatedSessions.length;

    transaction.set(
      userDocRef,
      {
        activeSessions: updatedSessions,
        activeSessionId: sessionId,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { success: true, activeCount };
}

/**
 * Removes a specific device session on explicit logout, freeing the slot
 */
export async function removeDeviceSession(uid: string, sessionId: string): Promise<void> {
  if (!uid || !sessionId) return;
  const userDocRef = doc(db, 'users', uid);

  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userDocRef);
      if (!userSnap.exists()) return;

      const data = userSnap.data() as any;
      if (Array.isArray(data.activeSessions)) {
        const remainingSessions = data.activeSessions.filter(
          (s: DeviceSession) => s && s.sessionId !== sessionId && s.status === 'active'
        );
        transaction.update(userDocRef, {
          activeSessions: remainingSessions,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    console.warn('[AuthService] Could not remove device session:', err);
  }
}

/**
 * Real Firebase Team Authentication (Supports up to 6 concurrent devices per team)
 * Accepts Team ID or Username and Password.
 */
export async function loginTeam(identifier: string, password: string): Promise<UserProfile> {
  const trimmed = identifier.trim();
  if (!trimmed || !password) {
    throw new Error('Please enter both Team ID / Username and Password.');
  }

  let email = trimmed;
  if (!email.includes('@')) {
    try {
      const teamDoc = await getDoc(doc(db, 'teams', trimmed.toUpperCase())).catch(() => null);
      if (teamDoc && teamDoc.exists() && teamDoc.data()?.username) {
        email = `${teamDoc.data().username}@hackathon.internal`;
      } else {
        email = `${trimmed.toLowerCase()}@hackathon.internal`;
      }
    } catch {
      email = `${trimmed.toLowerCase()}@hackathon.internal`;
    }
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const fbUser = userCredential.user;

    const tokenResult = await getIdTokenResult(fbUser, true);
    const roleClaim = tokenResult.claims.role as string | undefined;
    const teamIdClaim = tokenResult.claims.teamId as string | undefined;

    const sessionId = generateSessionId();

    // Register device session atomically and enforce 6-device limit
    try {
      await registerDeviceSession(fbUser.uid, sessionId, 'team');
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch (sessionErr: any) {
      await signOut(auth).catch(() => {});
      localStorage.removeItem(SESSION_STORAGE_KEY);
      throw sessionErr;
    }

    const userDocRef = doc(db, 'users', fbUser.uid);
    const userSnap = await getDoc(userDocRef).catch(() => null);

    if (userSnap && userSnap.exists()) {
      const data = userSnap.data() as UserProfile;
      if (data.status === 'disabled') {
        await signOut(auth);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        throw new Error('This team account has been disabled. Please contact the administrator.');
      }

      return {
        ...data,
        uid: fbUser.uid,
        role: (data.role || (roleClaim === 'admin' ? 'admin' : 'team')) as any,
        teamId: data.teamId || teamIdClaim || trimmed.toUpperCase(),
        activeSessionId: sessionId,
      };
    } else {
      const profile: UserProfile = {
        uid: fbUser.uid,
        role: (roleClaim === 'admin' ? 'admin' : 'team') as any,
        teamId: teamIdClaim || trimmed.toUpperCase(),
        username: trimmed.toLowerCase(),
        displayName: fbUser.displayName || trimmed.toUpperCase(),
        status: 'active',
        sessionVersion: 1,
        activeSessionId: sessionId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      };

      try {
        await setDoc(userDocRef, profile, { merge: true });
      } catch (err) {
        console.warn('Could not create user document in Firestore:', err);
      }
      return profile;
    }
  } catch (error: any) {
    if (error.message && error.message.includes('Maximum 6 active devices reached')) {
      throw error;
    }
    throw new Error(formatFirebaseAuthError(error));
  }
}

/**
 * Real Firebase Administrator Authentication (Supports concurrent Admin devices)
 */
export async function loginAdmin(email: string, password: string): Promise<UserProfile> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    throw new Error('Please enter Admin Email and Password.');
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
    const fbUser = userCredential.user;

    if (!fbUser) {
      throw new Error('Authentication failed.');
    }

    // Verify Admin authorization across all valid schemas
    const { isAdmin, data: adminData } = await verifyAdminStatus(fbUser);

    if (!isAdmin) {
      await signOut(auth);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      throw new Error('You are not authorized to access the Admin Portal.');
    }

    if (adminData && adminData.status === 'disabled') {
      await signOut(auth);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      throw new Error('This administrator account has been disabled.');
    }

    const sessionId = generateSessionId();

    // Register admin device session atomically
    await registerDeviceSession(fbUser.uid, sessionId, 'admin');
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);

    const userDocRef = doc(db, 'users', fbUser.uid);
    try {
      await setDoc(
        userDocRef,
        {
          uid: fbUser.uid,
          email: fbUser.email,
          role: 'admin',
          username: fbUser.email?.split('@')[0] || 'admin',
          displayName: fbUser.displayName || adminData?.displayName || 'Administrator',
          status: 'active',
          sessionVersion: 1,
          activeSessionId: sessionId,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Could not sync admin document:', err);
    }

    return {
      uid: fbUser.uid,
      role: 'admin',
      username: fbUser.email?.split('@')[0] || 'admin',
      displayName: fbUser.displayName || adminData?.displayName || 'Administrator',
      status: 'active',
      sessionVersion: 1,
      activeSessionId: sessionId,
      createdAt: adminData?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
  } catch (error: any) {
    throw new Error(formatFirebaseAuthError(error));
  }
}

/**
 * Universal login dispatcher
 */
export async function loginUser(identifier: string, password: string): Promise<UserProfile> {
  const trimmed = identifier.trim().toLowerCase();
  if (trimmed.includes('@') && !trimmed.endsWith('@hackathon.internal')) {
    return loginAdmin(identifier, password);
  }
  return loginTeam(identifier, password);
}

/**
 * Signs out from Firebase Authentication and clears local storage session
 */
export async function logoutUser(uid?: string, sessionId?: string | null): Promise<void> {
  const activeSid = sessionId || localStorage.getItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);

  if (uid && activeSid) {
    await removeDeviceSession(uid, activeSid);
  }

  await signOut(auth);
}
