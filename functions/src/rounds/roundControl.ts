import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { logAudit } from '../audit/auditLogger';
import { verifyAdmin } from '../utils/adminAuth';

/**
 * Saves a round schedule with validation.
 * Core Principle: Schedule != Activate. Status remains/becomes SCHEDULED.
 * Validates: startAt < endAt.
 * Concurrency Safe: Uses Firestore transaction to prevent race conditions.
 */
export const saveRoundSchedule = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { roundId, startDate, startTime, endDate, endTime, startIso, endIso } = data;
  if (!roundId || !startIso || !endIso) {
    throw new functions.https.HttpsError('invalid-argument', 'roundId, startIso, and endIso are required.');
  }

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
    throw new functions.https.HttpsError('invalid-argument', 'End date and time must be after the start date and time.');
  }

  const db = admin.firestore();
  const roundRef = db.collection('rounds').doc(roundId);
  const timingRef = db.collection('settings').doc('timingConfig');
  const now = admin.firestore.Timestamp.now();
  const adminEmail = context.auth?.token.email || context.auth?.uid || 'admin';

  await db.runTransaction(async (transaction) => {
    const roundDoc = await transaction.get(roundRef);
    const currentStatus = roundDoc.exists ? roundDoc.data()!.status : 'SCHEDULED';
    const status = (currentStatus === 'ACTIVE' || currentStatus === 'LIVE') ? currentStatus : 'SCHEDULED';

    transaction.set(
      roundRef,
      {
        scheduledStartAt: startIso,
        scheduledEndAt: endIso,
        startTime: startIso,
        endTime: endIso,
        startAt: startIso,
        endAt: endIso,
        actualStartedAt: startIso,
        status: status,
        updatedAt: now,
      },
      { merge: true }
    );

    const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
    transaction.set(
      timingRef,
      {
        [roundKey]: {
          startDate: startDate || '',
          startTime: startTime || '',
          endDate: endDate || '',
          endTime: endTime || '',
          startIso: startIso,
          endIso: endIso,
          startAt: startIso,
          endAt: endIso,
          status: status,
        },
        updatedAt: now,
      },
      { merge: true }
    );
  });

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Round Schedule Saved', 'round', roundId, {
    startIso,
    endIso,
    adminEmail,
  });

  return { success: true, message: `Schedule for Round ${roundId} saved successfully.` };
});

/**
 * Explicitly starts/activates a round.
 * Sets status to ACTIVE and records actualStartedAt timestamp.
 * Concurrency Safe: Uses Firestore transaction to prevent duplicate starts from multiple Admins.
 */
