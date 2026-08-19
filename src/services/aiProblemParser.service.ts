import { ParsedProblemStatement } from '../types';

/**
 * Computes a simple SHA-256 fingerprint from string content
 */
export async function computeContentHash(content: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `hash_${Math.abs(hash)}_${content.length}`;
  }
}

/**
 * Extracts plain text from various file formats (.txt, .json, .csv, .pdf, .docx)
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();

  // 1. Plain Text, CSV, JSON
  if (fileName.endsWith('.txt') || fileName.endsWith('.csv') || fileName.endsWith('.json') || fileName.endsWith('.md')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        resolve(text);
      };
      reader.onerror = () => reject(new Error('Failed to read file contents.'));
      reader.readAsText(file);
    });
  }

  // 2. Binary formats (PDF / DOCX text stream extraction)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(buffer);
        // Extract readable ASCII and UTF-8 printable text runs
        let rawText = '';
        let currentRun = '';
        for (let i = 0; i < bytes.length; i++) {
          const byte = bytes[i];
          // Standard printable ASCII or common whitespace
          if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
            currentRun += String.fromCharCode(byte);
          } else {
            if (currentRun.length >= 3) {
              rawText += currentRun + ' ';
            }
            currentRun = '';
          }
        }
        if (currentRun.length >= 3) rawText += currentRun;

        // Clean up formatting
        const cleaned = rawText
          .replace(/\r\n/g, '\n')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .trim();

        if (cleaned.length < 20) {
          throw new Error('Extracted text is too short or binary was unreadable.');
        }
        resolve(cleaned);
      } catch (err: any) {
        reject(new Error(`Failed to extract text from ${file.name}: ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read binary file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Intelligent parser that splits document into distinct problem statements
 * and extracts structured fields without hallucination.
 */
