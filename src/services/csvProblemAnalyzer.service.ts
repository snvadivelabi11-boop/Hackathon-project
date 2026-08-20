import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../firebase/config';
import { ProblemStatement } from '../types';

export interface AnalyzedQuestionItem {
  sequence: number;
  order: number;
  questionNumber: string; // "Question 1", "Question 2"...
  statementId: string; // "PS001", "PS002"...
  problemStatementId?: string; // Original ID from CSV if present
  originalText: string;
  title: string;
  description: string;
  category?: string;
  team?: string | null;
  organization?: string | null;
  department?: string | null;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  requirements?: string[];
  status: 'VALID' | 'DUPLICATE' | 'EMPTY' | 'INVALID';
  validationNotes: string;
  isExistingDuplicate?: boolean;
  rowNumber: number;
  // AI Analysis enrichments
  aiAnalyzed?: boolean;
  analysis?: string;
  confidence?: number;
  aiQualityScore?: number; // 1-10
  aiIssues?: string[];
  aiSuggestions?: string[];
  aiDetectedCategory?: string;
  aiDetectedDifficulty?: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface CsvValidationSummary {
  totalRows: number;
  validQuestions: number;
  invalidRows: number;
  duplicateQuestions: number;
  emptyQuestions: number;
  aiAnalyzedCount?: number;
}

export interface AnalyzedProblemOutputItem {
  sequence: number;
  order: number;
  problemStatementId: string;
  title: string;
  description: string;
  category: string;
  team: string | null;
  organization: string | null;
  department: string | null;
  analysis: string;
  confidence: number;
  isValid: boolean;
  qualityScore: number;
  issues: string[];
  suggestions: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface CsvAiAnalysisResponse {
  success: boolean;
  totalProblems: number;
  aiModelUsed: string;
  aiSuccess: boolean;
  aiError?: string | null;
  problems: AnalyzedProblemOutputItem[];
}

export interface CsvAnalysisResult {
  detectedQuestionColumn: string;
  detectedColumns: {
    idKey?: string;
    questionKey: string;
    descriptionKey?: string;
    categoryKey?: string;
    teamKey?: string;
    orgKey?: string;
    deptKey?: string;
    difficultyKey?: string;
  };
  summary: CsvValidationSummary;
  questions: AnalyzedQuestionItem[];
  validItemsToSave: AnalyzedQuestionItem[];
  fileName: string;
  aiAnalysisPerformed?: boolean;
  aiAnalysisSuccess?: boolean;
  aiAnalysisError?: string | null;
  aiModelUsed?: string;
}

/**
 * Sanitizes cell text against CSV formula injection attacks (=, +, -, @)
 */
export function sanitizeCsvCell(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  // Neutralize formula injection triggers
  if (['=', '+', '-', '@', '\t', '\r'].some((char) => trimmed.startsWith(char))) {
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Safely parses raw CSV text handling quotes, multiline values, and comma/tab/semicolon delimiters
 */
export function parseRawCsvText(csvText: string): { headers: string[]; rows: string[][] } {
  if (!csvText || !csvText.trim()) {
    throw new Error('Could not read CSV file: File is empty.');
  }

  // Detect delimiter (, or ; or \t)
  const firstLine = csvText.split('\n')[0] || '';
  let delimiter = ',';
  if (firstLine.includes('\t') && !firstLine.includes(',')) {
    delimiter = '\t';
  } else if (firstLine.includes(';') && !firstLine.includes(',')) {
    delimiter = ';';
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote ("")
        currentCell += '"';
        i++;
      } else {
        // Toggle quote mode
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      currentCell = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    throw new Error('CSV analysis failed: No data rows found in CSV.');
  }

  const headers = rows[0].map((h) => h.toLowerCase().trim().replace(/^['"]+|['"]+$/g, ''));
  const dataRows = rows.slice(1);

  return { headers, rows: dataRows };
}

/**
 * Common column aliases for problem statement CSVs
 */
const ID_COLUMN_ALIASES = [
  'problem statement id',
  'problem_statement_id',
  'statement_id',
  'statement id',
  'problem_id',
  'problem id',
  'ps_id',
  'ps id',
  'psid',
  'ps_no',
  'ps no',
  'id',
  'code',
  'number',
  'sl_no',
  'sl no',
  's_no',
  'sno',
];

const QUESTION_COLUMN_ALIASES = [
  'problem statement description',
  'problem_statement_description',
  'problem statement',
  'problem_statement',
  'problemstatement',
  'problem_statements',
  'problem statements',
  'problem description',
  'problem_description',
  'question',
  'questions',
  'problem',
  'problems',
  'statement',
  'statements',
  'problem_title',
  'problem title',
  'problemtitle',
  'title',
  'challenge',
  'challenges',
  'task',
  'tasks',
  'prompt',
  'prompts',
  'topic',
  'description',
  'details',
  'overview',
  'summary',
];

const DESCRIPTION_COLUMN_ALIASES = [
  'problem statement description',
  'problem_statement_description',
  'description',
  'problem_description',
  'problem description',
  'details',
  'overview',
  'summary',
  'body',
  'specification',
  'statement',
];

const CATEGORY_COLUMN_ALIASES = [
  'category',
  'domain',
  'track',
  'theme',
  'type',
  'field',
  'tag',
  'tags',
  'area',
  'stream',
];

const TEAM_COLUMN_ALIASES = [
  'team',
  'team name',
  'team_name',
  'target team',
  'target_team',
  'assigned team',
  'assigned_team',
  'group',
  'team_id',
  'assigned_to',
];

const ORG_COLUMN_ALIASES = [
  'organization',
  'org',
  'company',
  'sponsor',
  'client',
  'partner',
  'institution',
  'source_org',
  'agency',
  'enterprise',
];

const DEPT_COLUMN_ALIASES = [
  'department',
  'dept',
  'unit',
  'division',
  'branch',
  'sub_unit',
  'function',
];

const DIFFICULTY_COLUMN_ALIASES = [
  'difficulty',
  'level',
  'complexity',
  'tier',
  'grade',
];

/**
 * Detects question, ID, category, team, organization, department, and difficulty columns from CSV headers
 */
export function detectCsvColumns(headers: string[]): {
  idIndex: number;
  idKey?: string;
  questionIndex: number;
  questionKey: string;
  descriptionIndex: number;
  descriptionKey?: string;
  categoryIndex: number;
  categoryKey?: string;
  teamIndex: number;
  teamKey?: string;
  orgIndex: number;
  orgKey?: string;
  deptIndex: number;
  deptKey?: string;
  difficultyIndex: number;
  difficultyKey?: string;
} {
  let idIndex = -1;
  let idKey: string | undefined;
  let questionIndex = -1;
  let questionKey = '';
  let descriptionIndex = -1;
  let descriptionKey: string | undefined;
  let categoryIndex = -1;
  let categoryKey: string | undefined;
  let teamIndex = -1;
  let teamKey: string | undefined;
  let orgIndex = -1;
  let orgKey: string | undefined;
  let deptIndex = -1;
  let deptKey: string | undefined;
  let difficultyIndex = -1;
  let difficultyKey: string | undefined;

  // 1. Match ID Column
  for (const alias of ID_COLUMN_ALIASES) {
    const idx = headers.findIndex((h) => h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, ''));
    if (idx >= 0) {
      idIndex = idx;
      idKey = headers[idx];
      break;
    }
  }

  // 2. Match Category Column
  for (const alias of CATEGORY_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && (h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, '')));
    if (idx >= 0) {
      categoryIndex = idx;
      categoryKey = headers[idx];
      break;
    }
  }

  // 3. Match Team Column
  for (const alias of TEAM_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && i !== categoryIndex && (h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, '')));
    if (idx >= 0) {
      teamIndex = idx;
      teamKey = headers[idx];
      break;
    }
  }

  // 4. Match Organization Column
  for (const alias of ORG_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && i !== categoryIndex && i !== teamIndex && (h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, '')));
    if (idx >= 0) {
      orgIndex = idx;
      orgKey = headers[idx];
      break;
    }
  }