export const startRound = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { roundId } = data;
  if (!roundId) throw new functions.https.HttpsError('invalid-argument', 'roundId is required.');

  const db = admin.firestore();
  const roundRef = db.collection('rounds').doc(roundId);
  const timingRef = db.collection('settings').doc('timingConfig');
  const now = admin.firestore.Timestamp.now();
  const adminEmail = context.auth?.token.email || context.auth?.uid || 'admin';

  let wasAlreadyLive = false;

  await db.runTransaction(async (transaction) => {
    const roundDoc = await transaction.get(roundRef);
    if (!roundDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Round "${roundId}" not found.`);
    }

    const roundData = roundDoc.data()!;
    if (roundData.status === 'ACTIVE' || roundData.status === 'LIVE') {
      wasAlreadyLive = true;
      return;
    }

    const endTime = roundData.endTime || roundData.scheduledEndAt || admin.firestore.Timestamp.fromMillis(now.toMillis() + 5 * 24 * 60 * 60 * 1000).toDate().toISOString();

    transaction.set(
      roundRef,
      {
        status: 'ACTIVE',
        actualStartedAt: now,
        activatedAt: now,
        activatedBy: adminEmail,
        startTime: roundData.startTime || roundData.scheduledStartAt || now.toDate().toISOString(),
        endTime: endTime,
        updatedAt: now,
      },
      { merge: true }
    );

    const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
    transaction.set(
      timingRef,
      {
        [roundKey]: {
          status: 'ACTIVE',
          statusOverride: 'FORCE_ACTIVE',
          activatedAt: now,
          activatedBy: adminEmail,
          startIso: roundData.startTime || roundData.scheduledStartAt || now.toDate().toISOString(),
          endIso: endTime,
        },
        updatedAt: now,
      },
      { merge: true }
    );
  });

  if (wasAlreadyLive) {
    return { success: true, message: `Round ${roundId} is already ACTIVE.`, alreadyActive: true };
  }

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Round Started', 'round', roundId, {
    status: 'ACTIVE',
    actualStartedAt: now.toDate().toISOString(),
    adminEmail,
  });

  return { success: true, message: `Round ${roundId} is now ACTIVE and accepting submissions.` };
});

/**
 * Explicitly ends a round.
 * Sets status to ENDED and records actualEndedAt timestamp.
 * Concurrency Safe: Uses Firestore transaction.
 */
export const stopRound = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { roundId } = data;
  if (!roundId) throw new functions.https.HttpsError('invalid-argument', 'roundId is required.');

  const db = admin.firestore();
  const roundRef = db.collection('rounds').doc(roundId);
  const timingRef = db.collection('settings').doc('timingConfig');
  const now = admin.firestore.Timestamp.now();
  const adminEmail = context.auth?.token.email || context.auth?.uid || 'admin';

  await db.runTransaction(async (transaction) => {
    const roundDoc = await transaction.get(roundRef);
    if (!roundDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Round "${roundId}" not found.`);
    }

    transaction.set(
      roundRef,
      {
        status: 'ENDED',
        actualEndedAt: now,
        endedAt: now,
        endedBy: adminEmail,
        updatedAt: now,
      },
      { merge: true }
    );

    const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
    transaction.set(
      timingRef,
      {
        [roundKey]: {
          status: 'ENDED',
          statusOverride: 'FORCE_CLOSED',
          endedAt: now,
          endedBy: adminEmail,
        },
        updatedAt: now,
      },
      { merge: true }
    );
  });

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Round Ended', 'round', roundId, {
    status: 'ENDED',
    actualEndedAt: now.toDate().toISOString(),
    adminEmail,
  });

  return { success: true, message: `Round ${roundId} has ended. Submissions are now closed.` };
});

export const endRound = stopRound;

/**
 * Resets a single round or all rounds back to initial SCHEDULED state.
 * Advances runId and clears execution timestamps.
 * Data Safety: Submissions, scores, teams, and problem statements are NEVER deleted.
 * Concurrency Safe: Transactionally advances runId and updates Firestore atomically.
 */
