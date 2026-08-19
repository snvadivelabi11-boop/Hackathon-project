import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

// URL validator helper
function isValidUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isGitHubUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return (
      (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') &&
      parsed.pathname.split('/').filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

/**
 * Strictly verifies the server-side round status and timing window.
 * Enforces: SCHEDULE ≠ ACTIVATE rule. Only ACTIVE rounds accept uploads.
 * Server timestamp verification protects against client clock tampering.
 */
async function verifyRoundSubmissionWindow(db: admin.firestore.Firestore, roundId: string) {
  const roundDoc = await db.collection('rounds').doc(roundId).get();
  if (!roundDoc.exists) {
    throw new functions.https.HttpsError('not-found', `Round "${roundId}" not found.`);
  }

  const roundData = roundDoc.data()!;
  const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
  const roundNum = roundId.includes('1') ? 1 : roundId.includes('2') ? 2 : 3;

  const now = admin.firestore.Timestamp.now();
  const serverMs = now.toMillis();

  let effectiveStatus = roundData.status || 'SCHEDULED';
  let endTimeMs: number | null = null;

  try {
    const timingDoc = await db.collection('settings').doc('timingConfig').get();
    if (timingDoc.exists) {
      const tData = timingDoc.data()!;
      const rCfg = tData[roundKey];
      if (rCfg?.status) {
        effectiveStatus = rCfg.status;
      }
      if (rCfg?.endIso) {
        endTimeMs = new Date(rCfg.endIso).getTime();
      }
    }
  } catch (err: any) {
    if (err instanceof functions.https.HttpsError) throw err;
  }

  if (endTimeMs === null && roundData.endTime) {
    endTimeMs = typeof roundData.endTime.toMillis === 'function'
      ? roundData.endTime.toMillis()
      : new Date(roundData.endTime).getTime();
  }

  // 1. Check explicit non-active states
  if (effectiveStatus === 'SCHEDULED' || roundData.status === 'SCHEDULED') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Round ${roundNum} has not started yet. Submissions open only after Administrator activation.`
    );
  }

  if (effectiveStatus === 'PAUSED' || roundData.status === 'PAUSED') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Round ${roundNum} is currently PAUSED by Administrator. Submissions are temporarily closed.`
    );
  }

  if (effectiveStatus === 'LOCKED' || roundData.status === 'LOCKED') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Round ${roundNum} is LOCKED by Administrator.`
    );
  }

  if (effectiveStatus === 'ENDED' || roundData.status === 'ENDED') {
    throw new functions.https.HttpsError(
      'deadline-exceeded',
      `Round ${roundNum} has ENDED. New submissions are closed.`
    );
  }

  if (effectiveStatus !== 'ACTIVE' && roundData.status !== 'ACTIVE') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Round ${roundNum} is not active for submissions.`
    );
  }

  // 2. For ACTIVE round, check if deadline has passed in server time
  if (endTimeMs !== null && !isNaN(endTimeMs) && serverMs > endTimeMs) {
    throw new functions.https.HttpsError(
      'deadline-exceeded',
      `Submission period for Round ${roundNum} has ENDED. New submissions are closed.`
    );
  }

  return { roundData, roundNum };
}

/**
 * Generates secure server-side signed parameters for Cloudinary direct upload.
 * Validates caller's team identity, active round timing window, and strict folder destination.
 * The Cloudinary API Secret is NEVER exposed to client.
 */
export const getCloudinaryUploadSignature = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { roundId, originalFileName } = data || {};
  if (!roundId) {
    throw new functions.https.HttpsError('invalid-argument', 'roundId is required.');
  }

  const uid = context.auth.uid;
  const db = admin.firestore();

  // 1. Verify user and team association
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User record not found.');

  const userData = userDoc.data()!;
  if (userData.status === 'disabled') {
    throw new functions.https.HttpsError('permission-denied', 'This account has been disabled.');
  }

  const teamId = userData.teamId;
  if (!teamId) {
    throw new functions.https.HttpsError('permission-denied', 'No team profile linked to this user.');
  }

  // 2. Validate Round Active Window & Server Timing Authority
  await verifyRoundSubmissionWindow(db, roundId);

  // 3. Build Cloudinary signed payload
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || functions.config().cloudinary?.cloud_name || '';
  const apiKey = process.env.CLOUDINARY_API_KEY || functions.config().cloudinary?.api_key || '';
  const apiSecret = process.env.CLOUDINARY_API_SECRET || functions.config().cloudinary?.api_secret || '';

  const timestamp = Math.round(new Date().getTime() / 1000);
  const folder = `hackathon/teams/${teamId}/${roundId}`;
  const cleanName = (originalFileName || 'submission').replace(/[^a-zA-Z0-9_-]/g, '_');
  const publicId = `${Date.now()}_${cleanName}`;

  // Generate SHA-1 signature
  const stringToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = apiSecret ? crypto.createHash('sha1').update(stringToSign).digest('hex') : '';

  return {
    success: true,
    cloudName,
    apiKey,
    timestamp,
    folder,
    publicId,
    signature,
    teamId,
    roundId,
  };
});

/**
 * Submits file submission for Round 1 (Architecture Solution) or Round 2 (PPT Presentation).
 */