  // 5. Match Department Column
  for (const alias of DEPT_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && i !== categoryIndex && i !== teamIndex && i !== orgIndex && (h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, '')));
    if (idx >= 0) {
      deptIndex = idx;
      deptKey = headers[idx];
      break;
    }
  }

  // 6. Match Difficulty Column
  for (const alias of DIFFICULTY_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && (h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, '')));
    if (idx >= 0) {
      difficultyIndex = idx;
      difficultyKey = headers[idx];
      break;
    }
  }

  // 7. Match Question / Title / Problem Statement Column (Primary)
  for (const alias of QUESTION_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && i !== categoryIndex && i !== teamIndex && i !== orgIndex && i !== deptIndex && i !== difficultyIndex && (h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, '')));
    if (idx >= 0) {
      questionIndex = idx;
      questionKey = headers[idx];
      break;
    }
  }

  // Fallback match for question column
  if (questionIndex === -1) {
    const idx = headers.findIndex((h, i) => i !== idIndex && (h.includes('question') || h.includes('problem') || h.includes('statement') || h.includes('title') || h.includes('desc')));
    if (idx >= 0) {
      questionIndex = idx;
      questionKey = headers[idx];
    }
  }

  // 8. Match separate Description Column if distinct from Question Column
  for (const alias of DESCRIPTION_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== idIndex && i !== questionIndex && i !== categoryIndex && i !== teamIndex && i !== orgIndex && i !== deptIndex && (h === alias || h.includes(alias)));
    if (idx >= 0) {
      descriptionIndex = idx;
      descriptionKey = headers[idx];
      break;
    }
  }

  return {
    idIndex,
    idKey,
    questionIndex,
    questionKey,
    descriptionIndex,
    descriptionKey,
    categoryIndex,
    categoryKey,
    teamIndex,
    teamKey,
    orgIndex,
    orgKey,
    deptIndex,
    deptKey,
    difficultyIndex,
    difficultyKey,
  };
}

