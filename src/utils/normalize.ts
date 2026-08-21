import { Team, Submission, Score, Round, ProblemStatement, UserProfile } from '../types';

export const safeString = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

export const safeNumber = (value: any, fallback: number = 0): number => {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
};

export const safeRoundNumber = (roundIdOrNum: any): number => {
  if (typeof roundIdOrNum === 'number') return roundIdOrNum;
  const str = safeString(roundIdOrNum);
  if (str.includes('1')) return 1;
  if (str.includes('2')) return 2;
  if (str.includes('3')) return 3;
  return 1;
};

export const normalizeSubmission = (data: any, id: string = ''): Submission => {
  if (!data) data = {};
  const roundNum = safeRoundNumber(data.round || data.roundId || id);
  const roundId = data.roundId ? safeString(data.roundId) : `round${roundNum}`;

  const files: any[] = Array.isArray(data.files) && data.files.length > 0
    ? data.files.map((f: any, fIdx: number) => ({
        slot: safeNumber(f.slot, fIdx + 1),
        fileUrl: safeString(f.cloudinaryUrl || f.fileUrl || f.url),
        url: safeString(f.cloudinaryUrl || f.fileUrl || f.url),
        cloudinaryUrl: safeString(f.cloudinaryUrl || f.fileUrl || f.url),
        fileName: safeString(f.fileName || f.originalFileName || f.originalFilename || `image_${fIdx + 1}`),
        originalFileName: safeString(f.originalFileName || f.fileName || `image_${fIdx + 1}`),
        fileType: safeString(f.fileType || f.mimeType || f.format || 'image/png'),
        mimeType: safeString(f.mimeType || f.fileType || 'image/png'),
        format: safeString(f.format),
        resourceType: safeString(f.resourceType || 'image'),
        fileSizeBytes: safeNumber(f.fileSizeBytes || f.fileSize || f.bytes, 0),
        publicId: safeString(f.cloudinaryPublicId || f.publicId),
        cloudinaryPublicId: safeString(f.cloudinaryPublicId || f.publicId),
        uploadedAt: f.uploadedAt || data.uploadedAt || data.submittedAt || null,
      }))
    : (data.fileUrl || data.cloudinaryUrl)
      ? [{
          slot: 1,
          fileUrl: safeString(data.cloudinaryUrl || data.fileUrl || data.url),
          url: safeString(data.cloudinaryUrl || data.fileUrl || data.url),
          cloudinaryUrl: safeString(data.cloudinaryUrl || data.fileUrl || data.url),
          fileName: safeString(data.fileName || data.originalFileName || 'submission_file'),
          originalFileName: safeString(data.originalFileName || data.fileName),
          fileType: safeString(data.fileType || data.format || (roundNum === 1 ? 'image/png' : 'raw')),
          mimeType: safeString(data.mimeType || data.fileType || (roundNum === 1 ? 'image/png' : 'application/octet-stream')),
          format: safeString(data.format),
          resourceType: safeString(data.resourceType || (roundNum === 1 ? 'image' : 'raw')),
          fileSizeBytes: safeNumber(data.fileSizeBytes || data.fileSize || data.bytes, 0),
          publicId: safeString(data.cloudinaryPublicId || data.publicId),
          cloudinaryPublicId: safeString(data.cloudinaryPublicId || data.publicId),
          uploadedAt: data.uploadedAt || data.submittedAt || null,
        }]
      : [];

  const primaryFileUrl = files.length > 0 ? files[0].fileUrl : safeString(data.cloudinaryUrl || data.fileUrl || data.url);
  const primaryFileName = files.length > 0
    ? (files.length === 1 ? files[0].fileName : files.map((f: any) => f.fileName).join(', '))
    : safeString(data.fileName || data.originalFileName || data.originalFilename || (roundNum === 3 ? 'github_repository' : 'submission_file'));

  const totalBytes = files.length > 0
    ? files.reduce((acc: number, curr: any) => acc + (curr.fileSizeBytes || 0), 0)
    : safeNumber(data.fileSizeBytes || data.fileSize || data.bytes, 0);

  return {
    id: id || safeString(data.id) || `${safeString(data.teamId)}_${roundId}`,
    teamId: safeString(data.teamId),
    teamName: safeString(data.teamName),
    roundId,
    round: roundNum,
    type: data.type || (roundNum === 1 ? 'architecture' : roundNum === 2 ? 'ppt' : 'github'),
    submissionType: safeString(data.submissionType || (roundNum === 1 ? 'architecture' : roundNum === 2 ? 'ppt' : 'prototype')),
    fileUrl: primaryFileUrl,
    cloudinaryUrl: primaryFileUrl,
    fileName: primaryFileName,
    originalFileName: safeString(data.originalFileName || primaryFileName),
    fileType: safeString(data.fileType || data.format || data.resourceType || (roundNum === 1 ? 'image/png' : 'raw')),
    resourceType: safeString(data.resourceType || (roundNum === 1 ? 'image' : 'raw')),
    format: safeString(data.format),
    fileSizeBytes: totalBytes,
    publicId: safeString(data.cloudinaryPublicId || data.publicId || (files.length > 0 ? files[0].publicId : '')),
    cloudinaryPublicId: safeString(data.cloudinaryPublicId || data.publicId || (files.length > 0 ? files[0].publicId : '')),
    files,
    submittedAt: data.submittedAt || data.uploadedAt || null,
    uploadedAt: data.uploadedAt || data.submittedAt || null,
    uploadedBy: safeString(data.uploadedBy),
    status: safeString(data.status || 'submitted'),
    version: safeNumber(data.version, 1),
    score: data.score !== undefined ? data.score : null,
    githubUrl: safeString(data.githubUrl || data.repositoryUrl),
    repositoryUrl: safeString(data.repositoryUrl || data.githubUrl),
    prototypeUrl: safeString(data.prototypeUrl),
    notes: safeString(data.notes),
  } as Submission;
};

