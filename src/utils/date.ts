import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

export const HACKATHON_TIMEZONE = 'Asia/Kolkata';

/**
 * Converts 12-hour AM/PM time ("8:37 PM", "12:00 AM", "12:00 PM") to 24-hour "HH:mm"
 */
export function convert12HourTo24Hour(time12: string): string {
  if (!time12) return '00:00';
  const clean = time12.trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return clean;

  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3].toUpperCase();

  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  return `${String(hour).padStart(2, '0')}:${min}`;
}

/**
 * Converts 24-hour time ("20:37", "00:00") to 12-hour "h:mm A" ("8:37 PM", "12:00 AM")
 */
export function convert24HourTo12Hour(time24: string): string {
  if (!time24) return '12:00 AM';
  const match = time24.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time24;

  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = hour >= 12 ? 'PM' : 'AM';

  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

  return `${hour}:${min} ${ampm}`;
}

/**
 * Safely converts any timestamp or date representation to Dayjs in Asia/Kolkata timezone
 */
export function toIST(date?: any): dayjs.Dayjs {
  try {
    if (!date) return dayjs().tz(HACKATHON_TIMEZONE);

    // If Firebase Timestamp object with toDate()
    if (typeof date === 'object' && typeof date.toDate === 'function') {
      return dayjs(date.toDate()).tz(HACKATHON_TIMEZONE);
    }

    // If Firebase Timestamp representation { seconds, nanoseconds }
    if (typeof date === 'object' && date.seconds !== undefined) {
      return dayjs(date.seconds * 1000).tz(HACKATHON_TIMEZONE);
    }

    const parsed = dayjs(date).tz(HACKATHON_TIMEZONE);
    if (parsed.isValid()) return parsed;
    return dayjs().tz(HACKATHON_TIMEZONE);
  } catch {
    return dayjs().tz(HACKATHON_TIMEZONE);
  }
}

/**
 * Formats a date in standard Hackathon format: "20 Aug 2026, 8:37 PM IST"
 */
export function formatISTDateTime(date?: any): string {
  if (!date) return '—';
  try {
    const val = toIST(date);
    if (!val.isValid()) return '—';
    return val.format('D MMM YYYY, h:mm A [IST]');
  } catch {
    return '—';
  }
}

/**
 * Formats a time in 12-hour AM/PM format: "8:37 PM"
 */
export function formatISTTime(date?: any): string {
  if (!date) return '—';
  try {
    const val = toIST(date);
    if (!val.isValid()) return '—';
    return val.format('h:mm A');
  } catch {
    return '—';
  }
}

/**
 * Formats a time in 12-hour AM/PM format with IST suffix: "8:37 PM IST"
 */
export function formatISTTimeWithZone(date?: any): string {
  if (!date) return '—';
  try {
    const val = toIST(date);
    if (!val.isValid()) return '—';
    return val.format('h:mm A [IST]');
  } catch {
    return '—';
  }
}

/**
 * Formats a date: "20 Aug 2026"
 */
export function formatISTDate(date?: any): string {
  if (!date) return '—';
  try {
    const val = toIST(date);
    if (!val.isValid()) return '—';
    return val.format('D MMM YYYY');
  } catch {
    return '—';
  }
}

/**
 * Formats a scheduled range:
 * "Scheduled: 20 Aug 2026, 8:37 PM IST → 24 Aug 2026, 8:37 PM IST"
 */
export function formatISTScheduleRange(startDate?: any, endDate?: any): string {
  const sStr = formatISTDateTime(startDate);
  const eStr = formatISTDateTime(endDate);
  if (sStr === '—' && eStr === '—') return 'Schedule not set';
  return `Scheduled: ${sStr} → ${eStr}`;
}

/**
 * Safely parses Date (YYYY-MM-DD or DD-MM-YYYY) and 12-hour/24-hour Time ("8:37 PM", "20:37") into UTC ISO string
 */
export function parseDateAndTimeToIso(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) return '';
  try {
    // Normalize date format
    let cleanDate = dateStr.trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(cleanDate)) {
      const [d, m, y] = cleanDate.split('-');
      cleanDate = `${y}-${m}-${d}`;
    }

    const time24 = convert12HourTo24Hour(timeStr);
    const parsed = dayjs.tz(`${cleanDate} ${time24}`, 'YYYY-MM-DD HH:mm', HACKATHON_TIMEZONE);
    if (parsed.isValid()) {
      return parsed.toISOString();
    }

    return dayjs(`${cleanDate} ${time24}`).toISOString();
  } catch {
    return '';
  }
}

/**
 * Calculates and formats total duration between two dates/timestamps
 * e.g. "4 Days 0 Hours" or "4 Days 2 Hours 25 Minutes"
 */
export function calculateDurationFormatted(startDate?: any, endDate?: any): string {
  if (!startDate || !endDate) return '—';
  try {
    const s = toIST(startDate);
    const e = toIST(endDate);
    if (!s.isValid() || !e.isValid()) return '—';

    const diffMs = e.diff(s);
    if (diffMs <= 0) return '0 Hours';

    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days} Day${days === 1 ? '' : 's'}`);
    if (hours > 0 || days > 0) parts.push(`${hours} Hour${hours === 1 ? '' : 's'}`);
    if (mins > 0 && days === 0) parts.push(`${mins} Minute${mins === 1 ? '' : 's'}`);

    return parts.join(' ') || '0 Hours';
  } catch {
    return '—';
  }
}

/**
 * Relative time from now: "5 minutes ago"
 */
export function formatISTFromNow(date?: any): string {
  if (!date) return '—';
  try {
    const val = toIST(date);
    if (!val.isValid()) return '—';
    return val.fromNow();
  } catch {
    return '—';
  }
}
