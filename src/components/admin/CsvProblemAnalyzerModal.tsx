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
} from 'antd';
import {
  CloudUploadOutlined,
  FileSearchOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  analyzeCsvProblemStatements,
  saveAnalyzedProblemsToFirestore,
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
    setProgressPercent(25);

    try {
      await new Promise((r) => setTimeout(r, 200));
      setProgressPercent(50);

      // Perform deep analysis, column detection, duplicate checking, and numbering
      const result = analyzeCsvProblemStatements(rawText, uploadedFile.name, existingProblems);

      setProgressPercent(85);
      await new Promise((r) => setTimeout(r, 250));
      setProgressPercent(100);

      setAnalysisResult(result);
      setAnalyzing(false);
      setStep(2);

      if (result.validItemsToSave.length > 0) {
        message.success(`Analysis completed: ${result.validItemsToSave.length} valid questions found.`);
      } else {
        message.warning('Analysis completed, but 0 valid questions were found. Please inspect the issues.');
      }
    } catch (err: any) {
      console.error('[CsvAnalyzer] Analysis error:', err);
      setAnalyzing(false);
      setAnalysisError(err.message || 'CSV analysis failed. Please verify file format and columns.');
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
      setStep(3);
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

  const columns = [
    {
      title: 'No.',
      dataIndex: 'questionNumber',
      key: 'questionNumber',
      width: 110,
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
      title: 'Original Question / Problem Statement',
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
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 130,
      render: (cat: string) => (
        <Tag color="geekblue" style={{ fontSize: '12px' }}>
          {cat || 'General'}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
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
      width: 220,
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
            CSV Problem Statement Analyzer & Importer
          </span>
        </Space>
      }
      open={open}
      onCancel={() => {
        if (!saving) {
          resetState();
          onClose();
        }
      }}
      width={980}
      footer={null}
      destroyOnClose
      centered
    >
      <div style={{ padding: '8px 0' }}>
        <Steps
          current={step}
          items={[
            { title: 'Upload CSV' },
            { title: 'Analyze' },
            { title: 'Validate & Preview' },
            { title: 'Distribution Ready' },
          ]}
          style={{ marginBottom: 24 }}
        />

        {/* STEP 0: UPLOAD CSV */}
        {step === 0 && (
          <div>
            <Alert
              message="Upload Problem Statements CSV"
              description="Upload your CSV file containing questions/problem statements. The Analyzer will detect question columns, assign sequential numbering (Question 1..N), validate duplicates and empty rows, and present a full preview before saving."
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
                icon={<FileSearchOutlined />}
                onClick={handleAnalyzeCsv}
                disabled={!uploadedFile}
                style={{ fontWeight: 600 }}
              >
                Analyze CSV
              </Button>
            </div>
          </div>
        )}

        {/* STEP 1: ANALYZING */}
        {step === 1 && (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            {!analysisError ? (
              <div>
                <FileSearchOutlined style={{ fontSize: 56, color: '#1677ff', marginBottom: 16 }} />
                <Title level={4} style={{ color: '#0f172a', marginBottom: 8 }}>
                  Analyzing CSV Structure & Detecting Questions...
                </Title>
                <Paragraph type="secondary" style={{ maxWidth: 450, margin: '0 auto 24px' }}>
                  Validating column headers, assigning Question 1..N sequence, and scanning for duplicates.
                </Paragraph>
                <Progress percent={progressPercent} status="active" strokeColor="#1677ff" style={{ maxWidth: 400 }} />
              </div>
            ) : (
              <div>
                <Alert
                  message="Analysis Failed"
                  description={analysisError}
                  type="error"
                  showIcon
                  style={{ marginBottom: 24, textAlign: 'left', borderRadius: 8 }}
                />
                <Space>
                  <Button onClick={() => setStep(0)}>Back to Upload</Button>
                  <Button type="primary" onClick={handleAnalyzeCsv}>
                    Retry Analysis
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: PREVIEW & VALIDATION SUMMARY */}
        {step === 2 && analysisResult && (
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
                <Card size="small" style={{ background: '#fffbeb', borderColor: '#fde68a', borderRadius: 8 }}>
                  <Statistic
                    title="Duplicate Questions"
                    value={analysisResult.summary.duplicateQuestions}
                    valueStyle={{ color: '#d97706' }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ background: '#fef2f2', borderColor: '#fecaca', borderRadius: 8 }}>
                  <Statistic
                    title="Empty / Invalid"
                    value={analysisResult.summary.emptyQuestions + analysisResult.summary.invalidRows - analysisResult.summary.duplicateQuestions}
                    valueStyle={{ color: '#dc2626' }}
                  />
                </Card>
              </Col>
            </Row>

            <Alert
              message={
                <Space>
                  <span style={{ fontWeight: 700 }}>Analysis Completed:</span>
                  <span>
                    Detected question column <Tag color="blue">"{analysisResult.detectedQuestionColumn}"</Tag> with{' '}
                    <Text strong style={{ color: '#16a34a' }}>
                      {analysisResult.validItemsToSave.length} valid questions
                    </Text>{' '}
                    ready to save.
                  </span>
                </Space>
              }
              type={analysisResult.validItemsToSave.length > 0 ? 'success' : 'warning'}
              showIcon
              style={{ marginBottom: 16, borderRadius: 8 }}
            />

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

        {/* STEP 3: READY FOR DISTRIBUTION */}
        {step === 3 && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <CheckCircleOutlined style={{ fontSize: 64, color: '#16a34a', marginBottom: 16 }} />
            <Title level={3} style={{ color: '#0f172a', marginBottom: 8 }}>
              🎉 {savedCount} Problem Statements Saved Successfully!
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 500, margin: '0 auto 24px', fontSize: '14px' }}>
              All validated questions have been saved as <Tag color="orange">DRAFT</Tag> in Firestore with clean
              sequential identifiers. They are now available in the Problem Statements dashboard and ready for distribution.
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
