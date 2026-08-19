import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

// Export Auth & Session Management Functions
export {
  getNextTeamPreview,
  createTeamAccount,
  deleteTeamAccount,
  disableTeamAccount,
  enableTeamAccount,
  resetTeamPassword,
  forceLogout,
  registerActiveSession,
} from './auth/accountManagement';

// Export Problem Statement & Sequential Distribution Functions
export {
  generateProblemDistribution,
  publishProblemDistribution,
  resetProblemDistribution,
  saveProblemStatement,
  deleteProblemStatement,
  deleteAllProblemStatements,
  parseProblemStatementsAI,
} from './problems/problemDistributionHandler';

// Export Round Control Functions
export {
  startRound,
  stopRound,
  endRound,
  saveRoundSchedule,
  updateRoundConfig,
  updateTimingConfig,
  resetRoundState,
  resetHackathonState,
} from './rounds/roundControl';

// Export Submission Handler Functions
export {
  getCloudinaryUploadSignature,
  submitFile,
  submitGithub,
} from './submissions/submissionHandler';

// Export AI Evaluation Function
export {
  evaluateWithAI,
} from './ai/aiEvaluator';

// Export Evaluation & Leaderboard Functions
export {
  evaluateSubmission,
  calculateLeaderboard,
} from './scores/evaluationHandler';

// Export Selection Functions
export {
  saveTeamSelections,
  setSelectionPublishStatus,
} from './selection/selectionHandler';
