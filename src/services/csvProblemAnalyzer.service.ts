import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../firebase/config';
import { ProblemStatement } from '../types';

export interface AnalyzedQuestionItem {
  sequence: number;
  questionNumber: string; // "Question 1", "Question 2"...
  statementId: string; // "PS001", "PS002"...
  originalText: string;
  title: string;
  description: string;
  category?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  requirements?: string[];
  status: 'VALID' | 'DUPLICATE' | 'EMPTY' | 'INVALID';
  validationNotes: string;
  isExistingDuplicate?: boolean;
  rowNumber: number;
  // AI Analysis enrichments
  aiAnalyzed?: boolean;
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

export interface CsvAiAnalysisResponse {
  success: boolean;
  aiSuccess: boolean;
  aiError?: string | null;
  wasTruncated?: boolean;
  totalAnalyzed: number;
  results: Array<{
    sequence: number;
    isValid: boolean;
    qualityScore: number;
    issues: string[];
    suggestions: string[];
    detectedCategory: string;
    detectedDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
  }>;
}

export interface CsvAnalysisResult {
  detectedQuestionColumn: string;
  detectedColumns: {
    questionKey: string;
    descriptionKey?: string;
    categoryKey?: string;
    difficultyKey?: string;
  };
  summary: CsvValidationSummary;
  questions: AnalyzedQuestionItem[];
  validItemsToSave: AnalyzedQuestionItem[];
  fileName: string;
  aiAnalysisPerformed?: boolean;
  aiAnalysisSuccess?: boolean;
  aiAnalysisError?: string | null;
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
 * Common question column name aliases
 */
const QUESTION_COLUMN_ALIASES = [
  'question',
  'questions',
  'problem',
  'problems',
  'problem_statement',
  'problemstatement',
  'problem_statements',
  'statement',
  'statements',
  'problem_title',
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
];

const DESCRIPTION_COLUMN_ALIASES = [
  'description',
  'problem_description',
  'details',
  'overview',
  'summary',
  'body',
  'specification',
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
];

const DIFFICULTY_COLUMN_ALIASES = [
  'difficulty',
  'level',
  'complexity',
  'tier',
];

/**
 * Detects question and supplementary columns from CSV headers
 */
export function detectCsvColumns(headers: string[]): {
  questionIndex: number;
  questionKey: string;
  descriptionIndex: number;
  categoryIndex: number;
  difficultyIndex: number;
} {
  let questionIndex = -1;
  let questionKey = '';
  let descriptionIndex = -1;
  let categoryIndex = -1;
  let difficultyIndex = -1;

  // 1. Match Question Column (Highest priority)
  for (const alias of QUESTION_COLUMN_ALIASES) {
    const idx = headers.findIndex((h) => h === alias || h.replace(/[^a-z0-9]/g, '') === alias.replace(/[^a-z0-9]/g, ''));
    if (idx >= 0) {
      questionIndex = idx;
      questionKey = headers[idx];
      break;
    }
  }

  // Fallback match: column header containing "question" or "problem"
  if (questionIndex === -1) {
    const idx = headers.findIndex((h) => h.includes('question') || h.includes('problem') || h.includes('statement') || h.includes('title'));
    if (idx >= 0) {
      questionIndex = idx;
      questionKey = headers[idx];
    }
  }

  // 2. Match Description Column
  for (const alias of DESCRIPTION_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== questionIndex && (h === alias || h.includes(alias)));
    if (idx >= 0) {
      descriptionIndex = idx;
      break;
    }
  }

  // 3. Match Category Column
  for (const alias of CATEGORY_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== questionIndex && i !== descriptionIndex && (h === alias || h.includes(alias)));
    if (idx >= 0) {
      categoryIndex = idx;
      break;
    }
  }

  // 4. Match Difficulty Column
  for (const alias of DIFFICULTY_COLUMN_ALIASES) {
    const idx = headers.findIndex((h, i) => i !== questionIndex && (h === alias || h.includes(alias)));
    if (idx >= 0) {
      difficultyIndex = idx;
      break;
    }
  }

  return {
    questionIndex,
    questionKey,
    descriptionIndex,
    categoryIndex,
    difficultyIndex,
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
    questionIndex,
    questionKey,
    descriptionIndex,
    categoryIndex,
    difficultyIndex,
  } = detectCsvColumns(headers);

  if (questionIndex === -1) {
    throw new Error(
      `CSV analysis failed: Question column not found.\nDetected headers: [${headers.join(', ')}].\nSupported headers: question, problem, problem_statement, statement, title, challenge, description.`
    );
  }

