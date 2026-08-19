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
  Collapse,
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
  InfoCircleOutlined,
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

  // Workflow step: 0 = Upload, 1 = Local Parse, 2 = AI Review, 3 = Preview, 4 = Success
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
  const [aiError, setAiError] = useState<string | null>(null);

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
    setAiError(null);
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
    setProgressPercent(30);

    let localResult: CsvAnalysisResult;

    try {
      await new Promise((r) => setTimeout(r, 200));
      setProgressPercent(60);

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

    // 2. If valid questions exist, run OpenRouter AI Analysis
    if (localResult.validItemsToSave.length > 0) {
      setStep(2);
      setAiReviewing(true);
      try {
        const aiResponse = await requestCsvAiAnalysis(
          localResult.validItemsToSave,
          uploadedFile.name
        );

        if (aiResponse && aiResponse.results) {
          const enrichedQuestions = mergeAiAnalysisIntoQuestions(localResult.questions, aiResponse);
          const enrichedValid = mergeAiAnalysisIntoQuestions(localResult.validItemsToSave, aiResponse);

          setAnalysisResult({
            ...localResult,
            questions: enrichedQuestions,
            validItemsToSave: enrichedValid,
            aiAnalysisPerformed: true,
            aiAnalysisSuccess: aiResponse.aiSuccess,
            aiAnalysisError: aiResponse.aiError,
            summary: {
              ...localResult.summary,
              aiAnalyzedCount: aiResponse.totalAnalyzed,
            },
          });

          if (aiResponse.aiSuccess) {
            message.success(`AI Quality Review complete: ${aiResponse.totalAnalyzed} problems assessed.`);
          } else {
            message.warning('AI quality assessment encountered an issue, fallback data applied.');
          }
        }
      } catch (err: any) {
        console.warn('[CsvAnalyzer] AI call failed, proceeding with local analysis:', err);
        setAiError(err.message || 'AI service temporarily unavailable.');
        setAnalysisResult({
          ...localResult,
          aiAnalysisPerformed: true,
          aiAnalysisSuccess: false,
          aiAnalysisError: err.message,
        });
      } finally {
        setAiReviewing(false);
        setStep(3); // Proceed to Preview
      }
    } else {
      setStep(3); // Proceed to Preview even if 0 valid items
    }
  };

  const handleRetryAi = async () => {
    if (!analysisResult || analysisResult.validItemsToSave.length === 0) return;
    setStep(2);
    setAiReviewing(true);
    setAiError(null);

    try {
      const aiResponse = await requestCsvAiAnalysis(
        analysisResult.validItemsToSave,
        uploadedFile?.name || 'questions.csv'
      );

      if (aiResponse && aiResponse.results) {
        const enrichedQuestions = mergeAiAnalysisIntoQuestions(analysisResult.questions, aiResponse);
        const enrichedValid = mergeAiAnalysisIntoQuestions(analysisResult.validItemsToSave, aiResponse);

        setAnalysisResult({
          ...analysisResult,
          questions: enrichedQuestions,
          validItemsToSave: enrichedValid,
          aiAnalysisPerformed: true,
          aiAnalysisSuccess: aiResponse.aiSuccess,
          aiAnalysisError: aiResponse.aiError,
          summary: {
            ...analysisResult.summary,
            aiAnalyzedCount: aiResponse.totalAnalyzed,
          },
        });
        message.success('AI Quality Review updated successfully.');
      }
    } catch (err: any) {
      setAiError(err.message || 'AI review failed.');
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
      message.success(`✓ Saved ${res.savedCount} Problems as Draft! Ready for Distribution.`);
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

  const columns = [
    {
      title: 'No.',
      dataIndex: 'questionNumber',
      key: 'questionNumber',
      width: 100,
      render: (val: string, record: AnalyzedQuestionItem) => (
        <Space orientation="vertical" size={2}>
          <Tag color="blue" style={{ fontWeight: 700 }}>
            {val}
          </Tag>
          <Text type="secondary" style={{ fontSize: '11px' }}>
            Row {record.rowNumber}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Question / Problem Statement',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, record: AnalyzedQuestionItem) => (
        <div>
          <Text strong style={{ color: record.status === 'VALID' ? '#0f172a' : '#64748b' }}>
            {text}
          </Text>
          {record.description && record.description !== text && (
            <Paragraph
              ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}
              type="secondary"
              style={{ fontSize: '12px', marginTop: 4, marginBottom: 0 }}
            >
              {record.description}
            </Paragraph>
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
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 130,
      render: (cat: string, record: AnalyzedQuestionItem) => (
        <Space orientation="vertical" size={2}>
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
      title: 'AI Quality',
      dataIndex: 'aiQualityScore',
      key: 'aiQualityScore',
      width: 120,
      render: (_: any, record: AnalyzedQuestionItem) => getScoreTag(record.aiQualityScore),
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
      title: 'Analysis Notes',
      dataIndex: 'validationNotes',
      key: 'validationNotes',
      width: 200,
      render: (note: string, record: AnalyzedQuestionItem) => (
        <Text
          type={record.status === 'VALID' ? 'secondary' : 'danger'}
          style={{ fontSize: '12px' }}
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
      width={1020}
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
            { title: 'AI Review' },
            { title: 'Preview' },
            { title: 'Distribution' },
          ]}
          style={{ marginBottom: 24 }}
        />

        {/* STEP 0: UPLOAD CSV */}
        {step === 0 && (
          <div>
            <Alert
              message="Upload Problem Statements CSV"
              description="Upload your CSV file containing questions/problem statements. The Analyzer detects question columns, assigns clean sequential IDs (Question 1..N), runs OpenRouter AI quality analysis, and presents a full preview before saving."
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
                Accepts .csv with headers (e.g. question, problem_statement, title, category, description)
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
                  Detecting question headers, scanning for duplicates, and generating sequential numbering.
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
              Running AI Quality Review (OpenRouter)...
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 500, margin: '0 auto 24px' }}>
              Evaluating problem statement clarity, deliverables, categories, and potential ambiguities with OpenRouter AI.
            </Paragraph>
            <Progress percent={75} status="active" strokeColor="#7c3aed" style={{ maxWidth: 400 }} />
          </div>
        )}

        {/* STEP 3: PREVIEW & VALIDATION SUMMARY */}
        {step === 3 && analysisResult && (
          <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ background: '#f8fafc', borderRadius: 8 }}>
                  <Statistic title="Total Rows" value={analysisResult.summary.totalRows} />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', borderRadius: 8 }}>
                  <Statistic
                    title="Valid Questions"
                    value={analysisResult.summary.validQuestions}
                    valueStyle={{ color: '#16a34a', fontWeight: 700 }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ background: '#faf5ff', borderColor: '#e9d5ff', borderRadius: 8 }}>
                  <Statistic
                    title="AI Reviewed"
                    value={analysisResult.summary.aiAnalyzedCount || 0}
                    valueStyle={{ color: '#7c3aed', fontWeight: 700 }}
                    prefix={<RobotOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ background: '#fffbeb', borderColor: '#fde68a', borderRadius: 8 }}>
                  <Statistic
                    title="Issues / Duplicates"
                    value={analysisResult.summary.invalidRows}
                    valueStyle={{ color: '#d97706' }}
                  />
                </Card>
              </Col>
            </Row>

            {analysisResult.aiAnalysisSuccess && (
              <Alert
                message={
                  <Space>
                    <RobotOutlined style={{ color: '#7c3aed' }} />
                    <span style={{ fontWeight: 700 }}>AI Quality Review Complete:</span>
                    <span>
                      Detected question column <Tag color="blue">"{analysisResult.detectedQuestionColumn}"</Tag> with{' '}
                      <Text strong style={{ color: '#16a34a' }}>
                        {analysisResult.validItemsToSave.length} valid questions
                      </Text>{' '}
                      ready to save as DRAFT.
                    </span>
                  </Space>
                }
                type="success"
                showIcon={false}
                style={{ marginBottom: 16, borderRadius: 8, background: '#f5f3ff', border: '1px solid #ddd6fe' }}
              />
            )}

            {analysisResult.aiAnalysisPerformed && !analysisResult.aiAnalysisSuccess && (
              <Alert
                message="Local Validation Passed (AI Review Unavailable)"
                description={
                  analysisResult.aiAnalysisError
                    ? `Local parsing and duplicate checks succeeded. AI review error: ${analysisResult.aiAnalysisError}`
                    : 'Local parsing and duplicate checks succeeded. You can proceed with local data or retry AI review.'
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
                { key: 'all', label: `All Rows (${analysisResult.questions.length})` },
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
                  Save All {analysisResult.validItemsToSave.length} Valid Problems
                </Button>
              </Space>
            </div>
          </div>
        )}

        {/* STEP 4: READY FOR DISTRIBUTION */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <CheckCircleOutlined style={{ fontSize: 64, color: '#16a34a', marginBottom: 16 }} />
            <Title level={3} style={{ color: '#0f172a', marginBottom: 8 }}>
              🎉 {savedCount} Problem Statements Saved Successfully!
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 520, margin: '0 auto 24px', fontSize: '14px' }}>
              All validated questions have been saved as <Tag color="orange">DRAFT</Tag> in Firestore with clean
              sequential identifiers (PS001, PS002...) and AI metadata. They are now ready for sequential distribution.
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
