export type UserRole = 'admin' | 'team';

export type AccountStatus = 'active' | 'disabled';

export type RoundStatus = 'NOT_STARTED' | 'SCHEDULED' | 'LIVE' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'LOCKED' | 'UPCOMING';

export type SelectionStatus = 'NOT_SELECTED' | 'SELECTED';

export type EvaluationStatus = 'NOT_EVALUATED' | 'AI_EVALUATED' | 'ADMIN_REVIEW_REQUIRED' | 'FINALIZED';

export type ProblemStatus =
  | 'DRAFT'
  | 'READY_FOR_REVIEW'
  | 'ASSIGNED'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED'
  | 'ARCHIVED'
  | 'processing'
  | 'draft'
  | 'published'
  | 'archived'
  | 'error'
  | 'active'
  | 'disabled';

export type DistributionStatus = 'DRAFT' | 'PUBLISHED';

export interface DeviceSession {
  sessionId: string;
  userId: string;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  status: 'active' | 'revoked';
}

export interface UserProfile {
  uid: string;
  role: UserRole;
  teamId?: string;
  username: string;
  email?: string;
  displayName: string;
  status: AccountStatus;
  sessionVersion: number;
  activeSessionId?: string | null;
  activeSessions?: DeviceSession[];
  createdAt: any;
  updatedAt: any;
  lastLoginAt?: any;
}

export interface TeamMember {
  memberId: string;
  teamId: string;
  memberName: string;
  role?: string;
  email?: string;
  certificatePath?: string;
  certificateUrl?: string;
  certificateStatus: 'PENDING' | 'PUBLISHED' | 'DISABLED';
  createdAt: any;
  updatedAt?: any;
}

export interface ProblemStatement {
  statementId: string; // e.g. PS001 or PS1
  problemStatementId?: string;
  sequence?: number; // 1..N
  title: string;
  description: string;
  category?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  team?: string | null;
  organization?: string | null;
  department?: string | null;
  analysis?: string;
  confidence?: number;
  aiQualityScore?: number;
  aiIssues?: string[];
  aiSuggestions?: string[];
  requirements?: string[] | string;
  examples?: string;
  technicalGuidelines?: string;
  constraints?: string;
  expectedOutcome?: string;
  evaluationNotes?: string;
  instructions?: string[];
  order: number;
  sourceFileName?: string;
  aiProcessed?: boolean;
  assignedTeamId?: string | null;
  assignedTeamName?: string | null;
  assignedTeamIds?: string[];
  status: ProblemStatus;
  createdAt: any;
  updatedAt: any;
  createdBy?: string;
  publishedAt?: any;
  publishedBy?: string;
  version?: number;
}

export interface ParsedProblemStatement {
  sequence: number;
  title: string;
  description: string;
  category?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  team?: string | null;
  organization?: string | null;
  department?: string | null;
  analysis?: string;
  confidence?: number;
  aiQualityScore?: number;
  aiIssues?: string[];
  aiSuggestions?: string[];
  requirements?: string[];
  examples?: string;
  technicalGuidelines?: string;
  constraints?: string;
  expectedOutcome?: string;
  evaluationNotes?: string;
  sourceFile?: string;
  aiProcessed: boolean;
  status?: ProblemStatus;
  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedTeamIds?: string[];
}

export interface ProblemAssignmentConfig {
  assignmentMode: 'batch_alternating' | 'sequential' | 'round_robin';
  batchSize: number; // e.g. 10
  batchStartTeamNumbers: number[]; // e.g. [1, 21, 41, 61, 81]
  updatedAt?: any;
  updatedBy?: string;
}

export interface TeamProblemAssignment {
  id?: string;
  teamId: string;
  statementId: string;
  problemStatementId?: string;
  problemSequence?: number;
  statementTitle: string;
  description: string;
  requirements?: string[] | string;
  examples?: string;
  technicalGuidelines?: string;
  constraints?: string;
  expectedOutcome?: string;
  instructions?: string[];
  sourceFileName?: string;
  assignedAt: any;
  publishedAt?: any;
  assignedBy?: string;
  publicationId?: string;
  publicationVersion?: number;
  status: DistributionStatus;
}