  const existingNormalizedMap = new Map<string, string>();
  existingProblems.forEach((p) => {
    if (p && p.title) {
      existingNormalizedMap.set(normalizeQuestionText(p.title), p.title);
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

    const rawQuestion = row[questionIndex] || '';
    const cleanQuestion = sanitizeCsvCell(rawQuestion);
    const rawDescription = descriptionIndex >= 0 ? sanitizeCsvCell(row[descriptionIndex] || '') : '';
    const rawCategory = categoryIndex >= 0 ? sanitizeCsvCell(row[categoryIndex] || '') : undefined;
    const rawDifficulty = difficultyIndex >= 0 ? sanitizeCsvCell(row[difficultyIndex] || '') : undefined;

    const questionNumber = `Question ${currentSequence}`;
    const statementId = `PS${String(currentSequence).padStart(3, '0')}`;

    // 1. Empty Question Validation
    if (!cleanQuestion || cleanQuestion.trim().length === 0) {
      emptyCount++;
      invalidCount++;
      questions.push({
        sequence: currentSequence,
        questionNumber,
        statementId,
        originalText: rawQuestion || '[EMPTY]',
        title: `[Empty Question Row ${rowNumber}]`,
        description: rawDescription,
        status: 'EMPTY',
        validationNotes: `Row ${rowNumber}: Question text is missing or empty.`,
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
        questionNumber,
        statementId,
        originalText: rawQuestion,
        title: cleanQuestion,
        description: rawDescription || cleanQuestion,
        category: rawCategory,
        status: 'DUPLICATE',
        validationNotes: `Duplicate: Same question already appears earlier in this CSV.`,
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
        questionNumber,
        statementId,
        originalText: rawQuestion,
        title: cleanQuestion,
        description: rawDescription || cleanQuestion,
        category: rawCategory,
        status: 'DUPLICATE',
        isExistingDuplicate: true,
        validationNotes: `Duplicate: Question already exists in database as "${existingMatch}".`,
        rowNumber,
      });
      currentSequence++;
      return;
    }

    // 4. Content length validation (e.g. at least 3 characters)
    if (cleanQuestion.trim().length < 3) {
      invalidCount++;
      questions.push({
        sequence: currentSequence,
        questionNumber,
        statementId,
        originalText: rawQuestion,
        title: cleanQuestion,
        description: rawDescription || cleanQuestion,
        status: 'INVALID',
        validationNotes: `Question text is too short (min 3 characters).`,
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
      questionNumber,
      statementId,
      originalText: rawQuestion,
      title: cleanQuestion,
      description: rawDescription || cleanQuestion,
      category: rawCategory,
      difficulty: parsedDifficulty,
      status: 'VALID',
      validationNotes: 'VALID: Ready to import.',
      rowNumber,
    });

    currentSequence++;
  });

  const validItemsToSave = questions.filter((q) => q.status === 'VALID');

  return {
    detectedQuestionColumn: questionKey,
    detectedColumns: {
      questionKey,
      descriptionKey: descriptionIndex >= 0 ? headers[descriptionIndex] : undefined,
      categoryKey: categoryIndex >= 0 ? headers[categoryIndex] : undefined,
      difficultyKey: difficultyIndex >= 0 ? headers[difficultyIndex] : undefined,
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
 * Calls Cloud Function analyzeCsvProblemsAI to perform AI review on parsed CSV questions
 */
export async function requestCsvAiAnalysis(
  validQuestions: AnalyzedQuestionItem[],
  fileName: string
): Promise<CsvAiAnalysisResponse> {
  const fn = httpsCallable<any, CsvAiAnalysisResponse>(functions, 'analyzeCsvProblemsAI');
  const payload = {
    fileName,
    questions: validQuestions.map((q) => ({
      sequence: q.sequence,
      title: q.title,
      description: q.description || q.title,
      category: q.category,
    })),
  };
  const res = await fn(payload);
  return res.data;
}

/**
 * Merges AI analysis results into the question items
 */
export function mergeAiAnalysisIntoQuestions(
  questions: AnalyzedQuestionItem[],
  aiResponse: CsvAiAnalysisResponse
): AnalyzedQuestionItem[] {
  if (!aiResponse || !aiResponse.results) return questions;
  const resultMap = new Map<number, typeof aiResponse.results[0]>();
  aiResponse.results.forEach((r) => resultMap.set(r.sequence, r));

  return questions.map((q) => {
    const aiItem = resultMap.get(q.sequence);
    if (!aiItem) return q;

    const notesParts = [q.validationNotes];
    if (aiItem.issues && aiItem.issues.length > 0) {
      notesParts.push(`AI Issues: ${aiItem.issues.join('; ')}`);
    }

    return {
      ...q,
      aiAnalyzed: true,
      aiQualityScore: aiItem.qualityScore,
      aiIssues: aiItem.issues,
      aiSuggestions: aiItem.suggestions,
      aiDetectedCategory: aiItem.detectedCategory,
      aiDetectedDifficulty: aiItem.detectedDifficulty,
      validationNotes: notesParts.join(' | '),
      // If AI detected a category and user didn't provide one, enrich category
      category: q.category || (aiItem.detectedCategory !== 'General' ? aiItem.detectedCategory : q.category),
      difficulty: q.difficulty || aiItem.detectedDifficulty,
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
    const seq = idx + 1;
    const docId = `PS${String(seq).padStart(3, '0')}`;
    const docRef = doc(db, 'problemStatements', docId);

    const docData: any = {
      statementId: docId,
      title: item.title,
      description: item.description,
      category: item.category || 'General',
      difficulty: item.difficulty || 'MEDIUM',
      requirements: item.requirements || [],
      sequence: seq,
      order: seq,
      status: 'DRAFT', // Draft-first: hidden from users until published
      sourceFile: fileName,
      sourceType: 'CSV_ANALYZER',
      originalQuestionText: item.originalText,
      createdAt: now,
      updatedAt: now,
      createdBy: adminEmail,
      creatorUid: adminUid,
    };

    if (item.aiAnalyzed) {
      docData.aiAnalyzed = true;
      docData.aiProcessed = true;
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
    sourceType: 'CSV_ANALYZER',
  });

  // Save Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    id: auditRef.id,
    adminUid,
    adminEmail,
    action: 'CSV Problem Statements Analyzed & Imported',
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

  return {
    success: true,
    savedCount: validQuestions.length,
    statementIds: savedIds,
  };
}
