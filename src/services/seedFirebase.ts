import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_ROUNDS_STRUCTURE } from './rounds.service';

/**
 * Initializes default rounds (10 + 30 + 50 = 90 Marks) and settings in Firestore
 */
export async function seedInitialFirestoreData(): Promise<{ success: boolean; message: string }> {
  try {
    for (const round of DEFAULT_ROUNDS_STRUCTURE) {
      const roundRef = doc(db, 'rounds', round.id);
      await setDoc(roundRef, {
        name: round.name,
        roundNumber: round.roundNumber,
        description: round.description,
        problemStatement: round.problemStatement || '',
        instructions: round.instructions || [],
        startTime: round.startTime,
        endTime: round.endTime,
        maxMarks: round.maxMarks,
        status: round.status,
        allowResubmission: round.allowResubmission,
        allowedFileTypes: round.allowedFileTypes,
        maxFileSize: round.maxFileSize,
        criteria: round.criteria,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    const settingsRef = doc(db, 'settings', 'general');
    await setDoc(settingsRef, {
      hackathonName: 'Hackathon 2026',
      timezone: 'Asia/Kolkata',
      totalTeamsCapacity: 100,
      totalMaxMarks: 90,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    const scoringRef = doc(db, 'settings', 'scoringConfig');
    await setDoc(scoringRef, {
      round1MaxMarks: 10,
      round2MaxMarks: 30,
      round3MaxMarks: 50,
      totalMaxMarks: 90,
      updatedAt: serverTimestamp(),
      updatedBy: 'system_seed',
    }, { merge: true });

    return {
      success: true,
      message: 'Official scoring configuration and round schemas initialized in Firestore!',
    };
  } catch (error: any) {
    console.error('Error seeding initial Firestore data:', error);
    throw new Error(error.message || 'Failed to initialize Firestore.');
  }
}