export interface ProblemPublication {
  id?: string;
  publicationId: string; // e.g. PUB001, PUB002
  version: number; // 1, 2, 3...
  totalStatements: number;
  totalTeamsAssigned: number;
  status: 'LIVE' | 'ARCHIVED';
  publishedAt: any;
  publishedBy: string;
  adminEmail?: string;
  statementsSnapshot: Array<{
    statementId: string;
    sequence: number;
    title: string;
    description: string;
    requirements?: string[];
    technicalGuidelines?: string;
    constraints?: string;
    expectedOutcome?: string;
  }>;
  assignmentMapping: Array<{
    teamId: string;
    teamName: string;
    statementId: string;
    statementTitle: string;
    sequence: number;
  }>;
}

export interface ProblemAssignmentValidationResult {
  isValid: boolean;
  totalTeams: number;
  totalStatements: number;
  assignedTeamsCount: number;
  unassignedTeamIds: string[];
  missingTeamIds: string[];
  duplicateSequences: number[];
  issues: string[];
}

export interface ProblemStatementImport {
  id?: string;
  importId: string;
  fileName: string;
  fileHash?: string;
  totalDetected: number;
  totalCreated: number;
  totalAssigned: number;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  uploadedBy: string;
  uploadedAt: any;
  aiModel?: string;
  errorMessage?: string | null;
  assignedMapping?: Array<{ problemSequence: number; problemTitle: string; teamId: string; teamName: string }>;
}

export interface ProblemDistributionPreviewGroup {
  statementId: string;
  statementTitle: string;
  sequence?: number;
  description: string;
  requirements?: string[];
  instructions: string[];
  examples?: string;
  technicalGuidelines?: string;
  constraints?: string;
  expectedOutcome?: string;
  assignedTeams: Array<{
    teamId: string;
    teamName: string;
    leaderName: string;
  }>;
}

export interface ProblemDistributionDraft {
  status: DistributionStatus;
  totalTeams: number;
  totalStatements: number;
  mapping: ProblemDistributionPreviewGroup[];
  generatedAt: any;
  publishedAt?: any;
  config?: ProblemAssignmentConfig;
}

export interface Team {
  id?: string;
  teamId: string;
  teamName: string;
  leaderName: string;
  username: string;
  userUid?: string;
  status: AccountStatus;
  assignedStatementId?: string;
  assignedStatementTitle?: string;
  assignedProblemId?: string;
  assignedProblemCode?: string;
  assignedProblemOrder?: number;
  problemStatementId?: string;
  problemStatementCode?: string;
  problemStatementOrder?: number;
  assignmentStatus?: string;
  assignmentLocked?: boolean;
  assignmentSource?: string;
  assignedAt?: any;
  membersCount?: number;
  selectionStatus?: SelectionStatus;
  isSelectionPublished?: boolean;
  createdAt: any;
  updatedAt: any;
  round1Submitted?: boolean;
  round2Submitted?: boolean;
  round3Submitted?: boolean;
  round1Score?: number | null;
  round2Score?: number | null;
  round3Score?: number | null;
  totalScore?: number | null; // out of 90
}

export interface CriteriaItem {
  id: string;
  name: string;
  maxMarks: number;
  description?: string;
}

export interface RoundTimingConfig {
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endDate: string;   // YYYY-MM-DD
  endTime: string;   // HH:mm
  startIso: string;  // Complete ISO string in UTC
  endIso: string;    // Complete ISO string in UTC
  scheduledStartAt?: any;
  scheduledEndAt?: any;
  actualStartedAt?: any;
  actualEndedAt?: any;
  status?: RoundStatus;
  statusOverride?: 'AUTO' | 'FORCE_ACTIVE' | 'FORCE_CLOSED' | 'LOCKED';
  activatedAt?: any;
  activatedBy?: string;
  pausedAt?: any;
  pausedBy?: string;
  resumedAt?: any;
  endedAt?: any;
  endedBy?: string;
  runId?: string;
}

