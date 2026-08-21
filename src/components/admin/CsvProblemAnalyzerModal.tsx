import React, { useState } from 'react';
import {
  Modal,
  Upload,
  Button,
  Typography,
  Steps,
  Alert,
  Table,
  Tag,
  Space,
  Row,
  Col,
  Statistic,
  Card,
  Progress,
  message,
  Tabs,
  Badge,
  Tooltip,
} from 'antd';
import {
  CloudUploadOutlined,
  FileSearchOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
  SendOutlined,
  RobotOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  BankOutlined,
  TeamOutlined,
  ApartmentOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  analyzeCsvProblemStatements,
  saveAnalyzedProblemsToFirestore,
  requestCsvAiAnalysis,
  mergeAiAnalysisIntoQuestions,
  CsvAnalysisResult,
  AnalyzedQuestionItem,
} from '../../services/csvProblemAnalyzer.service';
import { extractTextFromFile, computeContentHash } from '../../services/aiProblemParser.service';
import { checkPreviousImport } from '../../services/problemAssignment.service';
import { ProblemStatement } from '../../types';
import { formatISTDateTime } from '../../utils/date';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface CsvProblemAnalyzerModalProps {
  open: boolean;
  onClose: () => void;
  existingProblems: ProblemStatement[];
  onImportComplete: () => void;
  onNavigateToDistribution?: () => void;
}

