import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Table,
  Typography,
  Tag,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Row,
  Col,
  Statistic,
  Alert,
  message,
  Popconfirm,
  Drawer,
  Divider,
  Upload,
  Steps,
  Progress,
  Collapse,
  Tooltip,
  Radio,
  Badge,
  List,
  Tabs,
} from 'antd';
import {
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  StopOutlined,
  EyeOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
  TeamOutlined,
  BranchesOutlined,
  RobotOutlined,
  SettingOutlined,
  HistoryOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  WarningOutlined,
  UserSwitchOutlined,
  BulbOutlined,
  SendOutlined,
  UndoOutlined,
  AuditOutlined,
  SafetyCertificateOutlined,
  FileDoneOutlined,
  ProjectOutlined,
  ExclamationCircleOutlined,
  SaveOutlined,
  FileSearchOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  subscribeToProblemStatements,
  saveProblemStatement,
} from '../../services/problems.service';
import { subscribeToTeams } from '../../services/accounts.service';
import { CsvProblemAnalyzerModal } from '../../components/admin/CsvProblemAnalyzerModal';
import {
  extractTextFromFile,
  parseProblemStatementsText,
  computeContentHash,
} from '../../services/aiProblemParser.service';
import {
  subscribeToAssignmentConfig,
  saveAssignmentConfig,
  reassignProblemStatement,
  reassignTeamProblem,
  deleteProblemStatementCascade,
  subscribeToImports,
  checkPreviousImport,
  DEFAULT_ASSIGNMENT_CONFIG,
} from '../../services/problemAssignment.service';
import {
  saveAllProblemStatementsAsDraft,
  calculateDynamicAssignmentMapping,
  validateAssignmentMappingStrict,
  publishAssignmentSnapshot,
  unpublishActiveProblemVersion,
  subscribeToProblemPublications,
  subscribeToActivePublishedVersion,
  deleteAllProblemStatementsFromFirestore,
  ProblemAssignmentPreviewItem,
} from '../../services/problemWorkflow.service';
import {
  ProblemStatement,
  ParsedProblemStatement,
  ProblemAssignmentConfig,
  ProblemStatementImport,
  ProblemPublication,
  ProblemAssignmentValidationResult,
  Team,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { formatISTDateTime } from '../../utils/date';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

export const ProblemStatementsPage: React.FC = () => {
  const { user } = useAuth();
  const [statements, setStatements] = useState<ProblemStatement[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignmentConfig, setAssignmentConfig] = useState<ProblemAssignmentConfig>(DEFAULT_ASSIGNMENT_CONFIG);
  const [publicationsHistory, setPublicationsHistory] = useState<ProblemPublication[]>([]);
  const [activePubVersion, setActivePubVersion] = useState<{ activePublicationId: string | null; activeVersion: number | null } | null>(null);

  // Status & Navigation
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [activeTab, setActiveTab] = useState<'statements' | 'preview'>('statements');

  // Modals & Drawers
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [editingStatement, setEditingStatement] = useState<ProblemStatement | null>(null);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isCsvAnalyzerOpen, setIsCsvAnalyzerOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isPubHistoryDrawerOpen, setIsPubHistoryDrawerOpen] = useState(false);
  const [isViewDrawerOpen, setIsViewDrawerOpen] = useState(false);
  const [selectedForView, setSelectedForView] = useState<ProblemStatement | null>(null);
  const [isEditAssignmentModalOpen, setIsEditAssignmentModalOpen] = useState(false);
  const [editingPreviewItem, setEditingPreviewItem] = useState<ProblemAssignmentPreviewItem | null>(null);

  // Bulk Upload State
  const [bulkStep, setBulkStep] = useState<number>(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string>('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [processingPercent, setProcessingPercent] = useState<number>(0);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [parsedProblems, setParsedProblems] = useState<ParsedProblemStatement[]>([]);

  // Interactive Assignment Mapping Override State
  const [customAssignmentMapping, setCustomAssignmentMapping] = useState<ProblemAssignmentPreviewItem[] | null>(null);

  // Manual Reassignment Modal State
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<{ statement: ProblemStatement; teamId: string } | null>(null);
  const [selectedNewStatementId, setSelectedNewStatementId] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);

  const [loadingAction, setLoadingAction] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [search, setSearch] = useState('');

  const [form] = Form.useForm();
  const [configForm] = Form.useForm();
  const [editAssignmentForm] = Form.useForm();

  useEffect(() => {
    const unsubPS = subscribeToProblemStatements(setStatements);
    const unsubTeams = subscribeToTeams(setTeams);
    const unsubConfig = subscribeToAssignmentConfig(setAssignmentConfig);
    const unsubPubs = subscribeToProblemPublications(setPublicationsHistory);
    const unsubVer = subscribeToActivePublishedVersion(setActivePubVersion);

    return () => {
      unsubPS();
      unsubTeams();
      unsubConfig();
      unsubPubs();
      unsubVer();
    };
  }, []);

  const draftStatements = useMemo(() => {
    return statements.filter((p) => p.status === 'draft' || p.status === 'DRAFT' || (!p.publishedAt && p.status !== 'published' && p.status !== 'PUBLISHED' && p.status !== 'active'));
  }, [statements]);

  const publishedStatements = useMemo(() => {
    return statements.filter((p) => p.status === 'published' || p.status === 'PUBLISHED' || p.status === 'active');
  }, [statements]);

  // Dynamic Assignment Mapping (from real Firestore teams & problem statements)
  const currentAssignmentMapping = useMemo(() => {
    if (customAssignmentMapping && customAssignmentMapping.length === statements.length) {
      return customAssignmentMapping;
    }
    return calculateDynamicAssignmentMapping(statements, teams, assignmentConfig);
  }, [statements, teams, assignmentConfig, customAssignmentMapping]);

  // Strict Pre-Publish Validation
  const validationResult: ProblemAssignmentValidationResult = useMemo(() => {
    return validateAssignmentMappingStrict(statements, teams, currentAssignmentMapping);
  }, [statements, teams, currentAssignmentMapping]);

  // Handle Manual Add / Edit
  const handleOpenAddModal = () => {
    setEditingStatement(null);
    form.resetFields();
    form.setFieldsValue({
      statementId: `PS${String(statements.length + 1).padStart(3, '0')}`,
      sequence: statements.length + 1,
      order: statements.length + 1,
      status: 'DRAFT',
    });
    setIsAddEditModalOpen(true);
  };

  const handleOpenEditModal = (record: ProblemStatement) => {
    setEditingStatement(record);
    const reqString = Array.isArray(record.requirements)
      ? record.requirements.join('\n')
      : record.requirements || '';

    form.setFieldsValue({
      statementId: record.statementId,
      sequence: record.sequence || record.order || 1,
      order: record.order !== undefined && record.order !== null ? record.order : (record.sequence || 1),
      title: record.title,
      description: record.description,
      requirements: reqString,
      technicalGuidelines: record.technicalGuidelines || (record.instructions ? record.instructions.join('\n') : ''),
      constraints: record.constraints || '',
      expectedOutcome: record.expectedOutcome || '',
      evaluationNotes: record.evaluationNotes || '',
      status: record.status,
    });
    setIsAddEditModalOpen(true);
  };

  const handleSaveStatement = async (values: any) => {
    setLoadingAction(true);
    try {
      const reqArr = values.requirements
        ? values.requirements.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        : [];

      await saveProblemStatement({
        statementId: values.statementId,
        problemStatementId: values.statementId,
        title: values.title,
        description: values.description,
        requirements: reqArr,
        technicalGuidelines: values.technicalGuidelines || '',
        constraints: values.constraints || '',
        expectedOutcome: values.expectedOutcome || '',
        evaluationNotes: values.evaluationNotes || '',
        instructions: values.technicalGuidelines ? [values.technicalGuidelines] : [],
        order: Number(values.order || values.sequence),
        status: values.status || 'DRAFT',
      });

      message.success(`Problem Statement ${values.statementId} saved successfully.`);
      setIsAddEditModalOpen(false);
    } catch (err: any) {
      message.error(err.message || 'Failed to save problem statement.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Currently FREE problem statements for manual reassignment
  const freeProblemStatements = useMemo(() => {
    const assignedInTeams = new Set<string>();
    teams.forEach((t) => {
      if (t.assignedStatementId) assignedInTeams.add(t.assignedStatementId);
      if ((t as any).problemStatementId) assignedInTeams.add((t as any).problemStatementId);
      if ((t as any).assignedProblemId) assignedInTeams.add((t as any).assignedProblemId);
    });

    return statements.filter((st) => {
      const isPub = st.status === 'PUBLISHED' || st.status === 'published' || st.status === 'active';
      const isAssigned = (st.assignedTeamId && st.assignedTeamId.trim().length > 0) ||
        (Array.isArray(st.assignedTeamIds) && st.assignedTeamIds.length > 0) ||
        (st.team && st.team.trim().length > 0) ||
        assignedInTeams.has(st.statementId);
      return !isPub && !isAssigned;
    });
  }, [statements, teams]);

  const handleOpenReassign = (record: ProblemStatement, teamId: string) => {
    setReassignTarget({ statement: record, teamId });
    setSelectedNewStatementId(null);
    setIsReassignModalOpen(true);
  };

  const handleConfirmReassign = async () => {
    if (!reassignTarget || !selectedNewStatementId) {
      message.error('Please select a FREE problem statement.');
      return;
    }
    setReassigning(true);
    try {
      const teamObj = teams.find((t) => t.teamId === reassignTarget.teamId);
      const teamName = teamObj?.teamName || reassignTarget.teamId;
      const res = await reassignTeamProblem(reassignTarget.teamId, teamName, selectedNewStatementId, {
        uid: user?.uid,
        email: user?.email,
      });
      if (res.success) {
        message.success(res.message);
        setIsReassignModalOpen(false);
        setReassignTarget(null);
        setSelectedNewStatementId(null);
      } else {
        message.error(res.message);
      }
    } catch (err: any) {
      message.error(err.message || 'Reassignment failed');
    } finally {
      setReassigning(false);
    }
  };

  // Bulk Upload Flow (Google Gemini AI Extraction)
  const handleOpenBulkModal = () => {
    setBulkStep(0);
    setUploadedFile(null);
    setFileHash('');
    setDuplicateWarning(null);
    setProcessingError(null);
    setParsedProblems([]);
    setIsBulkModalOpen(true);
  };

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file);
    setProcessingError(null);
    try {
      const text = await extractTextFromFile(file);
      const hash = await computeContentHash(text);
      setFileHash(hash);

      const prev = await checkPreviousImport(hash, file.name);
      if (prev) {
        setDuplicateWarning(`Warning: "${file.name}" was previously imported on ${formatISTDateTime(prev.uploadedAt)} (${prev.totalCreated} problems).`);
      } else {
        setDuplicateWarning(null);
      }
    } catch (err: any) {
      console.warn('File pre-check notice:', err);
    }
    return false;
  };

  const handleStartAIAnalysis = async () => {
    if (!uploadedFile) {
      message.warning('Please select a problem statement document to analyze.');
      return;
    }

    setBulkStep(1);
    setProcessingError(null);

    try {
      setProcessingStage('Reading document content...');
      setProcessingPercent(20);
      const text = await extractTextFromFile(uploadedFile);

      setProcessingStage('Google Gemini AI analyzing document & structuring distinct challenges...');
      setProcessingPercent(50);
      await new Promise((r) => setTimeout(r, 600));

      setProcessingStage('Extracting titles, descriptions, requirements, guidelines & constraints...');
      setProcessingPercent(80);
      const parsed = parseProblemStatementsText(text, uploadedFile.name);

      setProcessingStage(`Detected ${parsed.length} problem statements. Validating sequence...`);
      setProcessingPercent(100);
      setParsedProblems(parsed);

      setBulkStep(2);
      message.success(`Google Gemini AI extracted ${parsed.length} structured problem statements!`);
    } catch (err: any) {
      console.error('AI Parsing Error:', err);
      setProcessingError(err.message || 'AI could not parse the document correctly. Please retry.');
    }
  };

  // CORE REQUIREMENT: Save All As Draft immediately in Firestore without publishing
  const handleSaveAllAsDraft = async () => {
    if (parsedProblems.length === 0) {
      message.warning('No problem statements to save.');
      return;
    }

    setLoadingAction(true);
    try {
      const res = await saveAllProblemStatementsAsDraft(
        parsedProblems,
        uploadedFile?.name || 'problem_statements.pdf',
        { uid: user?.uid, email: user?.email }
      );

      message.success(`✓ ${res.savedCount} Problem Statements saved & auto-assigned to existing teams!`);
      setIsBulkModalOpen(false);
      setActiveTab('preview'); // Switch to preview tab to show generated preview mapping
    } catch (err: any) {
      message.error(err.message || 'Failed to save drafts to Firestore.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Re-generate Preview
  const handleRegeneratePreview = () => {
    setCustomAssignmentMapping(null);
    message.info('Assignment preview refreshed.');
  };

  // Auto-Assign All Teams Action
  const handleAutoAssignAllTeams = async () => {
    setLoadingAction(true);
    try {
      const { assignExistingTeamsAfterImport } = await import('../../services/problemAssignment.service');
      const res = await assignExistingTeamsAfterImport({ uid: user?.uid, email: user?.email });
      message.success(`Auto-assignment complete: ${res.assigned} assigned, ${res.alreadyAssigned} preserved.`);
      handleRegeneratePreview();
    } catch (err: any) {
      message.error(`Auto-assignment failed: ${err.message}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const activeTeamsCount = teams.filter((t) => t.status !== 'disabled').length;
  const assignedTeamsCount = validationResult.assignedTeamsCount;
  const unassignedTeamsCount = validationResult.unassignedTeamIds.length;
  const unassignedProblemsCount = Math.max(0, statements.length - assignedTeamsCount);

  // Open Edit Assignment Modal
  const handleOpenEditAssignment = (pItem: ProblemAssignmentPreviewItem) => {
    setEditingPreviewItem(pItem);
    editAssignmentForm.setFieldsValue({
      assignedTeamIds: pItem.assignedTeamIds,
    });
    setIsEditAssignmentModalOpen(true);
  };

  // Save Custom Assignment Override
  const handleSaveCustomAssignment = (values: any) => {
    if (!editingPreviewItem) return;

    const teamMap = new Map<string, Team>();
    teams.forEach((t) => teamMap.set(t.teamId.toUpperCase(), t));

    const updated = currentAssignmentMapping.map((item) => {
      if (item.statementId === editingPreviewItem.statementId) {
        const teamIds: string[] = values.assignedTeamIds || [];
        return {
          ...item,
          assignedTeamIds: teamIds,
          assignedTeams: teamIds.map((tid) => {
            const tObj = teamMap.get(tid.toUpperCase());
            return {
              teamId: tid,
              teamName: tObj?.teamName || tid,
              leaderName: tObj?.leaderName || '',
              status: tObj?.status,
            };
          }),
        };
      }
      return item;
    });

    setCustomAssignmentMapping(updated);
    message.success(`Updated assignment mapping for ${editingPreviewItem.statementId}`);
    setIsEditAssignmentModalOpen(false);
  };

  // Versioned Publish Action with Confirmation
  const handleConfirmPublishWorkflow = () => {
    if (!validationResult.isValid) {
      Modal.error({
        title: 'Publish Blocked by Validation Errors',
        content: (
          <div>
            <Paragraph>Please resolve the following issues before publishing:</Paragraph>
            <ul style={{ paddingLeft: 18, color: '#dc2626' }}>
              {validationResult.issues.map((iss, i) => (
                <li key={i}>{iss}</li>
              ))}
            </ul>
          </div>
        ),
      });
      return;
    }

    const nextVerNum = (activePubVersion?.activeVersion || 0) + 1;
    const nextPubId = `PUB_${String(nextVerNum).padStart(3, '0')}`;

    Modal.confirm({
      title: 'Publish Problem Statement Assignments?',
      icon: <SendOutlined style={{ color: '#059669' }} />,
      content: (
        <div>
          <Paragraph>
            <Text strong>{statements.length} Problem Statements</Text> • <Text strong>{validationResult.assignedTeamsCount} Teams</Text>
          </Paragraph>
          <Paragraph>
            After publishing, these assignments will become <Text strong style={{ color: '#059669' }}>LIVE</Text> and visible to the assigned teams.
          </Paragraph>
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginTop: 8 }}>
            <div>✓ Publication ID: <Text strong>{nextPubId}</Text></div>
            <div>✓ Version: <Text strong>Version {nextVerNum}</Text></div>
            <div>✓ Published By: <Text strong>{user?.email || 'admin'}</Text></div>
          </div>
        </div>
      ),
      okText: 'Confirm Publish',
      okType: 'primary',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const pub = await publishAssignmentSnapshot(
            statements,
            teams,
            currentAssignmentMapping,
            { uid: user?.uid, email: user?.email }
          );
          message.success(`Published Problem Statements successfully! Active Version: ${pub.publicationId} (v${pub.version})`);
        } catch (err: any) {
          message.error(err.message || 'Failed to publish problem statements.');
        }
      },
    });
  };

  // Unpublish Confirmation
  const handleUnpublishWorkflow = () => {
    Modal.confirm({
      title: 'Unpublish Active Problem Statements Version?',
      icon: <UndoOutlined style={{ color: '#fa8c16' }} />,
      content: 'This will revert all problem statements and team assignments to DRAFT status. Teams will see "Problem Statement will be available soon." Continue?',
      okText: 'Confirm Unpublish',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await unpublishActiveProblemVersion(statements, { uid: user?.uid, email: user?.email });
          message.info('Problem statements reverted to Draft state.');
        } catch (err: any) {
          message.error(err.message || 'Failed to unpublish problem statements.');
        }
      },
    });
  };

  // Cascade Delete Single
  const handleDeleteCascade = async (record: ProblemStatement) => {
    try {
      await deleteProblemStatementCascade(record, { uid: user?.uid, email: user?.email });
      message.success(`Problem ${record.statementId} was deleted.`);
    } catch (err: any) {
      message.error(err.message || 'Failed to delete problem statement.');
    }
  };

  // Delete All Problem Statements
  const handleConfirmDeleteAll = () => {
    if (statements.length === 0) {
      message.info('No problem statements available.');
      return;
    }

    Modal.confirm({
      title: 'Delete all problem statements?',
      icon: <ExclamationCircleOutlined style={{ color: '#dc2626' }} />,
      content: 'This action will permanently remove all problem statements and their related data. This cannot be undone.',
      okText: 'Delete All',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        setDeletingAll(true);
        const hideLoading = message.loading('Deleting all problem statements...', 0);
        try {
          await deleteAllProblemStatementsFromFirestore({
            uid: user?.uid,
            email: user?.email,
          });
          hideLoading();
          message.success('All problem statements deleted successfully.');
        } catch (err: any) {
          hideLoading();
          console.error('Delete All failed:', err);
          message.error('Unable to delete all problem statements. Please try again.');
        } finally {
          setDeletingAll(false);
        }
      },
    });
  };

  // Filtered Table Data
  const filteredData = statements.filter((p) => {
    const s = search.toLowerCase();
    const matchSearch =
      (p.statementId || '').toLowerCase().includes(s) ||
      (p.title || '').toLowerCase().includes(s) ||
      (p.assignedTeamId || '').toLowerCase().includes(s) ||
      (p.assignedTeamName || '').toLowerCase().includes(s);

    const isPub = p.status === 'PUBLISHED' || p.status === 'published' || p.status === 'active';
    const isDraft = !isPub;

    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'draft' && isDraft) ||
      (statusFilter === 'published' && isPub);

    return matchSearch && matchStatus;
  });

  const columns = [
    {
      title: 'Order',
      dataIndex: 'order',
      key: 'order',
      width: 85,
      render: (order: number, record: ProblemStatement) => (
        <Tag color="blue" style={{ fontWeight: 800, fontSize: '13px' }}>
          #{record.order !== undefined && record.order !== null ? record.order : (record.sequence || 1)}
        </Tag>
      ),
      sorter: (a: ProblemStatement, b: ProblemStatement) => {
        const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence || 0);
        const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence || 0);
        return ordA - ordB;
      },
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: 'Problem Code & Title',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: ProblemStatement) => {
        const reqCount = Array.isArray(record.requirements)
          ? record.requirements.length
          : record.requirements
            ? 1
            : 0;

        return (
          <div>
            <Text strong style={{ fontSize: '14px', color: '#1e293b' }}>
              {title}
            </Text>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: 2 }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1d39c4' }}>{record.statementId}</span>
              {reqCount > 0 && <span> • <Tag color="cyan" style={{ fontSize: '11px' }}>{reqCount} Requirements</Tag></span>}
              {record.technicalGuidelines && <span> • <Tag color="blue" style={{ fontSize: '11px' }}>Guidelines</Tag></span>}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Assigned Team',
      key: 'assignedTeam',
      render: (_: any, record: ProblemStatement) => {
        const isPub = record.status === 'PUBLISHED' || record.status === 'published' || record.status === 'active';
        const assignedSet = new Set<string>();

        if (record.assignedTeamId && record.assignedTeamId.trim().length > 0) {
          assignedSet.add(record.assignedTeamId.trim());
        }
        if (Array.isArray(record.assignedTeamIds)) {
          record.assignedTeamIds.forEach((tid) => {
            if (tid && tid.trim()) assignedSet.add(tid.trim());
          });
        }
        if (record.team && record.team.trim().length > 0) {
          assignedSet.add(record.team.trim());
        }

        teams.forEach((t) => {
          if (
            (t.assignedStatementId === record.statementId ||
             (t as any).problemStatementId === record.statementId ||
             (t as any).assignedProblemId === record.statementId) &&
            t.teamId
          ) {
            assignedSet.add(t.teamId);
          }
        });

        const assignedIds = Array.from(assignedSet);

        if (assignedIds.length > 0) {
          return (
            <Space wrap size={4}>
              {assignedIds.map((tid: string) => (
                <Tag key={tid} color={isPub ? 'blue' : 'purple'} style={{ fontWeight: 700, fontSize: '11px' }}>
                  {isPub ? `PUBLISHED — ${tid}` : `ASSIGNED — ${tid}`}
                </Tag>
              ))}
            </Space>
          );
        }
        return <Tag color="green" style={{ fontWeight: 700 }}>FREE</Tag>;
      },
    },
    {
      title: 'Workflow Status',
      key: 'status',
      width: 140,
      render: (_: any, record: ProblemStatement) => {
        const isPub = record.status === 'PUBLISHED' || record.status === 'published' || record.status === 'active';
        if (isPub) {
          return (
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontWeight: 700 }}>
              PUBLISHED
            </Tag>
          );
        }
        return (
          <Tag color="orange" icon={<StopOutlined />} style={{ fontWeight: 700 }}>
            DRAFT
          </Tag>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 170,
      render: (_: any, record: ProblemStatement) => {
        const pItem = currentAssignmentMapping.find((m) => m.statementId === record.statementId);
        const assignedIds = pItem && pItem.assignedTeamIds.length > 0
          ? pItem.assignedTeamIds
          : (record.assignedTeamId ? [record.assignedTeamId] : (Array.isArray(record.assignedTeamIds) ? record.assignedTeamIds : []));

        return (
          <Space size="small">
            <Tooltip title="View Full Specifications">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => {
                  setSelectedForView(record);
                  setIsViewDrawerOpen(true);
                }}
              />
            </Tooltip>

            <Tooltip title="Edit Specifications">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleOpenEditModal(record)}
              />
            </Tooltip>

            {assignedIds.length > 0 && (
              <Tooltip title="Change / Reassign Team Problem">
                <Button
                  size="small"
                  icon={<SwapOutlined />}
                  style={{ color: '#722ed1', borderColor: '#d3adf7' }}
                  onClick={() => handleOpenReassign(record, assignedIds[0])}
                />
              </Tooltip>
            )}

            <Popconfirm
              title="Delete this problem statement?"
              description="Deleting will remove this problem statement permanently."
              onConfirm={() => handleDeleteCascade(record)}
              okText="Delete"
              okType="danger"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
            Problem Statements & Assignment Engine
          </Title>
          <Text type="secondary">
            Draft creation • Auto preview • Dynamic team assignment • Pre-publish validation • Versioned publish
          </Text>
        </div>

        <Space wrap>
          <Button
            type="primary"
            icon={<FileSearchOutlined />}
            onClick={() => setIsCsvAnalyzerOpen(true)}
            style={{ borderRadius: 8, background: '#1677ff', borderColor: '#1677ff', fontWeight: 600 }}
          >
            Analyze & Import CSV
          </Button>

          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={handleOpenBulkModal}
            style={{ borderRadius: 8, background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
          >
            Import File with AI
          </Button>

          <Button
            icon={<PlusOutlined />}
            onClick={handleOpenAddModal}
            style={{ borderRadius: 8 }}
          >
            + Add Problem Statement
          </Button>

          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleConfirmPublishWorkflow}
            style={{ borderRadius: 8, background: '#059669', borderColor: '#059669', fontWeight: 700 }}
          >
            PUBLISH ASSIGNMENT
          </Button>

          {activePubVersion?.activePublicationId && (
            <Button
              danger
              icon={<UndoOutlined />}
              onClick={handleUnpublishWorkflow}
              style={{ borderRadius: 8 }}
            >
              Unpublish Version
            </Button>
          )}

          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleConfirmDeleteAll}
            disabled={statements.length === 0 || deletingAll}
            loading={deletingAll}
            style={{ borderRadius: 8, fontWeight: 600 }}
          >
            Delete All Problem Statements
          </Button>

          <Button
            icon={<HistoryOutlined />}
            onClick={() => setIsPubHistoryDrawerOpen(true)}
            style={{ borderRadius: 8 }}
          >
            Publication History
          </Button>
        </Space>
      </div>

      {/* Active Published Version Status Banner */}
      {activePubVersion?.activePublicationId ? (
        <Alert
          message={
            <Space>
              <CheckCircleOutlined style={{ color: '#059669', fontSize: '16px' }} />
              <span style={{ fontWeight: 700, color: '#065f46' }}>
                Active Live Version: {activePubVersion.activePublicationId} (Version {activePubVersion.activeVersion})
              </span>
            </Space>
          }
          description="Problem statement assignments are currently LIVE for assigned teams. Any draft edits will only apply when you publish the next version."
          type="success"
          showIcon={false}
          style={{ marginBottom: 20, borderRadius: 10, border: '1px solid #a7f3d0', background: '#ecfdf5' }}
        />
      ) : (
        <Alert
          message="Problem Statements in DRAFT — Not Yet Published"
          description="Draft problem statements are saved in Firestore but completely hidden from users. Users see 'Problem Statement not published yet.' Click 'PUBLISH ASSIGNMENT' when ready."
          type="warning"
          showIcon
          style={{ marginBottom: 20, borderRadius: 10 }}
        />
      )}

      {/* KPI & Validation Cards */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Total Problem Statements</span>}
              value={statements.length}
              prefix={<ProjectOutlined style={{ color: '#1677ff', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 10, fontSize: '12px', color: '#64748b' }}>
              <Tag color="green">{publishedStatements.length} Live</Tag> • <Tag color="orange">{draftStatements.length} Drafts</Tag>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<span style={{ fontSize: '13px', color: '#64748b' }}>Active Teams Detected</span>}
              value={teams.filter((t) => t.status !== 'disabled').length}
              suffix={<span style={{ fontSize: '14px', color: '#94a3b8' }}>Teams</span>}
              prefix={<TeamOutlined style={{ color: '#52c41a', marginRight: 8 }} />}
            />
            <div style={{ marginTop: 10, fontSize: '12px', color: '#64748b' }}>
              Distribution: {statements.length > 0 ? `${(teams.filter((t) => t.status !== 'disabled').length / statements.length).toFixed(1)} teams/problem` : 'No problems'}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Pre-Publish Validation</span>
              <Tag color={validationResult.isValid ? 'green' : 'red'}>
                {validationResult.isValid ? 'READY TO PUBLISH' : 'ACTION REQUIRED'}
              </Tag>
            </div>
            {validationResult.isValid ? (
              <div style={{ color: '#059669', fontSize: '12px', marginTop: 8 }}>
                ✓ All active teams have problem statements assigned.<br />
                ✓ {validationResult.totalStatements} Problem Statements valid<br />
                ✓ {validationResult.assignedTeamsCount} Teams assigned (100%)
              </div>
            ) : (
              <div style={{ color: '#dc2626', fontSize: '12px', marginTop: 8 }}>
                ⚠️ {validationResult.issues[0]}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Main Tabbed Container */}
      <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as any)}
          items={[
            {
              key: 'statements',
              label: (
                <span>
                  <ProjectOutlined /> Problem Statements ({statements.length})
                </span>
              ),
              children: (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 16,
                      marginBottom: 20,
                    }}
                  >
                    <Space wrap>
                      <Input.Search
                        placeholder="Search by Code, Title, or Team..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: 280 }}
                        allowClear
                      />

                      <Radio.Group
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        buttonStyle="solid"
                      >
                        <Radio.Button value="all">All ({statements.length})</Radio.Button>
                        <Radio.Button value="draft">Drafts ({draftStatements.length})</Radio.Button>
                        <Radio.Button value="published">Published ({publishedStatements.length})</Radio.Button>
                      </Radio.Group>
                    </Space>

                    <Button
                      icon={<SettingOutlined />}
                      onClick={() => {
                        configForm.setFieldsValue({
                          assignmentMode: assignmentConfig.assignmentMode,
                          batchSize: assignmentConfig.batchSize,
                          batchStartTeamNumbers: assignmentConfig.batchStartTeamNumbers.join(', '),
                        });
                        setIsConfigModalOpen(true);
                      }}
                    >
                      Assignment Method
                    </Button>
                  </div>

                  <Table
                    dataSource={filteredData}
                    columns={columns}
                    rowKey="statementId"
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                    size="middle"
                    locale={{ emptyText: 'No problem statements available.' }}
                  />
                </div>
              ),
            },
            {
              key: 'preview',
              label: (
                <span>
                  <FileDoneOutlined /> Assignment Preview (Not Yet Published)
                </span>
              ),
              children: (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <Tag color="purple" style={{ fontSize: '13px', fontWeight: 800, padding: '4px 10px' }}>
                        ASSIGNMENT PREVIEW
                      </Tag>
                    </div>

                    <Space wrap>
                      <Tag color="blue" style={{ fontSize: '13px', padding: '4px 10px' }}>
                        Active Teams: <strong>{activeTeamsCount}</strong>
                      </Tag>
                      <Tag color="purple" style={{ fontSize: '13px', padding: '4px 10px' }}>
                        Assigned: <strong>{assignedTeamsCount}</strong>
                      </Tag>
                      <Tag color="green" style={{ fontSize: '13px', padding: '4px 10px' }}>
                        Unassigned Problems: <strong>{unassignedProblemsCount}</strong>
                      </Tag>
                      <Tag color={unassignedTeamsCount === 0 ? 'success' : 'error'} style={{ fontSize: '13px', padding: '4px 10px' }}>
                        Unassigned Teams: <strong>{unassignedTeamsCount}</strong>
                      </Tag>

                      {unassignedTeamsCount > 0 && (
                        <Button
                          icon={<ThunderboltOutlined />}
                          onClick={handleAutoAssignAllTeams}
                          loading={loadingAction}
                          style={{ background: '#7c3aed', color: '#fff', borderColor: '#7c3aed', fontWeight: 600 }}
                        >
                          Auto-Assign All Teams
                        </Button>
                      )}

                      <Button icon={<ReloadOutlined />} onClick={handleRegeneratePreview}>
                        Refresh Preview
                      </Button>

                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleConfirmPublishWorkflow}
                        style={{ background: '#059669', borderColor: '#059669', fontWeight: 700 }}
                      >
                        PUBLISH ASSIGNMENT
                      </Button>
                    </Space>
                  </div>

                  {currentAssignmentMapping.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                      No problem statements available to display assignment preview.
                    </div>
                  ) : (
                    <Table
                      dataSource={currentAssignmentMapping}
                      rowKey="statementId"
                      pagination={{ pageSize: 15, showSizeChanger: true }}
                      size="middle"
                      columns={[
                        {
                          title: '#',
                          dataIndex: 'sequence',
                          key: 'sequence',
                          width: 65,
                          render: (seq: number) => <Tag color="blue" style={{ fontWeight: 800 }}>#{seq}</Tag>,
                        },
                        {
                          title: 'Team',
                          key: 'team',
                          width: 220,
                          render: (_: any, record: ProblemAssignmentPreviewItem) => {
                            if (record.assignedTeams && record.assignedTeams.length > 0) {
                              return (
                                <Space orientation="vertical" size={2}>
                                  {record.assignedTeams.map((t) => (
                                    <Space orientation="horizontal" key={t.teamId}>
                                      <Tag color="purple" style={{ fontWeight: 700 }}>{t.teamId}</Tag>
                                      <Text strong style={{ fontSize: '13px' }}>{t.teamName}</Text>
                                    </Space>
                                  ))}
                                </Space>
                              );
                            }
                            if (record.assignedTeamIds && record.assignedTeamIds.length > 0) {
                              return (
                                <Space orientation="horizontal">
                                  {record.assignedTeamIds.map((tid) => (
                                    <Tag color="purple" key={tid} style={{ fontWeight: 700 }}>{tid}</Tag>
                                  ))}
                                </Space>
                              );
                            }
                            return <Text type="secondary">—</Text>;
                          },
                        },
                        {
                          title: 'Problem Statement ID',
                          dataIndex: 'statementId',
                          key: 'statementId',
                          width: 170,
                          render: (id: string) => <Text strong style={{ color: '#0f172a' }}>{id}</Text>,
                        },
                        {
                          title: 'Problem Statement Title',
                          dataIndex: 'title',
                          key: 'title',
                          render: (title: string, record: ProblemAssignmentPreviewItem) => (
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>{title}</div>
                              <div style={{ fontSize: '12px', color: '#64748b' }}>
                                {record.description?.slice(0, 100)}{record.description?.length > 100 ? '...' : ''}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: 'Status',
                          key: 'status',
                          width: 130,
                          render: (_: any, record: ProblemAssignmentPreviewItem) => {
                            const isAssigned = record.assignedTeamIds && record.assignedTeamIds.length > 0;
                            return isAssigned ? (
                              <Tag color="purple" style={{ fontWeight: 700 }}>Assigned</Tag>
                            ) : (
                              <Tag color="green" style={{ fontWeight: 700 }}>Unassigned / Free</Tag>
                            );
                          },
                        },
                        {
                          title: 'Action',
                          key: 'action',
                          width: 110,
                          render: (_: any, record: ProblemAssignmentPreviewItem) => (
                            <Button
                              size="small"
                              type="link"
                              icon={<EditOutlined />}
                              onClick={() => handleOpenEditAssignment(record)}
                            >
                              Edit Team
                            </Button>
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ========================================================================= */}
      {/* BULK UPLOAD + AI EXTRACTION MODAL                                         */}
      {/* ========================================================================= */}
      <Modal
        title={
          <Space>
            <RobotOutlined style={{ color: '#722ed1', fontSize: '20px' }} />
            <span style={{ fontWeight: 700, fontSize: '16px' }}>Google Gemini AI Bulk Problem Statement Import</span>
          </Space>
        }
        open={isBulkModalOpen}
        onCancel={() => {
          if (!loadingAction) setIsBulkModalOpen(false);
        }}
        width={900}
        footer={null}
        destroyOnClose
      >
        <div style={{ padding: '8px 0' }}>
          <Steps
            current={bulkStep}
            items={[
              { title: 'Upload File' },
              { title: 'AI Extraction' },
              { title: 'Save as Drafts' },
            ]}
            style={{ marginBottom: 24 }}
          />

          {bulkStep === 0 && (
            <div>
              <Alert
                message="Upload Problem Statement Document"
                description="Upload one document (PDF, DOCX, TXT, CSV, JSON). Google Gemini AI will structure all problem statements into Draft records without publishing."
                type="info"
                showIcon
                style={{ marginBottom: 20, borderRadius: 8 }}
              />

              <Dragger
                accept=".pdf,.docx,.txt,.csv,.json,.md"
                beforeUpload={handleFileSelect}
                showUploadList={false}
                style={{ padding: 24, borderRadius: 12, background: '#faf5ff', borderColor: '#d3adf7' }}
              >
                <p className="ant-upload-drag-icon">
                  <CloudUploadOutlined style={{ color: '#722ed1', fontSize: 48 }} />
                </p>
                <p className="ant-upload-text" style={{ fontWeight: 600, fontSize: '16px', color: '#1e293b' }}>
                  Click or drag problem statement document to this area
                </p>
                <p className="ant-upload-hint" style={{ color: '#64748b' }}>
                  Supports PDF, DOCX, TXT, CSV, JSON (Max 15MB)
                </p>
              </Dragger>

              {uploadedFile && (
                <div style={{ marginTop: 16, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <Text strong>Selected File: </Text>
                  <Tag color="purple" style={{ fontSize: '13px', padding: '2px 8px' }}>
                    {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)
                  </Tag>

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
                <Button onClick={() => setIsBulkModalOpen(false)}>Cancel</Button>
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  onClick={handleStartAIAnalysis}
                  disabled={!uploadedFile}
                  style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
                >
                  Extract with Google Gemini AI
                </Button>
              </div>
            </div>
          )}

          {bulkStep === 1 && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              {!processingError ? (
                <div>
                  <RobotOutlined style={{ fontSize: 56, color: '#722ed1', marginBottom: 16 }} />
                  <Title level={4} style={{ color: '#1e293b', marginBottom: 8 }}>
                    {processingStage || 'Processing document...'}
                  </Title>
                  <Paragraph type="secondary" style={{ maxWidth: 450, margin: '0 auto 24px' }}>
                    Google Gemini AI is structuring problem statements into strict draft records.
                  </Paragraph>
                  <Progress percent={processingPercent} status="active" strokeColor="#722ed1" style={{ maxWidth: 400 }} />
                </div>
              ) : (
                <div>
                  <Alert
                    message="Extraction Failed"
                    description={processingError}
                    type="error"
                    showIcon
                    style={{ marginBottom: 24, textAlign: 'left', borderRadius: 8 }}
                  />
                  <Space>
                    <Button onClick={() => setBulkStep(0)}>Cancel</Button>
                    <Button type="primary" onClick={handleStartAIAnalysis} style={{ background: '#722ed1' }}>
                      Retry Extraction
                    </Button>
                  </Space>
                </div>
              )}
            </div>
          )}

          {bulkStep === 2 && (
            <div>
              <Alert
                message={
                  <span style={{ fontWeight: 700 }}>
                    🎉 {parsedProblems.length} Problem Statements Extracted
                  </span>
                }
                description="Clicking 'SAVE ALL AS DRAFT' immediately writes all records into Firestore as DRAFT. They will NOT be visible to users until you explicitly publish."
                type="success"
                showIcon
                style={{ marginBottom: 20, borderRadius: 8 }}
              />

              <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                <Collapse
                  accordion
                  items={parsedProblems.map((p, idx) => ({
                    key: String(idx),
                    label: (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingRight: 8 }}>
                        <Space>
                          <Tag color="blue" style={{ fontWeight: 800 }}>#{p.sequence}</Tag>
                          <Text strong>{p.title}</Text>
                        </Space>
                        <Tag color="orange">DRAFT</Tag>
                      </div>
                    ),
                    children: (
                      <div>
                        <Paragraph style={{ fontSize: '13px', color: '#334155', whiteSpace: 'pre-line', marginBottom: 8 }}>
                          {p.description}
                        </Paragraph>

                        {p.requirements && p.requirements.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <Text strong style={{ fontSize: '12px', color: '#0369a1' }}>Requirements: </Text>
                            <ul style={{ paddingLeft: 18, fontSize: '12px', margin: '2px 0' }}>
                              {p.requirements.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ),
                  }))}
                />
              </div>

              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Button onClick={() => setBulkStep(0)}>Back to Upload</Button>
                <Button
                  type="primary"
                  size="large"
                  icon={<SaveOutlined />}
                  loading={loadingAction}
                  onClick={handleSaveAllAsDraft}
                  style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 700 }}
                >
                  SAVE ALL {parsedProblems.length} PROBLEMS AS DRAFT
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* EDIT INDIVIDUAL PROBLEM ASSIGNMENT MAPPING MODAL                          */}
      {/* ========================================================================= */}
      <Modal
        title={`Edit Assigned Teams for ${editingPreviewItem?.statementId} (${editingPreviewItem?.title})`}
        open={isEditAssignmentModalOpen}
        onCancel={() => setIsEditAssignmentModalOpen(false)}
        onOk={() => editAssignmentForm.submit()}
        okText="Save Mapping"
        destroyOnClose
      >
        <Alert
          message="Customize Team Mapping"
          description="Select which registered teams will receive this problem statement in the preview."
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form form={editAssignmentForm} layout="vertical" onFinish={handleSaveCustomAssignment}>
          <Form.Item name="assignedTeamIds" label="Assigned Teams" rules={[{ required: true, message: 'Please select teams' }]}>
            <Select
              mode="multiple"
              placeholder="Select teams"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="children"
            >
              {teams.filter((t) => t.status !== 'disabled').map((t) => (
                <Select.Option key={t.teamId} value={t.teamId}>
                  {t.teamId} • {t.teamName} (Leader: {t.leaderName})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ========================================================================= */}
      {/* MANUAL ADD / EDIT MODAL                                                   */}
      {/* ========================================================================= */}
      <Modal
        title={editingStatement ? `Edit Problem ${editingStatement.statementId}` : 'Add New Problem Statement'}
        open={isAddEditModalOpen}
        onCancel={() => setIsAddEditModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={loadingAction}
        okText="Save Problem Statement"
        width={700}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSaveStatement}>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="statementId" label="Statement ID" rules={[{ required: true, message: 'ID required' }]}>
                <Input disabled={Boolean(editingStatement)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="order" label="Assignment Order (1, 2, 3...)" rules={[{ required: true, message: 'Order required' }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 1" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="title" label="Problem Title" rules={[{ required: true, message: 'Title required' }]}>
            <Input placeholder="e.g. Real-Time Security Incident & Event Management (SIEM)" />
          </Form.Item>

          <Form.Item name="description" label="Problem Description" rules={[{ required: true, message: 'Description required' }]}>
            <TextArea rows={4} placeholder="Describe the challenge background and goals..." />
          </Form.Item>

          <Form.Item name="requirements" label="Specific Requirements (One per line)">
            <TextArea rows={3} placeholder="Requirement 1&#10;Requirement 2&#10;Requirement 3" />
          </Form.Item>

          <Form.Item name="technicalGuidelines" label="Technical Guidelines">
            <TextArea rows={2} placeholder="Architecture recommendations, tech stack, APIs..." />
          </Form.Item>

          <Form.Item name="constraints" label="Constraints & Limitations">
            <TextArea rows={2} placeholder="System latency, memory bounds, platform limits..." />
          </Form.Item>

          <Form.Item name="expectedOutcome" label="Expected Outcome & Deliverables">
            <TextArea rows={2} placeholder="Working prototype, API endpoints, dashboards..." />
          </Form.Item>

          <Form.Item name="status" label="Workflow Status" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="DRAFT">DRAFT (Unpublished)</Select.Option>
              <Select.Option value="READY_FOR_REVIEW">READY FOR REVIEW</Select.Option>
              <Select.Option value="PUBLISHED">PUBLISHED (Live to assigned team)</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ========================================================================= */}
      {/* ASSIGNMENT SETTINGS MODAL                                                 */}
      {/* ========================================================================= */}
      <Modal
        title="Team Assignment Distribution Method"
        open={isConfigModalOpen}
        onCancel={() => setIsConfigModalOpen(false)}
        onOk={async () => {
          try {
            const values = await configForm.validateFields();
            const starts = (values.batchStartTeamNumbers || '1, 21, 41, 61, 81')
              .split(',')
              .map((s: string) => Number(s.trim()))
              .filter((n: number) => !isNaN(n) && n > 0);

            await saveAssignmentConfig({
              assignmentMode: values.assignmentMode,
              batchSize: Number(values.batchSize) || 4,
              batchStartTeamNumbers: starts,
            }, user?.email || 'admin');

            message.success('Assignment method updated.');
            setIsConfigModalOpen(false);
          } catch (err: any) {
            message.error(err.message || 'Failed to save rules.');
          }
        }}
        okText="Save Method"
        destroyOnClose
      >
        <Form form={configForm} layout="vertical">
          <Form.Item name="assignmentMode" label="Assignment Method" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="batch_alternating">Balanced Distribution (Auto 60/15 = 4 teams each)</Select.Option>
              <Select.Option value="sequential">Strict Sequential (1 team per problem)</Select.Option>
              <Select.Option value="round_robin">Round Robin</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="batchSize" label="Default Group Size (Teams per Problem)">
            <InputNumber min={1} max={50} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ========================================================================= */}
      {/* VIEW SPECIFICATIONS DRAWER                                                */}
      {/* ========================================================================= */}
      <Drawer
        title={
          <Space>
            <Tag color="blue" style={{ fontSize: '14px', fontWeight: 800 }}>
              {selectedForView?.statementId}
            </Tag>
            <span>{selectedForView?.title}</span>
          </Space>
        }
        open={isViewDrawerOpen}
        onClose={() => setIsViewDrawerOpen(false)}
        width={600}
      >
        {selectedForView && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong>Status: </Text>
                {selectedForView.status === 'PUBLISHED' || selectedForView.status === 'published' ? (
                  <Tag color="green" icon={<CheckCircleOutlined />}>PUBLISHED</Tag>
                ) : (
                  <Tag color="orange" icon={<StopOutlined />}>DRAFT (Unpublished)</Tag>
                )}
              </div>
            </div>

            <Title level={5} style={{ color: '#0f172a' }}>Challenge Overview</Title>
            <Paragraph style={{ fontSize: '14px', lineHeight: 1.8, color: '#334155', whiteSpace: 'pre-line' }}>
              {selectedForView.description}
            </Paragraph>

            {selectedForView.requirements && (
              <div style={{ marginTop: 16 }}>
                <Title level={5} style={{ color: '#0369a1' }}>Requirements</Title>
                {Array.isArray(selectedForView.requirements) ? (
                  <ul style={{ paddingLeft: 20, color: '#334155' }}>
                    {selectedForView.requirements.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <Paragraph style={{ color: '#334155' }}>{selectedForView.requirements}</Paragraph>
                )}
              </div>
            )}

            {selectedForView.technicalGuidelines && (
              <div style={{ marginTop: 16 }}>
                <Title level={5} style={{ color: '#1e3a8a' }}>Technical Guidelines</Title>
                <Paragraph style={{ fontSize: '14px', color: '#475569', whiteSpace: 'pre-line' }}>
                  {selectedForView.technicalGuidelines}
                </Paragraph>
              </div>
            )}

            {selectedForView.constraints && (
              <div style={{ marginTop: 16 }}>
                <Title level={5} style={{ color: '#9a3412' }}>Constraints</Title>
                <Paragraph style={{ fontSize: '14px', color: '#475569', whiteSpace: 'pre-line' }}>
                  {selectedForView.constraints}
                </Paragraph>
              </div>
            )}

            {selectedForView.expectedOutcome && (
              <div style={{ marginTop: 16 }}>
                <Title level={5} style={{ color: '#166534' }}>Expected Outcome</Title>
                <Paragraph style={{ fontSize: '14px', color: '#475569', whiteSpace: 'pre-line' }}>
                  {selectedForView.expectedOutcome}
                </Paragraph>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* ========================================================================= */}
      {/* PUBLICATION HISTORY DRAWER                                                */}
      {/* ========================================================================= */}
      <Drawer
        title="Problem Statement Publication History"
        open={isPubHistoryDrawerOpen}
        onClose={() => setIsPubHistoryDrawerOpen(false)}
        width={650}
      >
        {publicationsHistory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8c8c8c' }}>
            No publication snapshots recorded yet. Click "PUBLISH ASSIGNMENT" to create the first version.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {publicationsHistory.map((pub) => (
              <Card key={pub.publicationId} size="small" style={{ borderRadius: 10, border: pub.publicationId === activePubVersion?.activePublicationId ? '1px solid #10b981' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Space>
                    <Tag color={pub.publicationId === activePubVersion?.activePublicationId ? 'green' : 'default'} style={{ fontWeight: 800 }}>
                      {pub.publicationId} (v{pub.version})
                    </Tag>
                    {pub.publicationId === activePubVersion?.activePublicationId && (
                      <Tag color="success">CURRENT LIVE</Tag>
                    )}
                  </Space>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    {formatISTDateTime(pub.publishedAt)}
                  </Text>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  Statements: <Text strong>{pub.totalStatements}</Text> • Teams Assigned: <Text strong>{pub.totalTeamsAssigned}</Text> • By: <Text strong>{pub.publishedBy}</Text>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Drawer>

      {/* ========================================================================= */}
      {/* MANUAL REASSIGN PROBLEM MODAL                                             */}
      {/* ========================================================================= */}
      <Modal
        title={
          <Space>
            <SwapOutlined style={{ color: '#722ed1' }} />
            <span>Change / Reassign Team Problem Statement</span>
          </Space>
        }
        open={isReassignModalOpen}
        onCancel={() => {
          setIsReassignModalOpen(false);
          setReassignTarget(null);
          setSelectedNewStatementId(null);
        }}
        onOk={handleConfirmReassign}
        okText="Confirm Reassignment"
        confirmLoading={reassigning}
        destroyOnClose
        centered
        width={560}
      >
        {reassignTarget && (
          <div>
            <Alert
              type="info"
              showIcon
              message="Manual Problem Reassignment"
              description="Select a currently FREE problem statement to reassign this team. The previous problem statement will be released back to FREE status only upon explicit confirmation."
              style={{ marginBottom: 16 }}
            />

            <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Team ID:</Text>
                <Tag color="purple" style={{ fontWeight: 800 }}>{reassignTarget.teamId}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Current Problem:</Text>
                <Text strong>{reassignTarget.statement.title} ({reassignTarget.statement.statementId})</Text>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <Text strong>Select New FREE Problem Statement:</Text>
            </div>

            <Select
              showSearch
              placeholder="Select a FREE problem statement..."
              value={selectedNewStatementId}
              onChange={(val) => setSelectedNewStatementId(val)}
              style={{ width: '100%' }}
              filterOption={(input, option) => {
                if (!option) return false;
                const searchStr = String((option as any).searchValue || '').toLowerCase();
                return searchStr.includes(input.toLowerCase());
              }}
            >
              {freeProblemStatements.map((p) => {
                const ord = p.order !== undefined && p.order !== null ? p.order : (p.sequence || 1);
                return (
                  <Select.Option
                    key={p.statementId}
                    value={p.statementId}
                    searchValue={`Problem #${ord} ${p.statementId} ${p.title}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={8} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                        <Tag color="blue" style={{ fontWeight: 800, fontSize: '11px', margin: 0 }}>
                          #{ord}
                        </Tag>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1d39c4', fontSize: '12px' }}>
                          {p.statementId}
                        </span>
                        <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '13px' }}>
                          {p.title}
                        </span>
                      </Space>
                      <Tag color="green" style={{ fontSize: '10px', fontWeight: 700, margin: 0 }}>
                        FREE
                      </Tag>
                    </div>
                  </Select.Option>
                );
              })}
            </Select>

            {freeProblemStatements.length === 0 && (
              <Alert
                type="warning"
                message="No FREE problem statements are currently available for reassignment."
                style={{ marginTop: 12 }}
              />
            )}
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* CSV PROBLEM STATEMENT ANALYZER MODAL                                      */}
      {/* ========================================================================= */}
      <CsvProblemAnalyzerModal
        open={isCsvAnalyzerOpen}
        onClose={() => setIsCsvAnalyzerOpen(false)}
        existingProblems={statements}
        onImportComplete={() => {
          // Statements automatically refresh via onSnapshot
        }}
        onNavigateToDistribution={() => {
          setActiveTab('preview');
        }}
      />
    </div>
  );
};
