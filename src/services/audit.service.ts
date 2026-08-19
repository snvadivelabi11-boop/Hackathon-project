import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { AuditLog } from '../types';

export function subscribeToAuditLogs(callback: (logs: AuditLog[]) => void, maxCount: number = 50): () => void {
  const q = query(
    collection(db, 'auditLogs'),
    orderBy('timestamp', 'desc'),
    limit(maxCount)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const logs: AuditLog[] = [];
      snapshot.forEach((doc) => {
        logs.push({ id: doc.id, ...doc.data() } as AuditLog);
      });
      callback(logs);
    },
    (err) => {
      console.warn('[AuditService] subscribeToAuditLogs error:', err);
      getDocs(query(collection(db, 'auditLogs'), limit(maxCount))).then((snap) => {
        const list: AuditLog[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as AuditLog));
        callback(list);
      }).catch(() => callback([]));
    }
  );
}
