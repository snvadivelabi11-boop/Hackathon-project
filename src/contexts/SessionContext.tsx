import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Modal } from 'antd';
import { useAuth } from './AuthContext';
import { SESSION_STORAGE_KEY } from '../services/auth.service';
import { db } from '../firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';

const SessionContext = createContext<Record<string, never>>({});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const isInvalidatingRef = useRef<boolean>(false);

  useEffect(() => {
    // Single session validation ONLY applies to team participant accounts, never admins
    if (!user || user.role === 'admin') return;

    const handleSessionInvalidation = (reason: string) => {
      if (isInvalidatingRef.current) return;
      isInvalidatingRef.current = true;

      Modal.warning({
        title: 'Session Invalidated',
        content: reason,
        okText: 'Return to Login',
        centered: true,
        onOk: async () => {
          await logout();
          isInvalidatingRef.current = false;
          window.location.href = '/login';
        },
      });
    };

    const currentLocalSessionId = localStorage.getItem(SESSION_STORAGE_KEY);

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const unsubscribe = onSnapshot(
        userDocRef,
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();

          // 1. Account disabled check
          if (data.status === 'disabled') {
            handleSessionInvalidation('Your team account has been disabled by the administrator.');
            return;
          }

          // 2. Active Session mismatch check
          if (
            currentLocalSessionId &&
            data.activeSessionId &&
            data.activeSessionId !== currentLocalSessionId
          ) {
            handleSessionInvalidation(
              'Your account was logged in from another device. For security, this session has been ended.'
            );
          }
        },
        (err) => {
          console.warn('[SessionContext] User snapshot listener error:', err);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      console.warn('[SessionContext] Error setting up session listener:', err);
    }
  }, [user, logout]);

  return <SessionContext.Provider value={{}}>{children}</SessionContext.Provider>;
};

export function useSession(): Record<string, never> {
  return useContext(SessionContext);
}
