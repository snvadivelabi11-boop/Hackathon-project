import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { Submission } from '../types';
import { calculateRoundTimingEvaluation } from './timing.service';

export interface CloudinaryUploadResult {
  downloadUrl: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  storagePath: string;
  publicId: string;
  format?: string;
  resourceType?: string;
  originalFilename?: string;
  createdAt?: string;
}

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

function getEnv(key: string, fallback: string = ''): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      return (import.meta as any).env[key] || fallback;
    }
    const g = typeof globalThis !== 'undefined' ? (globalThis as any) : typeof window !== 'undefined' ? (window as any) : {};
    if (g.process && g.process.env && g.process.env[key]) {
      return g.process.env[key] || fallback;
    }
  } catch {}
  return fallback;
}

/**
 * Retrieves the active Cloudinary configuration from Firestore or .env
 */
export async function getActiveCloudinaryConfig(): Promise<CloudinaryConfig> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'cloudinary')).catch(() => null);
    if (snap && snap.exists()) {
      const data = snap.data();
      if (data.cloudName && data.uploadPreset) {
        return {
          cloudName: data.cloudName.trim(),
          uploadPreset: data.uploadPreset.trim(),
        };
      }
    }
  } catch {}

  return {
    cloudName: getEnv('VITE_CLOUDINARY_CLOUD_NAME', 'netohl2a').trim(),
    uploadPreset: getEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'hackathon_uploads').trim(),
  };
}

/**
 * Allows Admin to save or update the Cloudinary configuration in Firestore
 */