export interface HackathonTimingConfig {
  hackathonStartDate: string;
  hackathonStartTime: string;
  hackathonEndDate: string;
  hackathonEndTime: string;
  hackathonStartIso: string;
  hackathonEndIso: string;
  timezone: string; // e.g. 'Asia/Kolkata' (IST)
  runId?: string;
  round1: RoundTimingConfig;
  round2: RoundTimingConfig;
  round3: RoundTimingConfig;
  updatedAt?: any;
  updatedBy?: string;
  lastResetAt?: any;
  lastResetBy?: string;
}

export interface Round {
  id: string;
  name: string;
  roundNumber: number;
  description: string;
  problemStatement?: string;
  instructions?: string[];
  startTime: any;
  endTime: any;
  scheduledStartAt?: any;
  scheduledEndAt?: any;
  actualStartedAt?: any;
  actualEndedAt?: any;
  maxMarks: number; // Round 1: 10, Round 2: 30, Round 3: 50
  status: RoundStatus;
  allowResubmission: boolean;
  allowedFileTypes: string[];
  maxFileSize: number; // in MB
  criteria: CriteriaItem[];
  runId?: string;
  activatedAt?: any;
  activatedBy?: string;
  pausedAt?: any;
  pausedBy?: string;
  resumedAt?: any;
  endedAt?: any;
  endedBy?: string;
  createdAt: any;
  updatedAt: any;
}

export interface Submission {
  id: string;
  teamId: string;
  teamName: string;
  roundId: string;
  round?: number;
  type?: 'architecture' | 'ppt' | 'github';
  fileUrl?: string;
  fileName?: string;
  originalFileName?: string;
  publicId?: string | null;
  fileType?: string;
  fileSizeBytes?: number;
  githubUrl?: string;
  githubRepoUrl?: string;
  repositoryUrl?: string;
  prototypeUrl?: string;
  notes?: string;
  submittedAt: any;
  uploadedAt?: any;
  submittedByUid?: string;
  status: 'SUBMITTED' | 'EVALUATED';
  version: number;
  score?: number | null;
}

export interface RequirementCoverageItem {
  requirement: string;
  status: 'EVIDENCED' | 'PARTIALLY_EVIDENCED' | 'NOT_EVIDENCED' | 'UNKNOWN';
  evidenceSnippet?: string;
  comment?: string;
}

export interface ArchitectureAnalysis {
  summary?: string;
  componentsFound: string[];
  dataFlow: string[];
  strengths: string[];
  weaknesses: string[];
  missingEvidence: string[];
}

export interface ConsistencyAnalysis {
  status: 'CONSISTENT' | 'PARTIALLY_CONSISTENT' | 'INCONSISTENT' | 'INSUFFICIENT_EVIDENCE';
  details: string;
  discrepancies?: string[];
}

export interface AIEvaluationCriteriaResult {
  criterionId: string;
  criterionName: string;
  suggestedMarks: number;
  maxMarks: number;
  evidence?: string;
  reason?: string;
  comment?: string;
}

export interface SimilarityAnalysis {
  status: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_ESTABLISHED';
  reason: string;
  identifiedPattern?: string;
}

export interface ProblemDetailedAnalysis {
  title: string;
  objective?: string;
  requirements: string[];
  requiredComponents?: string[];
  expectedArchitecture?: string;
  technicalGuidelines?: string;
  constraints?: string;
  expectedOutcome?: string;
  potentialRisks?: string[];
  evaluationFocus?: string[];
}

