import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Server-side Admin Authorization Guard
 * 1. Verifies Firebase Authentication session.
 * 2. Verifies Custom Claims (role === 'admin' or admin === true).
 * 3. Falls back to checking Firestore 'admin', 'admins', or 'users' collection.
 * 4. Automatically sets Firebase Custom Claims (role: 'admin') for future requests.
 */
export async function verifyAdmin(context: functions.https.CallableContext): Promise<string> {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const uid = context.auth.uid;
  const token = context.auth.token;

  if (token.role === 'admin' || token.admin === true) {
    return uid;
  }

  const db = admin.firestore();
  let isAdminConfirmed = false;

  // 1. Check users/{uid}
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists && (userDoc.data()?.role === 'admin' || userDoc.data()?.isAdmin === true)) {
    isAdminConfirmed = true;
  }

  // 2. Check admin/{uid} or admins/{uid}
  if (!isAdminConfirmed) {
    const adminDoc = await db.collection('admin').doc(uid).get();
    if (adminDoc.exists && (adminDoc.data()?.role === 'admin' || adminDoc.data()?.role === undefined)) {
      isAdminConfirmed = true;
    }
  }

  if (!isAdminConfirmed) {
    const adminsDoc = await db.collection('admins').doc(uid).get();
    if (adminsDoc.exists && (adminsDoc.data()?.role === 'admin' || adminsDoc.data()?.role === undefined)) {
      isAdminConfirmed = true;
    }
  }

  // 3. Check by email query if UID document is not direct key
  if (!isAdminConfirmed && token.email) {
    const cleanEmail = token.email.toLowerCase().trim();

    const [adminByEmail, adminsByEmail, usersByEmail] = await Promise.all([
      db.collection('admin').where('email', '==', cleanEmail).limit(1).get().catch(() => null),
      db.collection('admins').where('email', '==', cleanEmail).limit(1).get().catch(() => null),
      db.collection('users').where('email', '==', cleanEmail).limit(1).get().catch(() => null),
    ]);

    if (adminByEmail && !adminByEmail.empty) isAdminConfirmed = true;
    if (adminsByEmail && !adminsByEmail.empty) isAdminConfirmed = true;
    if (usersByEmail && !usersByEmail.empty && (usersByEmail.docs[0].data().role === 'admin' || usersByEmail.docs[0].data().isAdmin === true)) {
      isAdminConfirmed = true;
    }
  }

  if (isAdminConfirmed) {
    // Automatically set Custom Claims for subsequent requests
    try {
      await admin.auth().setCustomUserClaims(uid, { role: 'admin' });
    } catch (err) {
      console.warn('Could not set custom user claims on admin user:', err);
    }
    return uid;
  }

  throw new functions.https.HttpsError('permission-denied', 'Access denied. Administrator privileges required.');
}
