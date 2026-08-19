import { useState, useEffect, useRef } from 'react';
import { toIST } from '../utils/date';
import dayjs from 'dayjs';

export interface CountdownResult {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  formatted: string;
  isExpired: boolean;
}

export function useCountdown(targetEndTime?: any, onExpire?: () => void): CountdownResult {
  const expiredHandledRef = useRef(false);

  const calculateTimeRemaining = (): CountdownResult => {
    if (!targetEndTime) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalSeconds: 0,
        formatted: '00 : 00 : 00',
        isExpired: true,
      };
    }

    const now = toIST();
    const end = toIST(targetEndTime);
    const diffMs = end.diff(now);

    if (diffMs <= 0) {
      if (!expiredHandledRef.current && onExpire) {
        expiredHandledRef.current = true;
        setTimeout(() => onExpire(), 100);
      }
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalSeconds: 0,
        formatted: '00 : 00 : 00',
        isExpired: true,
      };
    }

    expiredHandledRef.current = false;
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => String(n).padStart(2, '0');
    let formatted = `${pad(hours)} : ${pad(minutes)} : ${pad(seconds)}`;
    if (days > 0) {
      formatted = `${pad(days)}d : ${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`;
    }

    return {
      days,
      hours,
      minutes,
      seconds,
      totalSeconds,
      formatted,
      isExpired: false,
    };
  };

  const [timeLeft, setTimeLeft] = useState<CountdownResult>(calculateTimeRemaining);

  useEffect(() => {
    setTimeLeft(calculateTimeRemaining());

    const interval = setInterval(() => {
      setTimeLeft(calculateTimeRemaining());
    }, 1000);

    return () => clearInterval(interval);
  }, [targetEndTime]);

  return timeLeft;
}