export const submitFile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { roundId, fileUrl, fileName, fileType, fileSizeBytes, publicId, resourceType, format } = data || {};
  if (!roundId || !fileUrl || !fileName) {
    throw new functions.https.HttpsError('invalid-argument', 'roundId, fileUrl, and fileName are required.');
  }

  const db = admin.firestore();
  const uid = context.auth.uid;

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

  const userData = userDoc.data()!;
  if (userData.status === 'disabled') throw new functions.https.HttpsError('permission-denied', 'Account is disabled.');

  const teamId = userData.teamId;
  if (!teamId) throw new functions.https.HttpsError('permission-denied', 'No team linked with this account.');

  const teamDoc = await db.collection('teams').doc(teamId).get();
  const teamName = teamDoc.exists ? teamDoc.data()!.teamName : teamId;

  // Validate Round & Server Timing Window Authority
  const { roundData, roundNum } = await verifyRoundSubmissionWindow(db, roundId);
  const now = admin.firestore.Timestamp.now();

  const submissionId = `${teamId}_${roundId}`;
  const submissionRef = db.collection('submissions').doc(submissionId);
  const existingSub = await submissionRef.get();

  if (existingSub.exists && !roundData.allowResubmission) {
    throw new functions.https.HttpsError('already-exists', 'Submission already received. Resubmission is disabled.');
  }

  const currentVersion = existingSub.exists ? (existingSub.data()!.version || 1) + 1 : 1;

  const submissionData = {
    id: submissionId,
    teamId,
    teamName,
    roundId,
    round: roundNum,
    submissionType: roundNum === 1 ? 'architecture' : 'presentation',
    type: roundNum === 1 ? 'architecture' : 'ppt',
    fileUrl,
    fileName,
    originalFileName: fileName,
    cloudinaryPublicId: publicId || null,
    cloudinaryUrl: fileUrl,
    publicId: publicId || null,
    resourceType: resourceType || (roundNum === 1 && fileName.match(/\.(png|jpg|jpeg|webp)$/i) ? 'image' : 'raw'),
    format: format || fileName.split('.').pop() || '',
    fileType: fileType || 'application/octet-stream',
    fileSize: fileSizeBytes || 0,
    fileSizeBytes: fileSizeBytes || 0,
    submittedAt: now,
    uploadedAt: now,
    submittedByUid: uid,
    version: currentVersion,
    status: 'submitted',
    score: null,
  };

  // 1. Store in top-level /submissions collection
  await submissionRef.set(submissionData, { merge: true });

  // 2. Store in nested /teams/{teamId}/submissions/{roundId} collection
  await db.collection('teams').doc(teamId).collection('submissions').doc(roundId).set(submissionData, { merge: true });

  // 3. Update team submission indicator
  const teamUpdateField = roundNum === 1
    ? { round1Submitted: true, updatedAt: now }
    : roundNum === 2
    ? { round2Submitted: true, updatedAt: now }
    : { round3Submitted: true, updatedAt: now };

  await db.collection('teams').doc(teamId).set(teamUpdateField, { merge: true });

  return {
    success: true,
    submissionId,
    teamId,
    roundId,
    fileName,
    submittedAt: now.toDate().toISOString(),
    message: 'Submission successfully uploaded to Cloudinary and recorded in Firestore.',
  };
});

/**
 * Submits Prototype repository & application URLs for Round 3.
 */
export const submitGithub = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { roundId, githubUrl, prototypeUrl, notes } = data || {};
  if (!roundId || !githubUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'roundId and githubUrl are required.');
  }

  if (!isGitHubUrl(githubUrl)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid GitHub repository URL. Format must be: https://github.com/username/repository');
  }

  if (prototypeUrl && !isValidUrl(prototypeUrl)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid prototype URL format.');
  }

  const db = admin.firestore();
  const uid = context.auth.uid;

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  const userData = userDoc.data()!;
  if (userData.status === 'disabled') throw new functions.https.HttpsError('permission-denied', 'Account is disabled.');

  const teamId = userData.teamId;
  if (!teamId) throw new functions.https.HttpsError('permission-denied', 'No team linked with this account.');

  const teamDoc = await db.collection('teams').doc(teamId).get();
  const teamName = teamDoc.exists ? teamDoc.data()!.teamName : teamId;

  // Validate Round & Server Timing Window Authority
  const { roundData, roundNum } = await verifyRoundSubmissionWindow(db, roundId);
  const now = admin.firestore.Timestamp.now();

  const submissionId = `${teamId}_${roundId}`;
  const submissionRef = db.collection('submissions').doc(submissionId);
  const existingSub = await submissionRef.get();

  const currentVersion = existingSub.exists ? (existingSub.data()!.version || 1) + 1 : 1;

  const submissionData = {
    id: submissionId,
    teamId,
    teamName,
    roundId,
    round: 3,
    submissionType: 'github',
    type: 'github',
    githubUrl: githubUrl.trim(),
    repositoryUrl: githubUrl.trim(),
    prototypeUrl: prototypeUrl ? prototypeUrl.trim() : '',
    notes: notes ? notes.trim() : '',
    submittedAt: now,
    uploadedAt: now,
    submittedByUid: uid,
    version: currentVersion,
    status: 'submitted',
    score: null,
  };

  await submissionRef.set(submissionData, { merge: true });
  await db.collection('teams').doc(teamId).collection('submissions').doc(roundId).set(submissionData, { merge: true });
  await db.collection('teams').doc(teamId).set({ round3Submitted: true, updatedAt: now }, { merge: true });

  return {
    success: true,
    submissionId,
    teamId,
    roundId,
    githubUrl,
    submittedAt: now.toDate().toISOString(),
    message: 'Round 3 prototype submitted successfully.',
  };
});