export interface AIEvaluation {
  id: string;
  evaluationId?: string;
  submissionId?: string;
  teamId: string;
  problemStatementId?: string;
  roundId: string;
  round?: number;
  status?: 'pending' | 'ai_processing' | 'ai_completed' | 'admin_review' | 'finalized' | 'NO_SUBMISSION' | 'NO_PROBLEM_ASSIGNED' | 'NO_ACTIVE_TEAM' | 'SUBMISSION_UNAVAILABLE' | 'error';
  submissionFound?: boolean;
  problemAnalysis?: ProblemDetailedAnalysis;
  submissionAnalysis?: {
    type: string;
    fileName?: string;
    fileUrl?: string;
    githubRepoUrl?: string;
    prototypeUrl?: string;
    pagesAnalyzed?: number;
    accessedSuccessfully?: boolean;
  };
  requirementCoverage?: RequirementCoverageItem[];
  architectureAnalysis?: ArchitectureAnalysis;
  similarityAnalysis?: SimilarityAnalysis;
  consistencyAnalysis?: ConsistencyAnalysis;
  criteria: AIEvaluationCriteriaResult[];
  criteriaEvaluation?: AIEvaluationCriteriaResult[];
  suggestedScore: number;
  aiRecommendedScore?: number;
  score: number;
  maximumScore: number;
  maxScore: number;
  evidence?: string[];
  missingEvidence?: string[];
  strengths: string[];
  weaknesses: string[];
  suggestions?: string[];
  confidence: number;
  confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceReason?: string;
  summary: string;
  aiModel?: string;
  modelUsed?: string;
  version?: number;
  finalScore?: number | null;
  adminFinalScore?: number | null;
  finalComment?: string | null;
  evaluatedBy?: string | null;
  evaluatedAt?: any;
  aiEvaluatedAt?: any;
  generatedAt?: any;
}

export interface EvaluationHistoryItem {
  id?: string;
  historyId: string;
  submissionId: string;
  teamId: string;
  roundId: string;
  version: number;
  suggestedScore: number;
  finalScore?: number | null;
  maximumScore: number;
  criteria: AIEvaluationCriteriaResult[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  confidence: number;
  aiModel?: string;
  triggeredBy?: string;
  editedBy?: string;
  createdAt: any;
}

export interface Score {
  id: string;
  teamId: string;
  roundId: string;
  round?: number;
  submissionId?: string;
  criteriaScores: Record<string, number>;
  aiSuggestedScore?: number | null;
  totalMarks: number; // Admin approved score
  adminFinalScore?: number;
  maxMarks?: number;
  percentage?: number; // (totalMarks / maxMarks) * 100
  feedback: string;
  evaluationStatus: EvaluationStatus;
  evaluatedBy: string;
  evaluatorId?: string;
  evaluatedAt: any;
}

export interface TeamSelection {
  teamId: string;
  teamName: string;
  leaderName: string;
  status: SelectionStatus;
  isPublished: boolean;
  totalScore: number; // out of 90
  updatedBy?: string;
  updatedAt?: any;
}

export interface Certificate {
  id: string;
  memberId: string;
  teamId: string;
  memberName: string;
  certificateUrl: string;
  storagePath: string;
  isPublished: boolean;
  issuedAt: any;
}

export interface AuditLog {
  id: string;
  adminUid: string;
  adminEmail?: string;
  action: string;
  targetType: 'account' | 'team' | 'round' | 'submission' | 'score' | 'selection' | 'certificate' | 'problem' | 'system';
  targetId: string;
  timestamp: any;
  metadata?: Record<string, any>;
}

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  leaderName: string;
  assignedStatementId?: string;
  round1Score: number;
  round2Score: number;
  round3Score: number;
  totalScore: number;
  percentage: number;
  selectionStatus: SelectionStatus;
  isSelectionPublished: boolean;
  lastSubTime?: number;
}

export interface ScoringConfig {
  round1MaxMarks: number;
  round2MaxMarks: number;
  round3MaxMarks: number;
  totalMaxMarks: number;
  updatedAt?: any;
  updatedBy?: string;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  round1MaxMarks: 10,
  round2MaxMarks: 30,
  round3MaxMarks: 50,
  totalMaxMarks: 90,
};
