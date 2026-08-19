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
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { TeamMember, Certificate } from '../types';
import { getActiveCloudinaryConfig } from './submissions.service';
import { safeString } from '../utils/normalize';

export interface CloudinaryCertResult {
  downloadUrl: string;
  publicId: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  format?: string;
}

const MAX_CERT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export function validateCertificateFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No certificate file selected.' };
  }

  if (file.size > MAX_CERT_SIZE_BYTES) {
    return {
      valid: false,
      error: `Certificate file exceeds the 25 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB).`,
    };
  }

  const fileName = file.name.toLowerCase();
  const ext = fileName.split('.').pop() || '';
  const allowed = ['pdf', 'png', 'jpg', 'jpeg'];

  if (!allowed.includes(ext)) {
    return {
      valid: false,
      error: 'Please upload a valid PDF or image certificate (.pdf, .png, .jpg).',
    };
  }

  return { valid: true };
}

export function normalizeTeamMember(data: any, id: string = ''): TeamMember {
  if (!data) data = {};
  const memberId = safeString(data.memberId || data.id || id);
  return {
    memberId,
    teamId: safeString(data.teamId),
    memberName: safeString(data.memberName || 'Member'),
    role: safeString(data.role || 'Member'),
    email: safeString(data.email),
    certificatePath: safeString(data.certificatePath || data.certificatePublicId),
    certificateUrl: safeString(data.certificateUrl || data.downloadUrl),
    certificateStatus: (data.certificateStatus || 'PENDING') as 'PENDING' | 'PUBLISHED' | 'DISABLED',
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

/**
 * Subscribes to all team members (Admin view) from Firestore
 */
export function subscribeToAllMembers(callback: (members: TeamMember[]) => void): () => void {
  const q = query(collection(db, 'teamMembers'));
  return onSnapshot(
    q,
    (snap) => {
      const list: TeamMember[] = [];
      snap.forEach((d) => list.push(normalizeTeamMember(d.data(), d.id)));
      callback(list);
    },
    (err) => {
      console.error('[CertificatesService] subscribeToAllMembers error:', err);
      callback([]);
    }
  );
}

/**
 * Subscribes to members for a specific team (Team view) from Firestore
 */
export function subscribeToTeamMembers(
  teamId: string,
  callback: (members: TeamMember[]) => void
): () => void {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  const q = query(collection(db, 'teamMembers'), where('teamId', '==', teamId));
  return onSnapshot(
    q,
    (snap) => {
      const list: TeamMember[] = [];
      snap.forEach((d) => list.push(normalizeTeamMember(d.data(), d.id)));
      callback(list);
    },
    (err) => {
      console.warn('[CertificatesService] subscribeToTeamMembers error:', err);
      callback([]);
    }
  );
}

/**
 * Adds a new member to a team in Firestore
 */
export async function addTeamMember(teamId: string, memberName: string, role: string = 'Member'): Promise<TeamMember> {
  const memberId = `${teamId}_M${Date.now().toString().slice(-4)}`;
  const now = new Date().toISOString();

  const newMember: TeamMember = {
    memberId,
    teamId,
    memberName: memberName.trim(),
    role: role.trim(),
    certificateStatus: 'PENDING',
    createdAt: now,
  };

  await setDoc(doc(db, 'teamMembers', memberId), {
    ...newMember,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return newMember;
}

/**
 * Removes a member from Firestore
 */
export async function removeTeamMember(memberId: string): Promise<void> {
  await deleteDoc(doc(db, 'teamMembers', memberId));
  await deleteDoc(doc(db, 'certificates', memberId)).catch(() => {});
}

/**
 * Uploads a certificate directly to Cloudinary using unsigned upload preset
 */
export async function uploadCertificateToCloudinary(
  teamId: string,
  memberId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<CloudinaryCertResult> {
  const validation = validateCertificateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid certificate file.');
  }

  const config = await getActiveCloudinaryConfig();
  if (!config.cloudName) {
    throw new Error('Cloudinary Cloud Name is not configured. Please set VITE_CLOUDINARY_CLOUD_NAME in .env or Admin Settings.');
  }
  if (!config.uploadPreset) {
    throw new Error('Cloudinary Upload Preset is not configured. Please set VITE_CLOUDINARY_UPLOAD_PRESET in .env or Admin Settings.');
  }

  const cleanFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const targetFolder = `hackathon/certificates/${teamId}`;
  const targetPublicId = `${memberId}_${Date.now()}_${cleanFileName}`;

  return new Promise<CloudinaryCertResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    formData.append('file', file);
    formData.append('upload_preset', config.uploadPreset);
    formData.append('folder', targetFolder);
    formData.append('public_id', targetPublicId);

    xhr.timeout = 45000;

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
            publicId: response.public_id || `${targetFolder}/${targetPublicId}`,
            fileName: file.name,
            fileType: file.type || 'application/pdf',
            sizeBytes: response.bytes || file.size,
            format: response.format || 'pdf',
          });
        } catch {
          reject(new Error('Cloudinary returned invalid response.'));
        }
      } else {
        let errorMsg = `Cloudinary upload failed (HTTP ${xhr.status})`;
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData?.error?.message) {
            const raw = errData.error.message;
            if (raw.toLowerCase().includes('preset not found') || raw.toLowerCase().includes('preset')) {
              errorMsg = `Upload preset "${config.uploadPreset}" was not found in Cloudinary account "${config.cloudName}". Please ensure an UNSIGNED upload preset named "${config.uploadPreset}" is created in Cloudinary console (Settings → Upload → Upload presets).`;
            } else {
              errorMsg = `Cloudinary: ${raw}`;
            }
          }
        } catch {}
        reject(new Error(errorMsg));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during Cloudinary certificate upload. Please check your connection.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Certificate upload timed out after 45 seconds. Please try again.'));
    };

    xhr.onabort = () => {
      reject(new Error('Upload was cancelled.'));
    };

    xhr.open('POST', `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`);
    xhr.send(formData);
  });
}

/**
 * Uploads member certificate to Cloudinary and saves metadata to Firestore
 */
export async function uploadMemberCertificate(
  teamId: string,
  memberId: string,
  memberName: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  // 1. Upload to Cloudinary
  const uploadResult = await uploadCertificateToCloudinary(teamId, memberId, file, onProgress);

  const payload = {
    memberId,
    teamId,
    memberName,
    certificateUrl: uploadResult.downloadUrl,
    certificatePublicId: uploadResult.publicId,
    certificatePath: uploadResult.publicId,
    fileName: uploadResult.fileName,
    fileType: uploadResult.fileType,
    certificateStatus: 'PUBLISHED',
    status: 'published',
    isPublished: true,
    uploadedAt: serverTimestamp(),
    issuedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    uploadedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
  };

  // 2. Dual Firestore writes
  await setDoc(doc(db, 'teamMembers', memberId), payload, { merge: true });
  await setDoc(doc(db, 'certificates', memberId), payload, { merge: true });
  await setDoc(doc(db, 'teams', teamId, 'members', memberId), payload, { merge: true }).catch(() => {});

  return uploadResult.downloadUrl;
}

/**
 * Updates certificate status (PUBLISHED / DISABLED / PENDING)
 */
export async function setCertificatePublishStatus(
  memberId: string,
  status: 'PUBLISHED' | 'DISABLED' | 'PENDING'
): Promise<void> {
  await updateDoc(doc(db, 'teamMembers', memberId), {
    certificateStatus: status,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'certificates', memberId), {
    certificateStatus: status,
    isPublished: status === 'PUBLISHED',
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}
