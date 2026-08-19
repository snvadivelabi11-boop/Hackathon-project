import React, { createContext, useContext, useState, useEffect } from 'react';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from '../types';
import {
  subscribeToScoringConfig,
  saveScoringConfig,
  getMaxMarksForRound,
} from '../services/scoringConfig.service';

interface ScoringContextType {
  scoringConfig: ScoringConfig;
  loading: boolean;
  round1MaxMarks: number;
  round2MaxMarks: number;
  round3MaxMarks: number;
  totalMaxMarks: number;
  getMaxMarks: (roundIdOrNum: string | number) => number;
  updateScoringConfig: (config: {
    round1MaxMarks: number;
    round2MaxMarks: number;
    round3MaxMarks: number;
    totalMaxMarks: number;
  }) => Promise<ScoringConfig>;
}

const ScoringContext = createContext<ScoringContextType>({
  scoringConfig: DEFAULT_SCORING_CONFIG,
  loading: true,
  round1MaxMarks: DEFAULT_SCORING_CONFIG.round1MaxMarks,
  round2MaxMarks: DEFAULT_SCORING_CONFIG.round2MaxMarks,
  round3MaxMarks: DEFAULT_SCORING_CONFIG.round3MaxMarks,
  totalMaxMarks: DEFAULT_SCORING_CONFIG.totalMaxMarks,
  getMaxMarks: (roundIdOrNum) => getMaxMarksForRound(roundIdOrNum, DEFAULT_SCORING_CONFIG),
  updateScoringConfig: async () => DEFAULT_SCORING_CONFIG,
});

export const ScoringProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToScoringConfig((cfg) => {
      setScoringConfig(cfg);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const getMaxMarks = (roundIdOrNum: string | number) => {
    return getMaxMarksForRound(roundIdOrNum, scoringConfig);
  };

  const updateScoringConfig = async (config: {
    round1MaxMarks: number;
    round2MaxMarks: number;
    round3MaxMarks: number;
    totalMaxMarks: number;
  }) => {
    const updated = await saveScoringConfig(config);
    setScoringConfig(updated);
    return updated;
  };

  return (
    <ScoringContext.Provider
      value={{
        scoringConfig,
        loading,
        round1MaxMarks: scoringConfig.round1MaxMarks,
        round2MaxMarks: scoringConfig.round2MaxMarks,
        round3MaxMarks: scoringConfig.round3MaxMarks,
        totalMaxMarks: scoringConfig.totalMaxMarks,
        getMaxMarks,
        updateScoringConfig,
      }}
    >
      {children}
    </ScoringContext.Provider>
  );
};

export const useScoring = () => useContext(ScoringContext);