export const normalizeTeam = (data: any, id: string = ''): Team => {
  if (!data) data = {};
  const teamId = safeString(data.teamId || data.id || id);
  return {
    id: id || safeString(data.id) || teamId,
    teamId,
    teamName: safeString(data.teamName || `Team ${teamId}`),
    leaderName: safeString(data.leaderName || 'Team Leader'),
    username: safeString(data.username || teamId.toLowerCase()),
    status: (data.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
    round1Submitted: Boolean(data.round1Submitted),
    round2Submitted: Boolean(data.round2Submitted),
    round3Submitted: Boolean(data.round3Submitted),
    round1Score: data.round1Score !== undefined && data.round1Score !== null ? Number(data.round1Score) : undefined,
    round2Score: data.round2Score !== undefined && data.round2Score !== null ? Number(data.round2Score) : undefined,
    round3Score: data.round3Score !== undefined && data.round3Score !== null ? Number(data.round3Score) : undefined,
    totalScore: data.totalScore !== undefined && data.totalScore !== null ? Number(data.totalScore) : undefined,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
};

export const normalizeScore = (data: any, id: string = ''): Score => {
  if (!data) data = {};
  const roundNum = safeRoundNumber(data.round || data.roundId || id);
  return {
    id: id || safeString(data.id) || `${safeString(data.teamId)}_round${roundNum}`,
    teamId: safeString(data.teamId),
    roundId: safeString(data.roundId || `round${roundNum}`),
    round: roundNum,
    totalMarks: safeNumber(data.totalMarks || data.adminFinalScore || data.score || 0, 0),
    maxMarks: safeNumber(data.maxMarks, roundNum === 1 ? 10 : roundNum === 2 ? 30 : 50),
    criteriaScores: data.criteriaScores || {},
    evaluationStatus: (data.evaluationStatus || 'FINALIZED') as any,
    evaluatedBy: safeString(data.evaluatedBy || data.evaluatorId || 'admin'),
    evaluatorId: safeString(data.evaluatorId || data.evaluatedBy || 'admin'),
    evaluatedAt: data.evaluatedAt || data.updatedAt || new Date().toISOString(),
    feedback: safeString(data.feedback),
  };
};
