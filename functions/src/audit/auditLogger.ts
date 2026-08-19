import * as admin from 'firebase-admin';
import { AuditLogDoc } from '../types';

export async function logAudit(
  adminUid: string,
  adminEmail: string | undefined,
  action: string,
  targetType: AuditLogDoc['targetType'],
  targetId: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const db = admin.firestore();
    const cleanMeta = metadata ? { ...metadata } : {};
    
    // Ensure passwords or private tokens are NEVER in audit logs
    if (cleanMeta.password) delete cleanMeta.password;
    if (cleanMeta.confirmPassword) delete cleanMeta.confirmPassword;
    if (cleanMeta.newPassword) delete cleanMeta.newPassword;

    await db.collection('auditLogs').add({
      adminUid: adminUid || 'system',
      adminEmail: adminEmail || 'admin@hackathon.org',
      action,
      targetType,
      targetId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      metadata: cleanMeta
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