export function parseProblemStatementsText(
  rawText: string,
  fileName: string
): ParsedProblemStatement[] {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('The uploaded document contains no readable text.');
  }

  // Check if the file is a JSON array
  if (rawText.trim().startsWith('[') && rawText.trim().endsWith(']')) {
    try {
      const parsedArray = JSON.parse(rawText.trim());
      if (Array.isArray(parsedArray) && parsedArray.length > 0) {
        return parsedArray.map((item, idx) => ({
          sequence: idx + 1,
          title: item.title || item.problemTitle || `Problem Statement ${idx + 1}`,
          description: item.description || item.problemDescription || '',
          examples: item.examples || item.example || undefined,
          technicalGuidelines: item.technicalGuidelines || item.guidelines || item.technical || undefined,
          constraints: item.constraints || item.constraint || undefined,
          expectedOutcome: item.expectedOutcome || item.outcome || item.deliverables || undefined,
          sourceFile: fileName,
          aiProcessed: true,
        }));
      }
    } catch {
      // Continue to text-based parsing
    }
  }

  // Split by common Problem separators:
  // "Problem 1", "Problem Statement 1", "PS 1", "1. Title", "Problem #1", etc.
  const problemRegex = /(?:^|\n\s*)(?:(?:Problem\s*(?:Statement)?\s*(?:#|No\.?)?\s*(\d+)[:.\-–]?)|(?:(\d+)\.\s+[A-Z]))/gi;

  const matches: Array<{ index: number; numberStr: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = problemRegex.exec(rawText)) !== null) {
    matches.push({
      index: match.index,
      numberStr: match[1] || match[2] || '',
    });
  }

  const rawChunks: string[] = [];

  if (matches.length >= 2) {
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i < matches.length - 1 ? matches[i + 1].index : rawText.length;
      const chunk = rawText.slice(start, end).trim();
      if (chunk.length > 20) {
        rawChunks.push(chunk);
      }
    }
  } else {
    // Alternative chunking by double newlines or sequential numbered sections
    const doubleNewlineChunks = rawText
      .split(/\n\s*\n(?=[A-Z0-9#])/)
      .map((c) => c.trim())
      .filter((c) => c.length > 30);

    if (doubleNewlineChunks.length >= 2) {
      rawChunks.push(...doubleNewlineChunks);
    } else {
      // Single problem document
      rawChunks.push(rawText.trim());
    }
  }

  const parsedList: ParsedProblemStatement[] = [];

  rawChunks.forEach((chunk, index) => {
    const lines = chunk.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return;

    let title = '';
    let description = '';
    let examples = '';
    let technicalGuidelines = '';
    let constraints = '';
    let expectedOutcome = '';

    // First line typically contains Title
    let firstLine = lines[0]
      .replace(/^(?:Problem\s*(?:Statement)?\s*(?:#|No\.?)?\s*\d+[:.\-–]?\s*)/i, '')
      .replace(/^\d+[:.)\-–]\s*/, '')
      .replace(/^Title[:\-–]\s*/i, '')
      .trim();

    title = firstLine || `Problem Statement ${index + 1}`;

    // Extract sections
    let currentSection: 'description' | 'requirements' | 'examples' | 'guidelines' | 'constraints' | 'outcome' | 'evaluation' = 'description';
    const bodyLines = lines.slice(1);
    const requirementsArr: string[] = [];

    for (const line of bodyLines) {
      const lower = line.toLowerCase();

      if (lower.startsWith('description:') || lower.startsWith('overview:') || lower.startsWith('problem description:')) {
        currentSection = 'description';
        const content = line.replace(/^[^:]+:\s*/i, '').trim();
        if (content) description += (description ? '\n' : '') + content;
      } else if (lower.startsWith('requirements:') || lower.startsWith('key requirements:') || lower.startsWith('functional requirements:')) {
        currentSection = 'requirements';
        const content = line.replace(/^[^:]+:\s*/i, '').trim();
        if (content) requirementsArr.push(content);
      } else if (lower.startsWith('technical guidelines:') || lower.startsWith('guidelines:') || lower.startsWith('technical stack:') || lower.startsWith('tech guidelines:')) {
        currentSection = 'guidelines';
        const content = line.replace(/^[^:]+:\s*/i, '').trim();
        if (content) technicalGuidelines += (technicalGuidelines ? '\n' : '') + content;
      } else if (lower.startsWith('constraints:') || lower.startsWith('limitations:') || lower.startsWith('system constraints:')) {
        currentSection = 'constraints';
        const content = line.replace(/^[^:]+:\s*/i, '').trim();
        if (content) constraints += (constraints ? '\n' : '') + content;
      } else if (lower.startsWith('expected outcome:') || lower.startsWith('outcome:') || lower.startsWith('deliverables:') || lower.startsWith('expected deliverables:')) {
        currentSection = 'outcome';
        const content = line.replace(/^[^:]+:\s*/i, '').trim();
        if (content) expectedOutcome += (expectedOutcome ? '\n' : '') + content;
      } else if (lower.startsWith('examples:') || lower.startsWith('example:') || lower.startsWith('use cases:') || lower.startsWith('sample use cases:')) {
        currentSection = 'examples';
        const content = line.replace(/^[^:]+:\s*/i, '').trim();
        if (content) examples += (examples ? '\n' : '') + content;
      } else {
        // Append to current active section
        if (currentSection === 'description') {
          description += (description ? '\n' : '') + line;
        } else if (currentSection === 'requirements') {
          requirementsArr.push(line.replace(/^[-*•\d.]+\s*/, '').trim());
        } else if (currentSection === 'guidelines') {
          technicalGuidelines += (technicalGuidelines ? '\n' : '') + line;
        } else if (currentSection === 'constraints') {
          constraints += (constraints ? '\n' : '') + line;
        } else if (currentSection === 'outcome') {
          expectedOutcome += (expectedOutcome ? '\n' : '') + line;
        } else if (currentSection === 'examples') {
          examples += (examples ? '\n' : '') + line;
        }
      }
    }

    if (!description) {
      description = bodyLines.join('\n') || title;
    }

    parsedList.push({
      sequence: index + 1,
      title: title.length > 120 ? title.slice(0, 117) + '...' : title,
      description,
      requirements: requirementsArr.length > 0 ? requirementsArr : undefined,
      examples: examples || undefined,
      technicalGuidelines: technicalGuidelines || undefined,
      constraints: constraints || undefined,
      expectedOutcome: expectedOutcome || undefined,
      sourceFile: fileName,
      aiProcessed: true,
    });
  });

  if (parsedList.length === 0) {
    throw new Error('AI could not identify distinct problem statements. Please review the document format.');
  }

  // Renumber sequence strictly 1..N
  return parsedList.map((item, idx) => ({
    ...item,
    sequence: idx + 1,
  }));
}