export const resetRoundState = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { roundId } = data || {};
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const adminEmail = context.auth?.token.email || context.auth?.uid || 'admin';
  const timingDocRef = db.collection('settings').doc('timingConfig');

  let newRunId = 'RUN_002';
  let prevRunId = 'RUN_001';

  await db.runTransaction(async (transaction) => {
    const timingSnap = await transaction.get(timingDocRef);
    const prevTiming = timingSnap.exists ? timingSnap.data() : null;
    prevRunId = prevTiming?.runId || 'RUN_001';

    let nextNum = 2;
    const match = prevRunId.match(/RUN_(\d+)/i);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
    newRunId = `RUN_${String(nextNum).padStart(3, '0')}`;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 5 * 24 * 60 * 60 * 1000);
    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    const freshRoundConfig = {
      startDate: startDate.toISOString().split('T')[0],
      startTime: '09:00',
      endDate: endDate.toISOString().split('T')[0],
      endTime: '18:00',
      startIso,
      endIso,
      status: 'SCHEDULED' as const,
      statusOverride: 'AUTO' as const,
      runId: newRunId,
    };

    if (roundId) {
      const roundRef = db.collection('rounds').doc(roundId);
      transaction.set(
        roundRef,
        {
          status: 'SCHEDULED',
          runId: newRunId,
          startTime: startIso,
          endTime: endIso,
          scheduledStartAt: startIso,
          scheduledEndAt: endIso,
          actualStartedAt: admin.firestore.FieldValue.delete(),
          actualEndedAt: admin.firestore.FieldValue.delete(),
          activatedAt: admin.firestore.FieldValue.delete(),
          activatedBy: admin.firestore.FieldValue.delete(),
          pausedAt: admin.firestore.FieldValue.delete(),
          pausedBy: admin.firestore.FieldValue.delete(),
          endedAt: admin.firestore.FieldValue.delete(),
          endedBy: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true }
      );

      const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
      transaction.set(
        timingDocRef,
        {
          runId: newRunId,
          [roundKey]: { ...freshRoundConfig },
          lastResetAt: now,
          lastResetBy: adminEmail,
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      transaction.set(
        timingDocRef,
        {
          hackathonStartDate: freshRoundConfig.startDate,
          hackathonStartTime: '09:00',
          hackathonEndDate: freshRoundConfig.endDate,
          hackathonEndTime: '18:00',
          hackathonStartIso: startIso,
          hackathonEndIso: endIso,
          timezone: 'Asia/Kolkata',
          runId: newRunId,
          round1: { ...freshRoundConfig },
          round2: { ...freshRoundConfig },
          round3: { ...freshRoundConfig },
          lastResetAt: now,
          lastResetBy: adminEmail,
          updatedAt: now,
        },
        { merge: true }
      );

      const allRounds = ['round1', 'round2', 'round3'];
      for (const rId of allRounds) {
        transaction.set(
          db.collection('rounds').doc(rId),
          {
            status: 'SCHEDULED',
            runId: newRunId,
            startTime: startIso,
            endTime: endIso,
            scheduledStartAt: startIso,
            scheduledEndAt: endIso,
            actualStartedAt: admin.firestore.FieldValue.delete(),
            actualEndedAt: admin.firestore.FieldValue.delete(),
            activatedAt: admin.firestore.FieldValue.delete(),
            activatedBy: admin.firestore.FieldValue.delete(),
            pausedAt: admin.firestore.FieldValue.delete(),
            pausedBy: admin.firestore.FieldValue.delete(),
            endedAt: admin.firestore.FieldValue.delete(),
            endedBy: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }
  });

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Round Execution State Reset', 'round', roundId || 'all_rounds', {
    previousRunId: prevRunId,
    newRunId,
    roundId: roundId || 'ALL',
    adminEmail,
  });

  return {
    success: true,
    previousRunId: prevRunId,
    newRunId,
    message: roundId
      ? `Round ${roundId} execution state reset successfully to ${newRunId}.`
      : `All rounds execution state reset successfully to ${newRunId}.`,
  };
});

export const resetHackathonState = resetRoundState;

/**
 * Updates round configuration
 */
export const updateRoundConfig = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { roundId, ...config } = data;
  if (!roundId) throw new functions.https.HttpsError('invalid-argument', 'roundId is required.');

  const db = admin.firestore();
  const roundRef = db.collection('rounds').doc(roundId);
  const now = admin.firestore.Timestamp.now();

  await roundRef.set(
    {
      ...config,
      updatedAt: now,
    },
    { merge: true }
  );

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Round Config Updated', 'round', roundId, {
    updatedFields: Object.keys(config),
  });

  return { success: true, message: `Round ${roundId} config updated successfully.` };
});

/**
 * Updates timing configuration
 */
export const updateTimingConfig = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);
  const { timingConfig } = data;
  if (!timingConfig) throw new functions.https.HttpsError('invalid-argument', 'timingConfig is required.');

  const db = admin.firestore();
  const timingRef = db.collection('settings').doc('timingConfig');
  const now = admin.firestore.Timestamp.now();

  await timingRef.set(
    {
      ...timingConfig,
      updatedAt: now,
    },
    { merge: true }
  );

  await logAudit(context.auth!.uid, context.auth!.token.email, 'Timing Config Updated', 'round', 'timingConfig', {});

  return { success: true, message: 'Timing configuration updated successfully.' };
});
