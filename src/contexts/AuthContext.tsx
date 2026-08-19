import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, UserRole } from '../types';
import {
  loginTeam as authLoginTeam,
  loginAdmin as authLoginAdmin,
  logoutUser,
  verifyAdminStatus,
  SESSION_STORAGE_KEY,
} from '../services/auth.service';
import { auth, db } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole | null;
  teamId: string | null;
  isAdmin: boolean;
  isTeam: boolean;
  loading: boolean;
  authLoading: boolean;
  loginTeam: (teamIdOrUsername: string, pass: string) => Promise<UserProfile>;
  loginAdmin: (email: string, pass: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    let unsubSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (!isMounted) return;

      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }

      if (!fbUser) {
        if (isMounted) {
          setUser(null);
          try {
            localStorage.removeItem('hackathon_user');
          } catch {}
          setLoading(false);
        }
        return;
      }

      try {
        // Universal Admin authorization check across claims and Firestore collections
        const { isAdmin, data: adminData } = await verifyAdminStatus(fbUser);
        const resolvedRole: UserRole = isAdmin ? 'admin' : 'team';

        const userDocRef = doc(db, 'users', fbUser.uid);
        const userSnap = await getDoc(userDocRef).catch(() => null);
        const userData = userSnap && userSnap.exists() ? (userSnap.data() as UserProfile) : null;

        const initialProfile: UserProfile = {
          uid: fbUser.uid,
          role: resolvedRole,
          teamId: userData?.teamId || (resolvedRole === 'team' ? fbUser.email?.split('@')[0].toUpperCase() : undefined),
          username: userData?.username || fbUser.email?.split('@')[0] || fbUser.uid,
          displayName: userData?.displayName || fbUser.displayName || adminData?.displayName || (resolvedRole === 'admin' ? 'Administrator' : 'Team Participant'),
          status: userData?.status || adminData?.status || 'active',
          sessionVersion: userData?.sessionVersion || 1,
          activeSessionId: userData?.activeSessionId || null,
          createdAt: userData?.createdAt || adminData?.createdAt || new Date().toISOString(),
          updatedAt: userData?.updatedAt || new Date().toISOString(),
        };

        if (isMounted) {
          setUser(initialProfile);
          try {
            localStorage.setItem('hackathon_user', JSON.stringify(initialProfile));
          } catch {}
          setLoading(false);
        }

        // Real-time listener for user document changes
        try {
          unsubSnapshot = onSnapshot(
            userDocRef,
            (snap) => {
              if (!isMounted) return;
              if (snap.exists()) {
                const data = snap.data() as UserProfile;
                const updatedRole: UserRole = (isAdmin || data.role === 'admin' || (data as any).isAdmin === true) ? 'admin' : 'team';
                const updatedProfile: UserProfile = {
                  ...data,
                  uid: fbUser.uid,
                  role: updatedRole,
                };
                setUser(updatedProfile);
                try {
                  localStorage.setItem('hackathon_user', JSON.stringify(updatedProfile));
                } catch {}
              }
            },
            (err) => {
              console.warn('[AuthContext] User snapshot subscription notice:', err.message);
            }
          );
        } catch (subErr) {
          console.warn('[AuthContext] Could not subscribe to user document:', subErr);
        }

      } catch (err: any) {
        console.warn('[AuthContext] Auth resolution notice:', err.message);
        if (isMounted) {
          const cached = localStorage.getItem('hackathon_user');
          if (cached) {
            try {
              setUser(JSON.parse(cached));
            } catch {
              setUser(null);
            }
          } else {
            setUser(null);
          }
          setLoading(false);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, []);

  const loginTeam = async (identifier: string, pass: string): Promise<UserProfile> => {
    const profile = await authLoginTeam(identifier, pass);
    setUser(profile);
    try {
      localStorage.setItem('hackathon_user', JSON.stringify(profile));
    } catch {}
    return profile;
  };

  const loginAdmin = async (email: string, pass: string): Promise<UserProfile> => {
    const profile = await authLoginAdmin(email, pass);
    setUser(profile);
    try {
      localStorage.setItem('hackathon_user', JSON.stringify(profile));
    } catch {}
    return profile;
  };

  const logout = async (): Promise<void> => {
    const currentUid = user?.uid;
    const currentSid = user?.activeSessionId || localStorage.getItem(SESSION_STORAGE_KEY);
    setUser(null);
    try {
      localStorage.removeItem('hackathon_user');
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {}
    await logoutUser(currentUid, currentSid);
  };

  const role = user?.role || null;
  const teamId = user?.teamId || null;
  const isAdmin = role === 'admin';
  const isTeam = role === 'team';

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        teamId,
        isAdmin,
        isTeam,
        loading,
        authLoading: loading,
        loginTeam,
        loginAdmin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
