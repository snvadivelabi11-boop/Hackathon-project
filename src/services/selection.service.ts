import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../firebase/config';
import { TeamSelection } from '../types';
import { safeString } from '../utils/normalize';

export interface CurrentSelectionState {
  status: 'LIVE' | 'DRAFT';
  isPublished: boolean;
  selectedTeamIds: string[];
  totalSelected: number;
  publishedAt: any;
  publishedBy?: string;
  updatedAt: any;
}

export const normalizeTeamSelection = (data: any, id: string = ''): TeamSelection => {
  if (!data) data = {};
  const teamId = safeString(data.teamId || data.id || id);
  return {
    teamId,
    teamName: safeString(data.teamName || teamId),
    leaderName: safeString(data.leaderName || ''),
    status: data.status === 'SELECTED' ? 'SELECTED' : 'NOT_SELECTED',
    isPublished: Boolean(data.isPublished),
    totalScore: typeof data.totalScore === 'number' ? data.totalScore : 0,
    updatedBy: safeString(data.updatedBy),
    updatedAt: data.updatedAt || null,
  };
};

/**
 * Subscribes to the global selection state (/selection/current)
 */
export function subscribeToCurrentSelectionState(
  callback: (state: CurrentSelectionState) => void
): () => void {
  const currentDocRef = doc(db, 'selection', 'current');
  return onSnapshot(
    currentDocRef,
    (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        callback({
          status: d.status === 'LIVE' ? 'LIVE' : 'DRAFT',
          isPublished: d.isPublished === true || d.status === 'LIVE',
          selectedTeamIds: Array.isArray(d.selectedTeamIds) ? d.selectedTeamIds : [],
          totalSelected: Array.isArray(d.selectedTeamIds) ? d.selectedTeamIds.length : (d.totalSelected || 0),
          publishedAt: d.publishedAt || null,
          publishedBy: safeString(d.publishedBy),
          updatedAt: d.updatedAt || null,
        });
      } else {
        callback({
          status: 'DRAFT',
          isPublished: false,
          selectedTeamIds: [],
          totalSelected: 0,
          publishedAt: null,
          updatedAt: null,
        });
      }
    },
    (err) => {
      console.warn('[SelectionService] subscribeToCurrentSelectionState error:', err);
      callback({
        status: 'DRAFT',
        isPublished: false,
        selectedTeamIds: [],
        totalSelected: 0,
        publishedAt: null,
        updatedAt: null,
      });
    }
  );
}

/**
 * Subscribes to all selection records (Admin view) from Firestore
 */
export function subscribeToAllSelections(callback: (selections: TeamSelection[]) => void): () => void {
  const q = query(collection(db, 'selections'));
  return onSnapshot(
    q,
    (snap) => {
      const list: TeamSelection[] = [];
      snap.forEach((d) => list.push(normalizeTeamSelection(d.data(), d.id)));
      callback(list);
    },
    (err) => {
      console.error('[SelectionService] subscribeToAllSelections error:', err);
      callback([]);
    }
  );
}

/**
 * Subscribes to publicly published selections from Firestore
 */
export function subscribeToPublicSelections(callback: (selections: TeamSelection[]) => void): () => void {
  const q = query(
    collection(db, 'selections'),
    where('status', '==', 'SELECTED'),
    where('isPublished', '==', true)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: TeamSelection[] = [];
      snap.forEach((d) => list.push(normalizeTeamSelection(d.data(), d.id)));
      callback(list);
    },
    (err) => {
      console.warn('[SelectionService] subscribeToPublicSelections error:', err);
      callback([]);
    }
  );
}

/**
 * Subscribes to selection status for a specific logged-in team
 */