export async function saveCloudinaryConfig(config: CloudinaryConfig): Promise<void> {
  await setDoc(doc(db, 'settings', 'cloudinary'), {
    cloudName: config.cloudName.trim(),
    uploadPreset: config.uploadPreset.trim(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Subscribes to Cloudinary configuration changes (Admin Settings)
 */
export function subscribeToCloudinaryConfig(callback: (config: CloudinaryConfig) => void): () => void {
  const ref = doc(db, 'settings', 'cloudinary');
  return onSnapshot(ref, (snap) => {
    if (snap.exists() && snap.data()?.cloudName) {
      callback({
        cloudName: snap.data().cloudName,
        uploadPreset: snap.data().uploadPreset,
      });
    } else {
      callback({
        cloudName: getEnv('VITE_CLOUDINARY_CLOUD_NAME', 'netohl2a').trim(),
        uploadPreset: getEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'hackathon_uploads').trim(),
      });
    }
  });
}

/**
 * Validates file extension, MIME type, and size before initiating upload.
 */
export function validateSubmissionFile(roundId: string, file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected for upload.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds the 50 MB limit (Selected file: ${(file.size / (1024 * 1024)).toFixed(2)} MB).`,
    };
  }

  const fileName = file.name.toLowerCase();
  const ext = fileName.split('.').pop() || '';

  if (roundId.includes('1')) {
    const allowedR1 = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg'];
    if (!allowedR1.includes(ext)) {
      return {
        valid: false,
        error: 'Invalid file format for Round 1. Only PDF documents (.pdf) and images (.png, .jpg, .jpeg, .webp) are accepted.',
      };
    }
  } else if (roundId.includes('2')) {
    const allowedR2 = ['ppt', 'pptx', 'pdf'];
    if (!allowedR2.includes(ext)) {
      return {
        valid: false,
        error: 'Invalid file format for Round 2. Only presentation slides (.ppt, .pptx) or PDF (.pdf) are accepted.',
      };
    }
  }

  return { valid: true };
}

import { normalizeSubmission } from '../utils/normalize';

/**
 * Subscribes to all submissions (Admin) in real-time from Firestore
 */
export function subscribeToAllSubmissions(callback: (subs: Submission[]) => void): () => void {
  const q = query(collection(db, 'submissions'), orderBy('submittedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const subs: Submission[] = [];
      snapshot.forEach((d) => {
        subs.push(normalizeSubmission(d.data(), d.id));
      });
      callback(subs);
    },
    (err) => {
      console.error('[SubmissionsService] subscribeToAllSubmissions error:', err);
      getDocs(collection(db, 'submissions')).then((snap) => {
        const list: Submission[] = [];
        snap.forEach((d) => list.push(normalizeSubmission(d.data(), d.id)));
        callback(list);
      }).catch(() => callback([]));
    }
  );
}

/**
 * Subscribes to submissions for a specific team in real-time from Firestore
 */
export function subscribeToTeamSubmissions(
  teamId: string,
  callback: (subs: Submission[]) => void
): () => void {
  if (!teamId) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'submissions'), where('teamId', '==', teamId));
  return onSnapshot(
    q,
    (snapshot) => {
      const subs: Submission[] = [];
      snapshot.forEach((d) => {
        subs.push(normalizeSubmission(d.data(), d.id));
      });
      callback(subs);
    },
    (err) => {
      console.warn('[SubmissionsService] subscribeToTeamSubmissions error:', err);
      callback([]);
    }
  );
}

/**
 * Uploads a submission file directly to Cloudinary using the configured UNSIGNED upload preset.
 * Folder structure: hackathon/teams/{teamId}/{roundId}/
 * Single file storage provider: Cloudinary.
 */
export async function uploadSubmissionFile(
  teamId: string,
  roundId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<CloudinaryUploadResult> {
  // 1. Validate File locally
  const validation = validateSubmissionFile(roundId, file);
  if (!validation.valid) {
    throw new Error(validation.error || 'File validation failed.');
  }

  // 2. Fetch and validate Cloudinary configuration
  const config = await getActiveCloudinaryConfig();
  if (!config.cloudName) {
    throw new Error('Cloudinary Cloud Name is not configured. Please set VITE_CLOUDINARY_CLOUD_NAME in .env or Admin Settings.');
  }
  if (!config.uploadPreset) {
    throw new Error('Cloudinary Upload Preset is not configured. Please set VITE_CLOUDINARY_UPLOAD_PRESET in .env or Admin Settings.');
  }

  const cleanFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const targetFolder = `hackathon/teams/${teamId}/${roundId}`;
  const targetPublicId = `${Date.now()}_${cleanFileName}`;

  // 3. Send direct XMLHttpRequest to Cloudinary with explicit 45-second timeout
  return new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    formData.append('file', file);
    formData.append('upload_preset', config.uploadPreset);
    formData.append('folder', targetFolder);
    formData.append('public_id', targetPublicId);

    xhr.timeout = 45000; // 45s timeout to prevent infinite spinner

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(Math.min(99, percent));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (onProgress) onProgress(100);
          resolve({
            downloadUrl: response.secure_url || response.url,
            fileName: file.name,
            fileType: file.type || response.format || 'application/octet-stream',
            sizeBytes: response.bytes || file.size,
            storagePath: response.public_id || `${targetFolder}/${targetPublicId}`,
            publicId: response.public_id || `${targetFolder}/${targetPublicId}`,
            format: response.format || file.name.split('.').pop(),
            resourceType: response.resource_type || 'raw',
            originalFilename: response.original_filename || file.name,
            createdAt: response.created_at,
          });
        } catch (parseErr) {
          reject(new Error('Cloudinary returned invalid JSON response.'));
        }
      } else {
        let errorMsg = `Cloudinary upload failed (HTTP ${xhr.status})`;
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData?.error?.message) {
            const rawMsg = errData.error.message;
            if (rawMsg.toLowerCase().includes('upload preset not found') || rawMsg.toLowerCase().includes('preset')) {
              errorMsg = `Upload preset "${config.uploadPreset}" was not found in Cloudinary account "${config.cloudName}". Please ensure an UNSIGNED upload preset named "${config.uploadPreset}" is created in your Cloudinary console (Settings → Upload → Upload presets) or update the preset name in Admin Settings / .env.`;
            } else {
              errorMsg = `Cloudinary: ${rawMsg}`;
            }
          }
        } catch {}
        reject(new Error(errorMsg));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during Cloudinary upload. Please check your internet connection and CORS settings.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Cloudinary upload timed out after 45 seconds. Please try again.'));
    };

    xhr.onabort = () => {
      reject(new Error('Upload was cancelled.'));
    };

    xhr.open('POST', `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`);
    xhr.send(formData);
  });
}

/**
 * Submits file submission record for Round 1 (Architecture) or Round 2 (PPT) to Firestore.
 * Saves to both top-level /submissions and /teams/{teamId}/submissions/{roundId}.
 */
export async function submitFileRecord(
  teamId: string,
  teamName: string,
  roundId: string,
  fileData: CloudinaryUploadResult
): Promise<Submission> {
  // Validate round active window against authoritative timing evaluation
  const roundDoc = await getDoc(doc(db, 'rounds', roundId)).catch(() => null);
  const timingDoc = await getDoc(doc(db, 'settings', 'timingConfig')).catch(() => null);
  const roundData = roundDoc && roundDoc.exists() ? (roundDoc.data() as any) : null;
  const timingData = timingDoc && timingDoc.exists() ? (timingDoc.data() as any) : null;

  const evalResult = calculateRoundTimingEvaluation(roundId, timingData, roundData);
  if (!evalResult.isUploadAllowed) {
    if (evalResult.state === 'SCHEDULED' || evalResult.state === 'UPCOMING' || evalResult.state === 'NOT_STARTED') {
      throw new Error(`Round ${roundId.replace('round', '')} submission has not started yet. Submissions open at the scheduled start time.`);
    } else if (evalResult.state === 'ENDED') {
      throw new Error(`Round ${roundId.replace('round', '')} submission period has ended. New submissions are closed.`);
    } else if (evalResult.state === 'PAUSED') {
      throw new Error(`Round ${roundId.replace('round', '')} is currently paused by Administrator. Submissions are temporarily closed.`);
    } else if (evalResult.state === 'LOCKED') {
      throw new Error(`Round ${roundId.replace('round', '')} is locked by Administrator.`);
    } else {
      throw new Error(`Round ${roundId.replace('round', '')} submission is currently closed.`);
    }
  }

  const subId = `${teamId}_${roundId}`;
  const subDocRef = doc(db, 'submissions', subId);
  const existingDoc = await getDoc(subDocRef).catch(() => null);

  // Check duplicate submission rules
  if (existingDoc && existingDoc.exists()) {
    if (roundData && roundData.allowResubmission === false) {
      throw new Error(`Submission already received for Round ${roundId.replace('round', '')}. Resubmission is disabled.`);
    }
  }

  const version = existingDoc && existingDoc.exists() ? (existingDoc.data().version || 1) + 1 : 1;
  const roundNum = roundId.includes('1') ? 1 : roundId.includes('2') ? 2 : 3;

  const submissionItem: Submission = {
    id: subId,
    teamId,
    teamName,
    roundId,
    round: roundNum,
    type: roundNum === 1 ? 'architecture' : 'ppt',
    fileUrl: fileData.downloadUrl,
    fileName: fileData.fileName,
    originalFileName: fileData.fileName,
    fileType: fileData.fileType,
    fileSizeBytes: fileData.sizeBytes,
    publicId: fileData.publicId,
    submittedAt: new Date().toISOString(),
    uploadedAt: new Date().toISOString(),
    status: 'SUBMITTED',
    version,
    score: null,
  };

  const firestorePayload = {
    id: subId,
    teamId,
    teamName,
    roundId,
    round: roundNum,
    submissionType: roundNum === 1 ? 'architecture' : 'ppt',
    fileName: fileData.fileName,
    originalFileName: fileData.fileName,
    cloudinaryUrl: fileData.downloadUrl,
    cloudinaryPublicId: fileData.publicId,
    fileUrl: fileData.downloadUrl,
    publicId: fileData.publicId,
    resourceType: fileData.resourceType || (roundNum === 1 && fileData.fileName.match(/\.(png|jpg|jpeg|webp)$/i) ? 'image' : 'raw'),
    format: fileData.format || fileData.fileName.split('.').pop() || '',
    fileSize: fileData.sizeBytes,
    fileSizeBytes: fileData.sizeBytes,
    uploadedAt: serverTimestamp(),
    submittedAt: serverTimestamp(),
    uploadedBy: auth.currentUser?.uid || teamId,
    status: 'submitted',
    version,
    score: null,
  };

  // 1. Save to /submissions/{teamId_roundId}
  await setDoc(subDocRef, firestorePayload, { merge: true });

  // 2. Save to /teams/{teamId}/submissions/{roundId}
  await setDoc(doc(db, 'teams', teamId, 'submissions', roundId), firestorePayload, { merge: true }).catch(() => {});

  // 3. Update team submission indicator
  const teamUpdate = roundNum === 1
    ? { round1Submitted: true, updatedAt: serverTimestamp() }
    : { round2Submitted: true, updatedAt: serverTimestamp() };

  await updateDoc(doc(db, 'teams', teamId), teamUpdate).catch(() => {});

  return submissionItem;
}

/**
 * Submits GitHub and Prototype URLs for Round 3 to Firestore.
 */
export async function submitGithubRecord(
  teamId: string,
  teamName: string,
  roundId: string,
  payload: { githubUrl: string; prototypeUrl?: string; notes?: string }
): Promise<Submission> {
  const roundDoc = await getDoc(doc(db, 'rounds', roundId)).catch(() => null);
  const timingDoc = await getDoc(doc(db, 'settings', 'timingConfig')).catch(() => null);
  const roundData = roundDoc && roundDoc.exists() ? (roundDoc.data() as any) : null;
  const timingData = timingDoc && timingDoc.exists() ? (timingDoc.data() as any) : null;

  const evalResult = calculateRoundTimingEvaluation(roundId, timingData, roundData);
  if (!evalResult.isUploadAllowed) {
    if (evalResult.state === 'SCHEDULED' || evalResult.state === 'UPCOMING' || evalResult.state === 'NOT_STARTED') {
      throw new Error('Round 3 submission has not started yet. Submissions open at the scheduled start time.');
    } else if (evalResult.state === 'ENDED') {
      throw new Error('Round 3 submission period has ended. New submissions are closed.');
    } else if (evalResult.state === 'PAUSED') {
      throw new Error('Round 3 is currently paused by Administrator. Submissions are temporarily closed.');
    } else if (evalResult.state === 'LOCKED') {
      throw new Error('Round 3 is locked by Administrator.');
    } else {
      throw new Error('Round 3 submission is currently closed.');
    }
  }

  const subId = `${teamId}_${roundId}`;
  const subDocRef = doc(db, 'submissions', subId);
  const existingDoc = await getDoc(subDocRef).catch(() => null);
  const version = existingDoc && existingDoc.exists() ? (existingDoc.data().version || 1) + 1 : 1;

  const submissionItem: Submission = {
    id: subId,
    teamId,
    teamName,
    roundId,
    round: 3,
    type: 'github',
    githubUrl: payload.githubUrl.trim(),
    repositoryUrl: payload.githubUrl.trim(),
    prototypeUrl: payload.prototypeUrl?.trim() || '',
    notes: payload.notes?.trim() || '',
    submittedAt: new Date().toISOString(),
    uploadedAt: new Date().toISOString(),
    status: 'SUBMITTED',
    version,
    score: null,
  };

  const firestorePayload = {
    id: subId,
    teamId,
    teamName,
    roundId,
    round: 3,
    type: 'github',
    submissionType: 'github',
    githubUrl: payload.githubUrl.trim(),
    repositoryUrl: payload.githubUrl.trim(),
    prototypeUrl: payload.prototypeUrl?.trim() || '',
    notes: payload.notes?.trim() || '',
    uploadedAt: serverTimestamp(),
    submittedAt: serverTimestamp(),
    uploadedBy: auth.currentUser?.uid || teamId,
    status: 'submitted',
    version,
    score: null,
  };

  await setDoc(subDocRef, firestorePayload, { merge: true });
  await setDoc(doc(db, 'teams', teamId, 'submissions', roundId), firestorePayload, { merge: true }).catch(() => {});
  await updateDoc(doc(db, 'teams', teamId), {
    round3Submitted: true,
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  return submissionItem;
}
