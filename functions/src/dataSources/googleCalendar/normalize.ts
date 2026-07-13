import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';

const TIME_ZONE = 'Asia/Tokyo';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

interface CalendarEventDateTime {
	date?: string;
	dateTime?: string;
	timeZone?: string;
}

export interface RawCalendarEvent {
	id: string;
	summary?: string;
	description?: string;
	location?: string;
	status?: string;
	start?: CalendarEventDateTime;
	end?: CalendarEventDateTime;
	[key: string]: unknown;
}

export interface NormalizedCalendarEvent {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// 参照: https://developers.google.com/calendar/api/v3/reference/events
export const normalizeCalendarEvent = (
	raw: RawCalendarEvent,
): NormalizedCalendarEvent => {
	// 終日イベントは start.date/end.date のみ持つ(タイムゾーンなしのプレーンな日付文字列)。
	const startDate = raw.start?.dateTime
		? new Date(raw.start.dateTime)
		: new Date(
				`${raw.start?.date ?? dateFormatter.format(new Date())}T00:00:00+09:00`,
			);
	const endDate = raw.end?.dateTime
		? new Date(raw.end.dateTime)
		: raw.end?.date
			? new Date(`${raw.end.date}T00:00:00+09:00`)
			: null;

	const id = createHash('sha256')
		.update(`google_calendar_event:${raw.id}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_calendar_event',
			category: 'calendar',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt: endDate ? Timestamp.fromDate(endDate) : null,
			title: raw.summary || '(タイトルなし)',
			summary:
				raw.description ?? (raw.location ? `場所: ${raw.location}` : null),
			metrics: null,
			location: null,
			raw,
			sourceRecordId: raw.id,
		},
	};
};