export function subscribeToTeamSelection(
  teamId: string,
  callback: (selection: TeamSelection | null) => void
): () => void {
  if (!teamId) {
    callback(null);
    return () => {};
  }
  const selRef = doc(db, 'selections', teamId);
  return onSnapshot(
    selRef,
    (snap) => {
      if (snap.exists()) {
        callback(normalizeTeamSelection(snap.data(), snap.id));
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('[SelectionService] subscribeToTeamSelection error:', err);
      callback(null);
    }
  );
}

/**
 * Saves team selection list (Selected vs Not Selected) persistently to Firestore
 */
export async function saveTeamSelections(
  selectedTeamIds: string[],
  publishLive: boolean = false
): Promise<void> {
  const selectedSet = new Set(selectedTeamIds);
  const teamsSnap = await getDocs(collection(db, 'teams'));
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const adminEmail = auth.currentUser?.email || auth.currentUser?.uid || 'admin';

  teamsSnap.forEach((teamDoc) => {
    const teamId = teamDoc.id;
    const teamData = teamDoc.data();
    const isSelected = selectedSet.has(teamId);
    const status = isSelected ? 'SELECTED' : 'NOT_SELECTED';

    // Update /selections/{teamId}
    const selRef = doc(db, 'selections', teamId);
    batch.set(
      selRef,
      {
        teamId,
        teamName: teamData.teamName || teamId,
        leaderName: teamData.leaderName || '',
        status,
        isPublished: publishLive,
        publishedAt: publishLive ? now : null,
        updatedBy: adminEmail,
        updatedAt: now,
      },
      { merge: true }
    );

    // Update /teams/{teamId}
    batch.update(teamDoc.ref, {
      selected: isSelected,
      selectionStatus: status,
      isSelectionPublished: publishLive,
      updatedAt: now,
    });
  });

  // Update /selection/current
  const currentRef = doc(db, 'selection', 'current');
  batch.set(
    currentRef,
    {
      status: publishLive ? 'LIVE' : 'DRAFT',
      isPublished: publishLive,
      selectedTeamIds,
      totalSelected: selectedTeamIds.length,
      totalTeams: teamsSnap.size,
      publishedAt: publishLive ? now : null,
      publishedBy: publishLive ? adminEmail : null,
      updatedAt: now,
    },
    { merge: true }
  );

  // Update /settings/selectionAnnouncement
  const settingsRef = doc(db, 'settings', 'selectionAnnouncement');
  batch.set(
    settingsRef,
    {
      isPublished: publishLive,
      publishedAt: publishLive ? now : null,
      publishedBy: adminEmail,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  // Audit log
  const auditDocRef = doc(collection(db, 'auditLogs'));
  await setDoc(auditDocRef, {
    id: auditDocRef.id,
    adminUid: auth.currentUser?.uid || 'admin',
    adminEmail,
    action: publishLive ? 'Selection Published Live' : 'Selection Saved Draft',
    targetType: 'selection',
    targetId: 'bulk',
    timestamp: new Date().toISOString(),
    metadata: { selectedCount: selectedTeamIds.length, totalTeams: teamsSnap.size, isPublished: publishLive },
  }).catch(() => {});
}

/**
 * Publishes or unpublishes the selection announcement in Firestore
 */
export async function setSelectionPublishStatus(isPublished: boolean): Promise<void> {
  const selectionsSnap = await getDocs(collection(db, 'selections'));
  const teamsSnap = await getDocs(collection(db, 'teams'));
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const adminEmail = auth.currentUser?.email || auth.currentUser?.uid || 'admin';

  selectionsSnap.forEach((d) => {
    batch.update(d.ref, {
      isPublished,
      publishedAt: isPublished ? now : null,
      updatedAt: now,
    });
  });

  teamsSnap.forEach((d) => {
    batch.update(d.ref, {
      isSelectionPublished: isPublished,
      updatedAt: now,
    });
  });

  // Update /selection/current
  const currentRef = doc(db, 'selection', 'current');
  batch.set(
    currentRef,
    {
      status: isPublished ? 'LIVE' : 'DRAFT',
      isPublished,
      publishedAt: isPublished ? now : null,
      publishedBy: isPublished ? adminEmail : null,
      updatedAt: now,
    },
    { merge: true }
  );

  // Update /settings/selectionAnnouncement
  const settingsRef = doc(db, 'settings', 'selectionAnnouncement');
  batch.set(
    settingsRef,
    {
      isPublished,
      publishedAt: isPublished ? now : null,
      publishedBy: adminEmail,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  // Audit log
  const auditDocRef = doc(collection(db, 'auditLogs'));
  await setDoc(auditDocRef, {
    id: auditDocRef.id,
    adminUid: auth.currentUser?.uid || 'admin',
    adminEmail,
    action: isPublished ? 'Selection Published' : 'Selection Unpublished',
    targetType: 'selection',
    targetId: 'announcement',
    timestamp: new Date().toISOString(),
    metadata: { isPublished },
  }).catch(() => {});
}
