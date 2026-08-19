import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { logAudit } from '../audit/auditLogger';
import { verifyAdmin } from '../utils/adminAuth';

/**
 * Saves selection status for teams (SELECTED vs NOT_SELECTED)
 */
export const saveTeamSelections = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { selectedTeamIds } = data;
  if (!Array.isArray(selectedTeamIds)) {
    throw new functions.https.HttpsError('invalid-argument', 'selectedTeamIds array is required.');
  }

  const db = admin.firestore();
  const teamsSnap = await db.collection('teams').get();
  const selectedSet = new Set(selectedTeamIds);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();

  teamsSnap.forEach((doc) => {
    const teamId = doc.id;
    const teamData = doc.data();
    const isSelected = selectedSet.has(teamId);
    const status = isSelected ? 'SELECTED' : 'NOT_SELECTED';

    const selectionRef = db.collection('selections').doc(teamId);
    batch.set(
      selectionRef,
      {
        teamId,
        teamName: teamData.teamName || teamId,
        leaderName: teamData.leaderName || '',
        status,
        updatedBy: context.auth!.token.email || context.auth!.uid,
        updatedAt: now,
      },
      { merge: true }
    );

    // Also update team doc
    batch.update(doc.ref, {
      selected: isSelected,
      selectionStatus: status,
      updatedAt: now,
    });
  });

  // Also update /selection/current
  const currentSelRef = db.collection('selection').doc('current');
  batch.set(
    currentSelRef,
    {
      selectedTeamIds,
      totalSelected: selectedTeamIds.length,
      totalTeams: teamsSnap.size,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Team Selected',
    'selection',
    'bulk',
    { selectedCount: selectedTeamIds.length, totalTeams: teamsSnap.size }
  );

  return {
    success: true,
    selectedCount: selectedTeamIds.length,
    message: `${selectedTeamIds.length} teams marked as SELECTED.`,
  };
});

/**
 * Publishes or unpublishes the selection announcement to the public dashboard
 */
export const setSelectionPublishStatus = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { isPublished } = data;
  if (typeof isPublished !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'isPublished boolean is required.');
  }

  const db = admin.firestore();
  const selectionsSnap = await db.collection('selections').get();
  const teamsSnap = await db.collection('teams').get();
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  selectionsSnap.forEach((doc) => {
    batch.update(doc.ref, {
      isPublished,
      updatedAt: now,
    });
  });

  teamsSnap.forEach((doc) => {
    batch.update(doc.ref, {
      isSelectionPublished: isPublished,
      updatedAt: now,
    });
  });

  // Update /selection/current
  const currentSelRef = db.collection('selection').doc('current');
  batch.set(
    currentSelRef,
    {
      status: isPublished ? 'LIVE' : 'DRAFT',
      isPublished,
      publishedAt: isPublished ? now : null,
      publishedBy: context.auth!.token.email || context.auth!.uid,
      updatedAt: now,
    },
    { merge: true }
  );

  // Also update public settings doc
  const settingsRef = db.collection('settings').doc('selectionAnnouncement');
  batch.set(
    settingsRef,
    {
      isPublished,
      publishedAt: isPublished ? now : null,
      publishedBy: context.auth!.token.email || context.auth!.uid,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    isPublished ? 'Selection Published' : 'Selection Unpublished',
    'selection',
    'announcement',
    { isPublished }
  );

  return {
    success: true,
    isPublished,
    message: isPublished ? 'Team selection is now published publicly.' : 'Team selection has been unpublished.',
  };
});