/**
 * Normalizes text for duplicate checking (trims, removes special chars, lowercases)
 */
export function normalizeQuestionText(text: string): string {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Analyzes CSV content without modifying database
 */
export function analyzeCsvProblemStatements(
  rawCsvText: string,
  fileName: string,
  existingProblems: ProblemStatement[] = []
): CsvAnalysisResult {
  const { headers, rows } = parseRawCsvText(rawCsvText);

  const {
    idIndex,
    idKey,
    questionIndex,
    questionKey,
    descriptionIndex,
    descriptionKey,
    categoryIndex,
    categoryKey,
    teamIndex,
    teamKey,
    orgIndex,
    orgKey,
    deptIndex,
    deptKey,
    difficultyIndex,
    difficultyKey,
  } = detectCsvColumns(headers);

  if (questionIndex === -1) {
    throw new Error(
      `CSV analysis failed: Question column not found.\nDetected headers: [${headers.join(', ')}].\nSupported headers: problem_statement_id, category, team, organization, department, problem_statement_description, question, problem, title, description.`
    );
  }

  const existingNormalizedMap = new Map<string, string>();
  existingProblems.forEach((p) => {
    if (p && p.title) {
      existingNormalizedMap.set(normalizeQuestionText(p.title), p.title);
    }
    if (p && p.description && p.description !== p.title) {
      existingNormalizedMap.set(normalizeQuestionText(p.description), p.title);
    }
  });

  const seenInCsvMap = new Set<string>();
  const questions: AnalyzedQuestionItem[] = [];

  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  let emptyCount = 0;

  let currentSequence = 1;

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2; // 1-indexed header + row

    // Check if entire row is empty
    if (row.length === 0 || row.every((c) => !c || c.trim().length === 0)) {
      emptyCount++;
      invalidCount++;
      return;
    }

    const rawId = idIndex >= 0 ? sanitizeCsvCell(row[idIndex] || '') : undefined;
    const rawQuestion = row[questionIndex] || '';
    const cleanQuestion = sanitizeCsvCell(rawQuestion);
    const rawDescription = descriptionIndex >= 0 ? sanitizeCsvCell(row[descriptionIndex] || '') : '';
    const rawCategory = categoryIndex >= 0 ? sanitizeCsvCell(row[categoryIndex] || '') : undefined;
    const rawTeam = teamIndex >= 0 ? sanitizeCsvCell(row[teamIndex] || '') : undefined;
    const rawOrg = orgIndex >= 0 ? sanitizeCsvCell(row[orgIndex] || '') : undefined;
    const rawDept = deptIndex >= 0 ? sanitizeCsvCell(row[deptIndex] || '') : undefined;
    const rawDifficulty = difficultyIndex >= 0 ? sanitizeCsvCell(row[difficultyIndex] || '') : undefined;

    // Compose final description & title
    let title = cleanQuestion;
    let description = rawDescription || cleanQuestion;
    if (descriptionIndex >= 0 && rawDescription && questionIndex !== descriptionIndex) {
      title = cleanQuestion;
      description = rawDescription;
    } else if (cleanQuestion.length > 80 && !title.includes('\n')) {
      title = cleanQuestion.slice(0, 77) + '...';
      description = cleanQuestion;
    }

    const questionNumber = `Question ${currentSequence}`;
    const statementId = rawId && rawId.length > 0 ? rawId : `PS${String(currentSequence).padStart(3, '0')}`;

    // 1. Empty Question Validation
    if (!cleanQuestion || cleanQuestion.trim().length === 0) {
      emptyCount++;
      invalidCount++;
      questions.push({
        sequence: currentSequence,
        order: currentSequence,
        questionNumber,
        statementId,
        problemStatementId: rawId,
        originalText: rawQuestion || '[EMPTY]',
        title: `[Empty Row ${rowNumber}]`,
        description: rawDescription,
        category: rawCategory,
        team: rawTeam || null,
        organization: rawOrg || null,
        department: rawDept || null,
        status: 'EMPTY',
        validationNotes: `Row ${rowNumber}: Problem statement text is missing or empty.`,
        rowNumber,
      });
      currentSequence++;
      return;
    }

    const normalized = normalizeQuestionText(cleanQuestion);

    // 2. Duplicate within current CSV validation
    if (seenInCsvMap.has(normalized)) {
      duplicateCount++;
      invalidCount++;
      questions.push({
        sequence: currentSequence,
        order: currentSequence,
        questionNumber,
        statementId,
        problemStatementId: rawId,
        originalText: rawQuestion,
        title,
        description,
        category: rawCategory,
        team: rawTeam || null,
        organization: rawOrg || null,
        department: rawDept || null,
        status: 'DUPLICATE',
        validationNotes: `Duplicate: Same problem statement appears earlier in this CSV.`,
        rowNumber,
      });
      currentSequence++;
      return;
    }

    seenInCsvMap.add(normalized);

    // 3. Duplicate against existing database problems validation
    const existingMatch = existingNormalizedMap.get(normalized);
    if (existingMatch) {
      duplicateCount++;
      invalidCount++;
      questions.push({
        sequence: currentSequence,
        order: currentSequence,
        questionNumber,
        statementId,
        problemStatementId: rawId,
        originalText: rawQuestion,
        title,
        description,
        category: rawCategory,
        team: rawTeam || null,
        organization: rawOrg || null,
        department: rawDept || null,
        status: 'DUPLICATE',
        isExistingDuplicate: true,
        validationNotes: `Duplicate: Already exists in database as "${existingMatch}".`,
        rowNumber,
      });
      currentSequence++;
      return;
    }

    // 4. Content length validation (min 3 characters)
    if (cleanQuestion.trim().length < 3) {
      invalidCount++;
      questions.push({
        sequence: currentSequence,
        order: currentSequence,
        questionNumber,
        statementId,
        problemStatementId: rawId,
        originalText: rawQuestion,
        title,
        description,
        category: rawCategory,
        team: rawTeam || null,
        organization: rawOrg || null,
        department: rawDept || null,
        status: 'INVALID',
        validationNotes: `Problem statement text is too short (min 3 characters).`,
        rowNumber,
      });
      currentSequence++;
      return;
    }

    // Normalized difficulty
    let parsedDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | undefined = undefined;
    if (rawDifficulty) {
      const upperDiff = rawDifficulty.toUpperCase();
      if (upperDiff.includes('EASY')) parsedDifficulty = 'EASY';
      else if (upperDiff.includes('HARD') || upperDiff.includes('ADVANCED')) parsedDifficulty = 'HARD';
      else if (upperDiff.includes('MED')) parsedDifficulty = 'MEDIUM';
    }

    // Valid question item
    validCount++;
    questions.push({
      sequence: currentSequence,
      order: currentSequence,
      questionNumber,
      statementId,
      problemStatementId: rawId,
      originalText: rawQuestion,
      title,
      description,
      category: rawCategory,
      team: rawTeam || null,
      organization: rawOrg || null,
      department: rawDept || null,
      difficulty: parsedDifficulty,
      status: 'VALID',
      validationNotes: 'VALID: Ready for AI review.',
      rowNumber,
    });

    currentSequence++;
  });

  const validItemsToSave = questions.filter((q) => q.status === 'VALID');

  return {
    detectedQuestionColumn: questionKey,
    detectedColumns: {
      idKey,
      questionKey,
      descriptionKey,
      categoryKey,
      teamKey,
      orgKey,
      deptKey,
      difficultyKey,
    },
    summary: {
      totalRows: rows.length,
      validQuestions: validCount,
      invalidRows: invalidCount,
      duplicateQuestions: duplicateCount,
      emptyQuestions: emptyCount,
    },
    questions,
    validItemsToSave,
    fileName,
  };
}