export const CsvProblemAnalyzerModal: React.FC<CsvProblemAnalyzerModalProps> = ({
  open,
  onClose,
  existingProblems,
  onImportComplete,
  onNavigateToDistribution,
}) => {
  const { user } = useAuth();

  // Workflow step: 0 = Upload, 1 = Parse, 2 = AI Review, 3 = Preview, 4 = Success
  const [step, setStep] = useState<number>(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Analysis State
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<CsvAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>('all');

  // AI Review State
  const [aiReviewing, setAiReviewing] = useState<boolean>(false);
  const [aiStatus, setAiStatus] = useState<'Processing' | 'Completed' | 'Partial' | 'Failed' | 'Idle'>('Idle');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState<number>(0);
  const [aiProgressText, setAiProgressText] = useState<string>('Preparing dataset for Claude AI analysis...');

  // Saving State
  const [saving, setSaving] = useState<boolean>(false);
  const [savedCount, setSavedCount] = useState<number>(0);

  const resetState = () => {
    setStep(0);
    setUploadedFile(null);
    setRawText('');
    setDuplicateWarning(null);
    setAnalyzing(false);
    setAnalysisResult(null);
    setAnalysisError(null);
    setProgressPercent(0);
    setActiveTab('all');
    setAiReviewing(false);
    setAiStatus('Idle');
    setAiError(null);
    setAiProgress(0);
    setAiProgressText('Preparing dataset for Claude AI analysis...');
    setSaving(false);
    setSavedCount(0);
  };

  const handleFileSelect = async (file: File) => {
    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type.includes('csv');
    if (!isCsv) {
      message.error('Please upload a valid .csv file.');
      return false;
    }

    setUploadedFile(file);
    setAnalysisError(null);
    setAiError(null);
    setAiStatus('Idle');

    try {
      const text = await extractTextFromFile(file);
      setRawText(text);

      const hash = await computeContentHash(text);
      const prev = await checkPreviousImport(hash, file.name);
      if (prev) {
        setDuplicateWarning(
          `Warning: A file with identical content was previously imported on ${formatISTDateTime(
            prev.uploadedAt
          )} (${prev.totalCreated} problems).`
        );
      } else {
        setDuplicateWarning(null);
      }
    } catch (err: any) {
      message.error(err.message || 'Could not read CSV file.');
    }

    return false;
  };

  const handleAnalyzeCsv = async () => {
    if (!uploadedFile || !rawText) {
      message.warning('Please select a CSV file to analyze.');
      return;
    }

    setStep(1);
    setAnalyzing(true);
    setAnalysisError(null);
    setAiError(null);
    setProgressPercent(25);

    let localResult: CsvAnalysisResult;

    try {
      await new Promise((r) => setTimeout(r, 200));
      setProgressPercent(50);

      // 1. Perform deterministic CSV parsing, column detection, and duplicate checks
      localResult = analyzeCsvProblemStatements(rawText, uploadedFile.name, existingProblems);
      setProgressPercent(100);
      setAnalysisResult(localResult);
      setAnalyzing(false);
    } catch (err: any) {
      console.error('[CsvAnalyzer] Local parse error:', err);
      setAnalyzing(false);
      setAnalysisError(err.message || 'CSV parsing failed. Please check column headers and content.');
      return;
    }

    // 2. If valid questions exist, run OpenRouter Claude Analysis
    if (localResult.validItemsToSave.length > 0) {
      setStep(2);
      setAiReviewing(true);
      setAiStatus('Processing');
      setAiProgress(10);
      setAiProgressText(`Preparing ${localResult.validItemsToSave.length} problem statements for Claude AI analysis...`);

      try {
        const aiResponse = await requestCsvAiAnalysis(
          localResult.validItemsToSave,
          uploadedFile.name,
          (percent, text) => {
            setAiProgress(percent);
            setAiProgressText(text);
          }
        );

        setAiProgress(100);
        setAiProgressText('Analysis complete. Reconciling results...');

        if (aiResponse && aiResponse.problems) {
          const enrichedQuestions = mergeAiAnalysisIntoQuestions(localResult.questions, aiResponse);
          const enrichedValid = mergeAiAnalysisIntoQuestions(localResult.validItemsToSave, aiResponse);
          const realAiCount = aiResponse.aiAnalyzedCount !== undefined
            ? aiResponse.aiAnalyzedCount
            : (aiResponse.aiSuccess ? aiResponse.totalProblems : 0);

          setAnalysisResult({
            ...localResult,
            questions: enrichedQuestions,
            validItemsToSave: enrichedValid,
            aiAnalysisPerformed: true,
            aiAnalysisSuccess: Boolean(aiResponse.aiSuccess && realAiCount === localResult.summary.validQuestions),
            aiAnalysisError: aiResponse.aiError,
            aiErrorCode: aiResponse.errorCode,
            aiModelUsed: aiResponse.aiModelUsed,
            summary: {
              ...localResult.summary,
              aiAnalyzedCount: realAiCount,
            },
          });

          if (realAiCount === localResult.summary.validQuestions && realAiCount > 0) {
            setAiStatus('Completed');
            message.success(`AI Analysis Completed: ${realAiCount} problem statements analyzed by ${aiResponse.aiModelUsed || 'AI'}.`);
          } else if (realAiCount > 0) {
            setAiStatus('Partial');
            message.info(`AI Analysis Partial: ${realAiCount} / ${localResult.summary.validQuestions} problem statements analyzed by AI.`);
          } else {
            setAiStatus('Failed');
            message.warning(`AI unavailable — local validation used (${aiResponse.aiError || 'OpenRouter credits required'}).`);
          }
        }
      } catch (err: any) {
        console.warn('[CsvAnalyzer] AI call failed, proceeding with local analysis:', err);
        setAiError(err.message || 'AI service temporarily unavailable.');
        setAiStatus('Failed');
        setAiProgress(100);
        setAnalysisResult({
          ...localResult,
          aiAnalysisPerformed: true,
          aiAnalysisSuccess: false,
          aiAnalysisError: err.message,
          summary: {
            ...localResult.summary,
            aiAnalyzedCount: 0,
          },
        });
      } finally {
        setAiReviewing(false);
        setStep(3); // Proceed to Admin Review
      }
    } else {
      setStep(3); // Proceed to Review even if 0 valid items
    }
  };

  const handleRetryAi = async () => {
    if (!analysisResult || analysisResult.validItemsToSave.length === 0) return;
    setStep(2);
    setAiReviewing(true);
    setAiStatus('Processing');
    setAiError(null);
    setAiProgress(15);
    setAiProgressText(`Retrying Claude AI analysis on ${analysisResult.validItemsToSave.length} problem statements...`);

    try {
      const aiResponse = await requestCsvAiAnalysis(
        analysisResult.validItemsToSave,
        uploadedFile?.name || 'questions.csv',
        (percent, text) => {
          setAiProgress(percent);
          setAiProgressText(text);
        }
      );

      setAiProgress(100);
      setAiProgressText('Analysis complete. Reconciling results...');

      if (aiResponse && aiResponse.problems) {
        const enrichedQuestions = mergeAiAnalysisIntoQuestions(analysisResult.questions, aiResponse);
        const enrichedValid = mergeAiAnalysisIntoQuestions(analysisResult.validItemsToSave, aiResponse);
        const realAiCount = aiResponse.aiAnalyzedCount !== undefined
          ? aiResponse.aiAnalyzedCount
          : (aiResponse.aiSuccess ? aiResponse.totalProblems : 0);

        setAnalysisResult({
          ...analysisResult,
          questions: enrichedQuestions,
          validItemsToSave: enrichedValid,
          aiAnalysisPerformed: true,
          aiAnalysisSuccess: Boolean(aiResponse.aiSuccess && realAiCount === analysisResult.summary.validQuestions),
          aiAnalysisError: aiResponse.aiError,
          aiErrorCode: aiResponse.errorCode,
          aiModelUsed: aiResponse.aiModelUsed,
          summary: {
            ...analysisResult.summary,
            aiAnalyzedCount: realAiCount,
          },
        });

        if (realAiCount === analysisResult.summary.validQuestions && realAiCount > 0) {
          setAiStatus('Completed');
          message.success(`AI Analysis Completed: ${realAiCount} problem statements analyzed by ${aiResponse.aiModelUsed || 'AI'}.`);
        } else if (realAiCount > 0) {
          setAiStatus('Partial');
          message.info(`AI Analysis Partial: ${realAiCount} / ${analysisResult.summary.validQuestions} problem statements analyzed by AI.`);
        } else {
          setAiStatus('Failed');
          message.warning(`AI unavailable — local validation used (${aiResponse.aiError || 'OpenRouter credits required'}).`);
        }
      }
    } catch (err: any) {
      setAiError(err.message || 'AI review failed.');
      setAiStatus('Failed');
      setAiProgress(100);
      message.error(`AI review failed: ${err.message}`);
    } finally {
      setAiReviewing(false);
      setStep(3);
    }
  };

  const handleSaveAllValidated = async () => {
    if (!analysisResult || analysisResult.validItemsToSave.length === 0) {
      message.warning('No valid problem statements to save.');
      return;
    }

    setSaving(true);
    try {
      const res = await saveAnalyzedProblemsToFirestore(
        analysisResult.validItemsToSave,
        uploadedFile?.name || 'questions.csv',
        { uid: user?.uid, email: user?.email }
      );

      setSavedCount(res.savedCount);
      setStep(4);
      message.success(`✓ Saved ${res.savedCount} Problems as Draft & auto-assigned to existing teams!`);
      onImportComplete();
    } catch (err: any) {
      message.error(err.message || 'Failed to save problems to database.');
    } finally {
      setSaving(false);
    }
  };

  const getFilteredQuestions = (): AnalyzedQuestionItem[] => {
    if (!analysisResult) return [];
    if (activeTab === 'valid') {
      return analysisResult.questions.filter((q) => q.status === 'VALID');
    }
    if (activeTab === 'issues') {
      return analysisResult.questions.filter((q) => q.status !== 'VALID');
    }
    return analysisResult.questions;
  };

  const getScoreTag = (score?: number) => {
    if (score === undefined || score === null) return <Tag>—</Tag>;
    if (score >= 8) {
      return (
        <Tag color="success" icon={<ThunderboltOutlined />} style={{ fontWeight: 700 }}>
          {score}/10 High
        </Tag>
      );
    }
    if (score >= 5) {
      return (
        <Tag color="processing" style={{ fontWeight: 600 }}>
          {score}/10 Good
        </Tag>
      );
    }
    return (
      <Tag color="warning" icon={<WarningOutlined />} style={{ fontWeight: 600 }}>
        {score}/10 Low
      </Tag>
    );
  };

  const getConfidenceTag = (conf?: number) => {
    if (conf === undefined || conf === null) return <Tag>—</Tag>;
    const pct = Math.round(conf * 100);
    const color = pct >= 85 ? 'green' : pct >= 60 ? 'blue' : 'orange';
    return (
      <Tag color={color} style={{ fontWeight: 600, fontSize: '11px' }}>
        {pct}% Confidence
      </Tag>
    );
  };

  const columns = [
    {
      title: 'Order & ID',
      dataIndex: 'sequence',
      key: 'orderAndId',
      width: 140,
      render: (_: any, record: AnalyzedQuestionItem) => (
        <Space orientation="vertical" size={2}>
          <Tag color="purple" style={{ fontWeight: 700, fontSize: '12px' }}>
            Problem {record.order || record.sequence}
          </Tag>
          <Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px' }}>
            {record.statementId}
          </Tag>
          <Text type="secondary" style={{ fontSize: '10px' }}>
            Row {record.rowNumber}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Problem Statement & Description',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, record: AnalyzedQuestionItem) => (
        <div>
          <Text strong style={{ color: record.status === 'VALID' ? '#0f172a' : '#64748b', fontSize: '13px' }}>
            {text}
          </Text>
          {record.description && (
            <Paragraph
              ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}
              type="secondary"
              style={{ fontSize: '12px', marginTop: 4, marginBottom: 0, color: '#475569' }}
            >
              {record.description}
            </Paragraph>
          )}
          {record.analysis && (
            <div style={{ marginTop: 6, padding: '4px 8px', background: '#f8fafc', borderRadius: 4, borderLeft: '3px solid #7c3aed' }}>
              <Text type="secondary" style={{ fontSize: '11px', color: '#6b21a8' }}>
                <RobotOutlined style={{ marginRight: 4 }} />
                <strong>AI Analysis:</strong> {record.analysis}
              </Text>
            </div>
          )}
          {record.aiIssues && record.aiIssues.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {record.aiIssues.map((issue, i) => (
                <Tag key={i} color="orange" style={{ fontSize: '11px', marginRight: 4, marginBottom: 2 }}>
                  ⚠ {issue}
                </Tag>
              ))}
            </div>
          )}
          {record.aiSuggestions && record.aiSuggestions.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <Tooltip title={record.aiSuggestions.join(' | ')}>
                <Tag color="cyan" icon={<BulbOutlined />} style={{ fontSize: '11px', cursor: 'pointer' }}>
                  {record.aiSuggestions.length} AI Suggestion{record.aiSuggestions.length > 1 ? 's' : ''}
                </Tag>
              </Tooltip>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Org / Dept / Team',
      key: 'orgDeptTeam',
      width: 160,
      render: (_: any, record: AnalyzedQuestionItem) => (
        <Space orientation="vertical" size={3}>
          {record.organization && (
            <Tag icon={<BankOutlined />} color="blue" style={{ fontSize: '11px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {record.organization}
            </Tag>
          )}
          {record.department && (
            <Tag icon={<ApartmentOutlined />} color="purple" style={{ fontSize: '11px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {record.department}
            </Tag>
          )}
          {record.team && (
            <Tag icon={<TeamOutlined />} color="cyan" style={{ fontSize: '11px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {record.team}
            </Tag>
          )}
          {!record.organization && !record.department && !record.team && (
            <Text type="secondary" style={{ fontSize: '11px' }}>—</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Category & Difficulty',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (cat: string, record: AnalyzedQuestionItem) => (
        <Space orientation="vertical" size={3}>
          <Tag color="geekblue" style={{ fontSize: '12px' }}>
            {cat || record.aiDetectedCategory || 'General'}
          </Tag>
          {record.difficulty && (
            <Tag color={record.difficulty === 'HARD' ? 'red' : record.difficulty === 'EASY' ? 'green' : 'gold'} style={{ fontSize: '10px' }}>
              {record.difficulty}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'AI Assessment',
      dataIndex: 'confidence',
      key: 'aiAssessment',
      width: 130,
      render: (_: any, record: AnalyzedQuestionItem) => (
        <Space orientation="vertical" size={3}>
          {getConfidenceTag(record.confidence)}
          {getScoreTag(record.aiQualityScore)}
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (st: string) => {
        if (st === 'VALID') {
          return (
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontWeight: 600 }}>
              VALID
            </Tag>
          );
        }
        if (st === 'DUPLICATE') {
          return (
            <Tag color="orange" icon={<WarningOutlined />} style={{ fontWeight: 600 }}>
              DUPLICATE
            </Tag>
          );
        }
        if (st === 'EMPTY') {
          return (
            <Tag color="red" icon={<CloseCircleOutlined />} style={{ fontWeight: 600 }}>
              EMPTY
            </Tag>
          );
        }
        return (
          <Tag color="red" icon={<CloseCircleOutlined />} style={{ fontWeight: 600 }}>
            INVALID
          </Tag>
        );
      },
    },
    {
      title: 'Notes',
      dataIndex: 'validationNotes',
      key: 'validationNotes',
      width: 180,
      render: (note: string, record: AnalyzedQuestionItem) => (
        <Text
          type={record.status === 'VALID' ? 'secondary' : 'danger'}
          style={{ fontSize: '11px' }}
        >
          {note}
        </Text>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <FileSearchOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontWeight: 700, fontSize: '17px' }}>
            CSV Problem Statement Analyzer & AI Reviewer
          </span>
        </Space>
      }
      open={open}
      onCancel={() => {
        if (!saving && !aiReviewing) {
          resetState();
          onClose();
        }
      }}
      width={1120}
      footer={null}
      destroyOnClose
      centered
    >
      <div style={{ padding: '8px 0' }}>
        <Steps
          current={step}
          items={[
            { title: 'Upload CSV' },
            { title: 'Parse & Validate' },
            { title: 'AI Analysis' },
            { title: 'Admin Review' },
            { title: 'Distribution' },
          ]}
          style={{ marginBottom: 24 }}
        />

        {/* STEP 0: UPLOAD CSV */}
        {step === 0 && (
          <div>
            <Alert
              message="Upload Problem Statements CSV"
              description="Upload your CSV file containing problem statements (columns: Problem Statement ID, Category, Team, Organization, Department, Description). The Analyzer reads all rows, extracts metadata, executes OpenRouter Claude AI analysis, and presents the structured results for review."
              type="info"
              showIcon
              style={{ marginBottom: 20, borderRadius: 8 }}
            />

            <Dragger
              accept=".csv,text/csv"
              beforeUpload={handleFileSelect}
              showUploadList={false}
              style={{
                padding: 28,
                borderRadius: 12,
                background: '#f8fafc',
                borderColor: '#93c5fd',
              }}
            >
              <p className="ant-upload-drag-icon">
                <CloudUploadOutlined style={{ color: '#1677ff', fontSize: 52 }} />
              </p>
              <p className="ant-upload-text" style={{ fontWeight: 600, fontSize: '16px', color: '#0f172a' }}>
                Click or drag CSV file to this area
              </p>
              <p className="ant-upload-hint" style={{ color: '#64748b' }}>
                Supports columns: Problem Statement ID, Category, Team, Organization, Department, Description
              </p>
            </Dragger>

            {uploadedFile && (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: '#f1f5f9',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                }}
              >
                <Row justify="space-between" align="middle">
                  <Col>
                    <Text strong>Selected File: </Text>
                    <Tag color="blue" style={{ fontSize: '13px', padding: '2px 8px' }}>
                      {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)
                    </Tag>
                  </Col>
                  <Col>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ~{rawText ? rawText.split('\n').length : 0} rows detected
                    </Text>
                  </Col>
                </Row>

                {duplicateWarning && (
                  <Alert
                    message={duplicateWarning}
                    type="warning"
                    showIcon
                    style={{ marginTop: 12, borderRadius: 6 }}
                  />
                )}
              </div>
            )}

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                size="large"
                icon={<RobotOutlined />}
                onClick={handleAnalyzeCsv}
                disabled={!uploadedFile}
                style={{ fontWeight: 600 }}
              >
                Analyze CSV with AI
              </Button>
            </div>
          </div>
        )}

        {/* STEP 1: LOCAL PARSE */}
        {step === 1 && (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            {!analysisError ? (
              <div>
                <FileSearchOutlined style={{ fontSize: 56, color: '#1677ff', marginBottom: 16 }} />
                <Title level={4} style={{ color: '#0f172a', marginBottom: 8 }}>
                  Parsing CSV & Validating Columns...
                </Title>
                <Paragraph type="secondary" style={{ maxWidth: 450, margin: '0 auto 24px' }}>
                  Extracting IDs, categories, organizations, departments, and scanning for duplicates.
                </Paragraph>
                <Progress percent={progressPercent} status="active" strokeColor="#1677ff" style={{ maxWidth: 400 }} />
              </div>
            ) : (
              <div>
                <Alert
                  message="Parsing Failed"
                  description={analysisError}
                  type="error"
                  showIcon
                  style={{ marginBottom: 24, textAlign: 'left', borderRadius: 8 }}
                />
                <Space>
                  <Button onClick={() => setStep(0)}>Back to Upload</Button>
                  <Button type="primary" onClick={handleAnalyzeCsv}>
                    Retry
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: AI REVIEW */}
        {step === 2 && (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            <RobotOutlined style={{ fontSize: 56, color: '#7c3aed', marginBottom: 16 }} />
            <Title level={4} style={{ color: '#0f172a', marginBottom: 8 }}>
              Running Claude AI Problem Statement Analysis...
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 520, margin: '0 auto 20px', minHeight: 40 }}>
              {aiProgressText}
            </Paragraph>
            <Progress
              percent={aiProgress}
              status={aiStatus === 'Failed' ? 'exception' : 'active'}
              strokeColor="#7c3aed"
              style={{ maxWidth: 400 }}
            />
          </div>
        )}

        {/* STEP 3: ADMIN REVIEW & PREVIEW */}
        {step === 3 && analysisResult && (() => {
          const realAiCount = analysisResult.summary.aiAnalyzedCount || 0;
          const totalValid = analysisResult.summary.validQuestions || 0;
          const isPartial = realAiCount > 0 && realAiCount < totalValid;
          const isFullSuccess = realAiCount === totalValid && totalValid > 0;
          const isInsufficientCredits = analysisResult.aiAnalysisError?.includes('402') ||
            analysisResult.aiAnalysisError?.includes('OPENROUTER_INSUFFICIENT_CREDITS') ||
            analysisResult.aiErrorCode === 'OPENROUTER_INSUFFICIENT_CREDITS';

          return (
            <div>
              {/* Status Bar */}
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 16px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <Space size="middle">
                  <Text strong>AI Analysis Status:</Text>
                  {aiStatus === 'Processing' && <Tag icon={<SyncOutlined spin />} color="processing">AI ANALYSIS RUNNING</Tag>}
                  {isFullSuccess && (
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      AI ANALYSIS COMPLETED ({analysisResult.aiModelUsed || 'AI Model'})
                    </Tag>
                  )}
                  {isPartial && (
                    <Tag icon={<WarningOutlined />} color="warning">
                      AI ANALYSIS PARTIAL ({realAiCount} / {totalValid})
                    </Tag>
                  )}
                  {!isFullSuccess && !isPartial && analysisResult.aiAnalysisPerformed && (
                    <Tag icon={<CloseCircleOutlined />} color="error">
                      AI ANALYSIS FAILED
                    </Tag>
                  )}
                  {!analysisResult.aiAnalysisPerformed && <Tag color="default">AI ANALYSIS READY</Tag>}
                </Space>

                <Space>
                  <Tag color="blue" style={{ fontSize: '12px' }}>
                    Total Problems: <strong>{totalValid}</strong>
                  </Tag>
                </Space>
              </div>

              {/* Statistics */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} sm={6}>
                  <Card size="small" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', borderRadius: 8 }}>
                    <Statistic
                      title="Valid Problems"
                      value={totalValid}
                      valueStyle={{ color: '#16a34a', fontWeight: 700 }}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card size="small" style={{ background: '#faf5ff', borderColor: '#e9d5ff', borderRadius: 8 }}>
                    <Statistic
                      title="AI Analyzed"
                      value={`${realAiCount} / ${totalValid}`}
                      valueStyle={{ color: realAiCount > 0 ? '#7c3aed' : '#94a3b8', fontWeight: 700 }}
                      prefix={<RobotOutlined />}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card size="small" style={{ background: '#eff6ff', borderColor: '#bfdbfe', borderRadius: 8 }}>
                    <Statistic
                      title="Local Validation"
                      value={totalValid - realAiCount}
                      valueStyle={{ color: totalValid - realAiCount > 0 ? '#2563eb' : '#94a3b8', fontWeight: 700 }}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card size="small" style={{ background: '#fffbeb', borderColor: '#fde68a', borderRadius: 8 }}>
                    <Statistic
                      title="Issues / Duplicates"
                      value={analysisResult.summary.invalidRows}
                      valueStyle={{ color: '#d97706', fontWeight: 700 }}
                    />
                  </Card>
                </Col>
              </Row>

              {isFullSuccess && (
                <Alert
                  message={
                    <Space>
                      <RobotOutlined style={{ color: '#7c3aed' }} />
                      <span style={{ fontWeight: 700 }}>AI Problem Analysis Completed:</span>
                      <span>
                        All {realAiCount} problem statements analyzed and ordered with {analysisResult.aiModelUsed || 'AI'}. Ready to save as DRAFT.
                      </span>
                    </Space>
                  }
                  type="success"
                  showIcon={false}
                  style={{ marginBottom: 16, borderRadius: 8, background: '#f5f3ff', border: '1px solid #ddd6fe' }}
                />
              )}

              {isPartial && (
                <Alert
                  message={`AI Analysis Partial (${realAiCount} / ${totalValid} Analyzed)`}
                  description={`Successfully analyzed ${realAiCount} problem statements with Claude AI. Remaining ${totalValid - realAiCount} statements were validated locally due to credit limits. You can add credits and retry.`}
                  type="warning"
                  showIcon
                  action={
                    <Button size="small" icon={<ReloadOutlined />} onClick={handleRetryAi}>
                      Retry AI
                    </Button>
                  }
                  style={{ marginBottom: 16, borderRadius: 8 }}
                />
              )}

              {analysisResult.aiAnalysisPerformed && !isFullSuccess && !isPartial && (
                <Alert
                  message={isInsufficientCredits ? 'OpenRouter AI Analysis Unavailable — Insufficient Credits' : 'AI Analysis Unavailable — Local Validation Used'}
                  description={
                    isInsufficientCredits
                      ? `OpenRouter AI analysis is unavailable because the configured OpenRouter account has insufficient credits. Deterministic local validation was applied and preserved all ${totalValid} problem statements with zero data loss. Please add credits at https://openrouter.ai/settings/credits and click "Retry AI".`
                      : `OpenRouter AI service error (${analysisResult.aiAnalysisError || 'Service unavailable'}). Deterministic local validation was applied and preserved all ${totalValid} problem statements with zero data loss.`
                  }
                  type="warning"
                  showIcon
                  action={
                    <Button size="small" icon={<ReloadOutlined />} onClick={handleRetryAi}>
                      Retry AI
                    </Button>
                  }
                  style={{ marginBottom: 16, borderRadius: 8 }}
                />
              )}

            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                { key: 'all', label: `All Problem Statements (${analysisResult.questions.length})` },
                {
                  key: 'valid',
                  label: (
                    <Badge count={analysisResult.summary.validQuestions} offset={[10, 0]} color="#16a34a">
                      <span>Valid Only</span>
                    </Badge>
                  ),
                },
                {
                  key: 'issues',
                  label: (
                    <Badge count={analysisResult.summary.invalidRows} offset={[10, 0]} color="#dc2626">
                      <span>Issues ({analysisResult.summary.invalidRows})</span>
                    </Badge>
                  ),
                },
              ]}
              style={{ marginBottom: 12 }}
            />

            <Table
              dataSource={getFilteredQuestions()}
              columns={columns}
              rowKey="sequence"
              pagination={{ pageSize: 5, size: 'small', showSizeChanger: true, pageSizeOptions: ['5', '10', '25', '50'] }}
              size="small"
              bordered
              style={{ borderRadius: 8, overflow: 'hidden' }}
            />

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button onClick={() => setStep(0)}>Back to Upload</Button>

              <Space>
                <Button onClick={onClose}>Cancel</Button>
                {(!analysisResult.aiAnalysisPerformed || !analysisResult.aiAnalysisSuccess) && (
                  <Button icon={<RobotOutlined />} onClick={handleRetryAi} loading={aiReviewing}>
                    Run AI Review
                  </Button>
                )}
                <Button
                  type="primary"
                  size="large"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={analysisResult.validItemsToSave.length === 0}
                  onClick={handleSaveAllValidated}
                  style={{ fontWeight: 700 }}
                >
                  Save All {analysisResult.validItemsToSave.length} Valid Problems (DRAFT)
                </Button>
              </Space>
            </div>
          </div>
          );
        })()}

        {/* STEP 4: READY FOR DISTRIBUTION */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <CheckCircleOutlined style={{ fontSize: 64, color: '#16a34a', marginBottom: 16 }} />
            <Title level={3} style={{ color: '#0f172a', marginBottom: 8 }}>
              🎉 {savedCount} Problem Statements Saved Successfully!
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 540, margin: '0 auto 24px', fontSize: '14px' }}>
              All validated problem statements have been saved as <Tag color="orange">DRAFT</Tag> in Firestore with complete
              metadata (ID, Category, Team, Organization, Department, AI Analysis). They are ready for sequential distribution.
            </Paragraph>

            <Space size="middle">
              <Button
                onClick={() => {
                  resetState();
                  onClose();
                }}
              >
                Close
              </Button>
              {onNavigateToDistribution && (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => {
                    resetState();
                    onClose();
                    onNavigateToDistribution();
                  }}
                  style={{ fontWeight: 600 }}
                >
                  Go to Problem Distribution
                </Button>
              )}
            </Space>
          </div>
        )}
      </div>
    </Modal>
  );
};
