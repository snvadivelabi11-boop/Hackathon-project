import React from 'react';
import { DatePicker, TimePicker, Typography, Row, Col, Space } from 'antd';
import { FieldTimeOutlined, CalendarOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { calculateDurationFormatted, parseDateAndTimeToIso } from '../../utils/date';

const { Text } = Typography;

export interface ScheduleValues {
  startDate: string; // YYYY-MM-DD
  startTime: string; // h:mm A e.g. "8:37 PM"
  endDate: string;   // YYYY-MM-DD
  endTime: string;   // h:mm A e.g. "8:37 PM"
}

interface Props {
  value: ScheduleValues;
  onChange: (newVal: ScheduleValues) => void;
  disabled?: boolean;
}

export const Schedule12HourPicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const startDateDayjs = value.startDate ? dayjs(value.startDate, 'YYYY-MM-DD') : null;
  const startTimeDayjs = value.startTime ? dayjs(value.startTime, ['h:mm A', 'hh:mm A', 'HH:mm']) : null;
  const endDateDayjs = value.endDate ? dayjs(value.endDate, 'YYYY-MM-DD') : null;
  const endTimeDayjs = value.endTime ? dayjs(value.endTime, ['h:mm A', 'hh:mm A', 'HH:mm']) : null;

  const startIso = parseDateAndTimeToIso(value.startDate, value.startTime);
  const endIso = parseDateAndTimeToIso(value.endDate, value.endTime);

  const durationStr = React.useMemo(() => {
    if (!startIso || !endIso) return 'Automatically calculated';
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      return 'Invalid (End must be after Start)';
    }
    return calculateDurationFormatted(startIso, endIso);
  }, [startIso, endIso]);

  return (
    <div style={{ background: '#f8fafc', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0' }}>
      <Row gutter={[12, 12]}>
        {/* START DATE */}
        <Col xs={24} sm={12}>
          <div>
            <Text strong style={{ fontSize: '11px', textTransform: 'uppercase', color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
              <CalendarOutlined style={{ color: '#1677ff' }} /> Start Date:
            </Text>
            <DatePicker
              value={startDateDayjs}
              format="DD-MM-YYYY"
              placeholder="Select Start Date"
              style={{ width: '100%', marginTop: 4 }}
              disabled={disabled}
              onChange={(date) => {
                onChange({
                  ...value,
                  startDate: date ? date.format('YYYY-MM-DD') : '',
                });
              }}
            />
          </div>
        </Col>

        {/* START TIME (12-HOUR AM/PM) */}
        <Col xs={24} sm={12}>
          <div>
            <Text strong style={{ fontSize: '11px', textTransform: 'uppercase', color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ClockCircleOutlined style={{ color: '#1677ff' }} /> Start Time (12-Hr AM/PM):
            </Text>
            <TimePicker
              use12Hours
              format="h:mm A"
              placeholder="e.g. 8:37 PM"
              value={startTimeDayjs}
              style={{ width: '100%', marginTop: 4 }}
              disabled={disabled}
              minuteStep={1}
              onChange={(time) => {
                onChange({
                  ...value,
                  startTime: time ? time.format('h:mm A') : '',
                });
              }}
            />
          </div>
        </Col>

        {/* END DATE */}
        <Col xs={24} sm={12}>
          <div>
            <Text strong style={{ fontSize: '11px', textTransform: 'uppercase', color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
              <CalendarOutlined style={{ color: '#059669' }} /> End Date:
            </Text>
            <DatePicker
              value={endDateDayjs}
              format="DD-MM-YYYY"
              placeholder="Select End Date"
              style={{ width: '100%', marginTop: 4 }}
              disabled={disabled}
              onChange={(date) => {
                onChange({
                  ...value,
                  endDate: date ? date.format('YYYY-MM-DD') : '',
                });
              }}
            />
          </div>
        </Col>

        {/* END TIME (12-HOUR AM/PM) */}
        <Col xs={24} sm={12}>
          <div>
            <Text strong style={{ fontSize: '11px', textTransform: 'uppercase', color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ClockCircleOutlined style={{ color: '#059669' }} /> End Time (12-Hr AM/PM):
            </Text>
            <TimePicker
              use12Hours
              format="h:mm A"
              placeholder="e.g. 8:37 PM"
              value={endTimeDayjs}
              style={{ width: '100%', marginTop: 4 }}
              disabled={disabled}
              minuteStep={1}
              onChange={(time) => {
                onChange({
                  ...value,
                  endTime: time ? time.format('h:mm A') : '',
                });
              }}
            />
          </div>
        </Col>
      </Row>

      {/* DURATION DISPLAY */}
      <div
        style={{
          marginTop: 12,
          background: '#ffffff',
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <FieldTimeOutlined style={{ color: '#6366f1' }} />
        <Text style={{ fontSize: '12px', color: '#334155' }}>
          <strong>Duration:</strong>{' '}
          <span style={{ color: durationStr.includes('Invalid') ? '#dc2626' : '#166534', fontWeight: 600 }}>
            {durationStr}
          </span>
        </Text>
      </div>
    </div>
  );
};