/**
 * Helper to generate structured fallback results if worker is temporarily unreachable
 */
export function generateClientFallbackResponse(validQuestions: AnalyzedQuestionItem[]): CsvAiAnalysisResponse {
  return {
    success: true,
    totalProblems: validQuestions.length,
    aiModelUsed: 'anthropic/claude-sonnet-4.6 (Local Fallback)',
    aiSuccess: false,
    aiError: 'Cloudflare Worker backend offline or unreachable',
    problems: validQuestions.map((item, idx) => {
      const seq = item.sequence ?? idx + 1;
      const docId = item.problemStatementId || `PS${String(seq).padStart(3, '0')}`;
      const title = item.title || (item.description.length > 80 ? item.description.slice(0, 77) + '...' : item.description);

      return {
        sequence: seq,
        order: item.order || seq,
        problemStatementId: docId,
        title,
        description: item.description,
        category: item.category || 'General',
        team: item.team || null,
        organization: item.organization || null,
        department: item.department || null,
        analysis: `Problem statement #${seq}: ${title}`,
        confidence: 0.85,
        isValid: true,
        qualityScore: 7,
        issues: [],
        suggestions: [],
        difficulty: (['EASY', 'MEDIUM', 'HARD'].includes(item.difficulty?.toUpperCase() || '')
          ? (item.difficulty!.toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD')
          : 'MEDIUM'),
      };
    }),
  };
}

/**
 * Calls Cloudflare Worker backend to perform Claude OpenRouter AI analysis on parsed CSV questions
 */
export async function requestCsvAiAnalysis(
  validQuestions: AnalyzedQuestionItem[],
  fileName: string
): Promise<CsvAiAnalysisResponse> {
  const payload = {
    fileName,
    questions: validQuestions.map((q) => ({
      sequence: q.sequence,
      rowNumber: q.rowNumber,
      problemStatementId: q.problemStatementId || q.statementId,
      category: q.category,
      team: q.team,
      organization: q.organization,
      department: q.department,
      title: q.title,
      description: q.description || q.title,
      difficulty: q.difficulty,
    })),
  };

  const rawWorkerEnv = import.meta.env.VITE_AI_ANALYZER_WORKER_URL?.trim();
  const baseWorkerUrl = (rawWorkerEnv && rawWorkerEnv.length > 0)
    ? rawWorkerEnv
    : 'https://hackathon-csv-ai-analyzer.hackathon-csv-ai.workers.dev';

  const workerUrl = baseWorkerUrl.endsWith('/analyze-csv')
    ? baseWorkerUrl
    : `${baseWorkerUrl.replace(/\/+$/, '')}/analyze-csv`;

  try {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(workerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data: CsvAiAnalysisResponse = await res.json();
      if (data && Array.isArray(data.problems) && data.problems.length > 0) {
        return data;
      }
    }
  } catch (workerErr: any) {
    console.warn('[CsvAnalyzer] Cloudflare Worker fetch error, applying fallback:', workerErr.message);
  }

  // Graceful fallback if Cloudflare Worker endpoint is not reachable
  return generateClientFallbackResponse(validQuestions);
}

/**
 * Merges AI analysis results into the question items
 */
export function mergeAiAnalysisIntoQuestions(
  questions: AnalyzedQuestionItem[],
  aiResponse: CsvAiAnalysisResponse
): AnalyzedQuestionItem[] {
  const problemsList: any[] = aiResponse?.problems || (aiResponse as any)?.results || [];
  if (!problemsList || problemsList.length === 0) return questions;
  const resultMap = new Map<number, any>();
  problemsList.forEach((p) => resultMap.set(p.sequence, p));

  return questions.map((q) => {
    const aiItem = resultMap.get(q.sequence);
    if (!aiItem) return q;

    const notesParts = [q.validationNotes];
    if (aiItem.issues && aiItem.issues.length > 0) {
      notesParts.push(`AI Issues: ${aiItem.issues.join('; ')}`);
    }

    const itemCategory = aiItem.category || aiItem.detectedCategory;
    const itemDifficulty = aiItem.difficulty || aiItem.detectedDifficulty;

    return {
      ...q,
      aiAnalyzed: true,
      order: aiItem.order || q.sequence,
      statementId: aiItem.problemStatementId || q.statementId,
      problemStatementId: aiItem.problemStatementId || q.problemStatementId || q.statementId,
      title: aiItem.title || q.title,
      description: aiItem.description || q.description,
      category: q.category || (itemCategory && itemCategory !== 'General' ? itemCategory : q.category || itemCategory),
      team: q.team || aiItem.team,
      organization: q.organization || aiItem.organization,
      department: q.department || aiItem.department,
      analysis: aiItem.analysis,
      confidence: aiItem.confidence,
      aiQualityScore: aiItem.qualityScore,
      aiIssues: aiItem.issues,
      aiSuggestions: aiItem.suggestions,
      difficulty: q.difficulty || itemDifficulty,
      validationNotes: notesParts.join(' | '),
    };
  });
}

/**
 * Persists validated questions to Firestore in an atomic batch
 */
export async function saveAnalyzedProblemsToFirestore(
  validQuestions: AnalyzedQuestionItem[],
  fileName: string,
  user?: { uid?: string; email?: string }
): Promise<{ success: boolean; savedCount: number; statementIds: string[] }> {
  if (!validQuestions || validQuestions.length === 0) {
    throw new Error('No valid problem statements to save.');
  }

  const batch = writeBatch(db);
  const now = serverTimestamp();
  const savedIds: string[] = [];

  const currentUser = auth.currentUser;
  const adminUid = user?.uid || currentUser?.uid || 'admin';
  const adminEmail = user?.email || currentUser?.email || 'admin@hackathon.org';

  validQuestions.forEach((item, idx) => {
    const seq = item.sequence || idx + 1;
    const docId = item.problemStatementId || `PS${String(seq).padStart(3, '0')}`;
    const docRef = doc(db, 'problemStatements', docId);

    const docData: any = {
      statementId: docId,
      problemStatementId: docId,
      title: item.title,
      description: item.description,
      category: item.category || 'General',
      team: item.team || null,
      organization: item.organization || null,
      department: item.department || null,
      difficulty: item.difficulty || 'MEDIUM',
      requirements: item.requirements || [],
      sequence: seq,
      order: item.order || seq,
      status: 'DRAFT', // Draft-first: hidden from users until published
      sourceFile: fileName,
      sourceType: 'CSV_AI_ANALYZER',
      originalQuestionText: item.originalText,
      createdAt: now,
      updatedAt: now,
      createdBy: adminEmail,
      creatorUid: adminUid,
    };

    if (item.aiAnalyzed) {
      docData.aiAnalyzed = true;
      docData.aiProcessed = true;
      if (item.analysis) docData.analysis = item.analysis;
      if (item.confidence !== undefined) docData.confidence = item.confidence;
      if (item.aiQualityScore !== undefined) docData.aiQualityScore = item.aiQualityScore;
      if (item.aiIssues && item.aiIssues.length > 0) docData.aiIssues = item.aiIssues;
      if (item.aiSuggestions && item.aiSuggestions.length > 0) docData.aiSuggestions = item.aiSuggestions;
      if (item.aiDetectedCategory) docData.aiDetectedCategory = item.aiDetectedCategory;
      if (item.aiDetectedDifficulty) docData.aiDetectedDifficulty = item.aiDetectedDifficulty;
    }

    batch.set(docRef, docData, { merge: true });
    savedIds.push(docId);
  });

  // Save Import record
  const importDocRef = doc(collection(db, 'problemImports'));
  batch.set(importDocRef, {
    importId: importDocRef.id,
    fileName,
    totalCreated: validQuestions.length,
    importedBy: adminEmail,
    uploadedAt: now,
    status: 'COMPLETED',
    sourceType: 'CSV_AI_ANALYZER',
  });

  // Save Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    id: auditRef.id,
    adminUid,
    adminEmail,
    action: 'CSV Problem Statements Analyzed with AI & Imported',
    targetType: 'problem',
    targetId: 'problemStatements_batch',
    timestamp: new Date().toISOString(),
    metadata: {
      fileName,
      savedCount: validQuestions.length,
      statementIds: savedIds,
    },
  });

  await batch.commit();

  // Auto-assign existing teams to newly imported problems (TEAM<N> → Problem #N)
  try {
    const { assignExistingTeamsAfterImport } = await import('./problemAssignment.service');
    const assignResult = await assignExistingTeamsAfterImport(user);
    console.log('[CsvAnalyzer] Post-import auto-assignment:', assignResult);
  } catch (assignErr: any) {
    console.warn('[CsvAnalyzer] Post-import auto-assignment warning (non-blocking):', assignErr.message);
  }

  return {
    success: true,
    savedCount: validQuestions.length,
    statementIds: savedIds,
  };
}
