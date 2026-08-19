export type UserRole = 'admin' | 'team';

export type AccountStatus = 'active' | 'disabled';

export type RoundStatus = 'LOCKED' | 'SCHEDULED' | 'ACTIVE' | 'ENDED';

export type SelectionStatus = 'NOT_SELECTED' | 'SELECTED';

export type EvaluationStatus = 'NOT_EVALUATED' | 'AI_EVALUATED' | 'ADMIN_REVIEW_REQUIRED' | 'FINALIZED';

export type ProblemStatus = 'active' | 'disabled';

export type DistributionStatus = 'DRAFT' | 'PUBLISHED';

export interface UserDoc {
  uid: string;
  role: UserRole;
  teamId?: string;
  username: string;
  displayName: string;
  status: AccountStatus;
  sessionVersion: number;
  activeSessionId: string | null;
  createdAt: FirebaseFirestore.Timestamp | string;
  updatedAt: FirebaseFirestore.Timestamp | string;
  lastLoginAt?: FirebaseFirestore.Timestamp | string;
}

export interface TeamDoc {
  teamId: string;
  teamName: string;
  leaderName: string;
  username: string;
  userUid: string;
  status: AccountStatus;
  createdAt: FirebaseFirestore.Timestamp | string;
  updatedAt: FirebaseFirestore.Timestamp | string;
}

export interface TeamMemberDoc {
  memberId: string;
  teamId: string;
  memberName: string;
  role?: string;
  email?: string;
  certificatePath?: string;
  certificateUrl?: string;
  certificateStatus: 'PENDING' | 'PUBLISHED' | 'DISABLED';
  createdAt: FirebaseFirestore.Timestamp | string;
  updatedAt: FirebaseFirestore.Timestamp | string;
}

export interface ProblemStatementDoc {
  statementId: string; // e.g. PS001
  title: string;
  description: string;
  instructions?: string[];
  order: number;
  status: ProblemStatus;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
}

export interface TeamProblemAssignmentDoc {
  teamId: string;
  statementId: string;
  statementTitle: string;
  description: string;
  instructions?: string[];
  assignedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
  publishedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string | null;
  status: DistributionStatus;
}

export interface DistributionStateDoc {
  status: DistributionStatus;
  totalTeams: number;
  totalStatements: number;
  generatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
  publishedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string | null;
  publishedBy?: string;
}

export interface CriteriaItem {
  id: string;
  name: string;
  maxMarks: number;
  description?: string;
}

export interface RoundDoc {
  id?: string;
  name: string;
  roundNumber: number;
  description: string;
  problemStatement?: string;
  instructions?: string[];
  startTime: FirebaseFirestore.Timestamp | string;
  endTime: FirebaseFirestore.Timestamp | string;
  maxMarks: number; // Round 1: 10, Round 2: 30, Round 3: 50
  status: RoundStatus;
  allowResubmission: boolean;
  allowedFileTypes: string[];
  maxFileSize: number; // in MB
  criteria: CriteriaItem[];
  createdAt: FirebaseFirestore.Timestamp | string;
  updatedAt: FirebaseFirestore.Timestamp | string;
}

export interface SubmissionDoc {
  id?: string;
  teamId: string;
  teamName: string;
  roundId: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSizeBytes?: number;
  githubUrl?: string;
  prototypeUrl?: string;
  notes?: string;
  submittedAt: FirebaseFirestore.Timestamp | string;
  status: 'SUBMITTED' | 'EVALUATED';
  version: number;
}

export interface AIEvaluationCriteriaResult {
  criterionId: string;
  criterionName: string;
  suggestedMarks: number;
  maxMarks: number;
  comment: string;
}

export interface AIEvaluationDoc {
  id?: string;
  submissionId: string;
  teamId: string;
  roundId: string;
  score: number;
  maxScore: number;
  criteria: AIEvaluationCriteriaResult[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  confidence: number;
  modelUsed: string;
  generatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
}

export interface ScoreDoc {
  id?: string;
  teamId: string;
  roundId: string;
  submissionId?: string;
  criteriaScores: Record<string, number>;
  aiSuggestedScore?: number;
  totalMarks: number; // Admin approved score
  percentage?: number; // (totalMarks / round.maxMarks) * 100
  feedback: string;
  evaluationStatus: EvaluationStatus;
  evaluatedBy: string;
  evaluatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
}

export interface SelectionDoc {
  teamId: string;
  teamName: string;
  leaderName: string;
  status: SelectionStatus;
  isPublished: boolean;
  totalScore: number; // out of 90
  updatedBy: string;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | string;
}

export interface CertificateDoc {
  id?: string;
  memberId: string;
  teamId: string;
  memberName: string;
  certificateUrl: string;
  storagePath: string;
  isPublished: boolean;
  issuedAt: FirebaseFirestore.Timestamp | string;
}

export interface AuditLogDoc {
  id?: string;
  adminUid: string;
  adminEmail?: string;
  action: string;
  targetType: 'account' | 'team' | 'round' | 'submission' | 'score' | 'selection' | 'certificate' | 'problem' | 'system';
  targetId: string;
  timestamp: FirebaseFirestore.Timestamp | string;
  metadata?: Record<string, any>;
}
