import {
  Team,
  TeamMember,
  ProblemStatement,
  TeamProblemAssignment,
  Round,
  Submission,
  Score,
  TeamSelection,
  AuditLog,
  UserProfile,
  LeaderboardEntry,
} from '../types';

// Empty real arrays (Zero mock data - Production ready)
export const mockProblemStatements: ProblemStatement[] = [];
export const mockTeamAssignments: Record<string, TeamProblemAssignment> = {};
export const mockTeams: Team[] = [];
export const mockUsers: Record<string, UserProfile> = {};
export const mockTeamMembers: Record<string, TeamMember[]> = {};
export const mockRounds: Round[] = [];
export const mockSubmissions: Submission[] = [];
export const mockScores: Score[] = [];
export const mockSelections: TeamSelection[] = [];
export const mockAuditLogs: AuditLog[] = [];

export function getDeterministicLeaderboard(): LeaderboardEntry[] {
  return [];
}
