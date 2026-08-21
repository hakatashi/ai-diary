import {createHash} from 'node:crypto';
import {GeoPoint, Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import type {RawCheckin} from './client';

const TIME_ZONE = 'Asia/Tokyo';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

export interface NormalizedCheckin {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

export const normalizeCheckin = (raw: RawCheckin): NormalizedCheckin => {
	const startDate = new Date((raw.createdAt ?? 0) * 1000);
	const venueName = raw.venue?.name ?? 'チェックイン';
	const category =
		raw.venue?.categories?.find((c) => c.primary)?.name ??
		raw.venue?.categories?.[0]?.name;

	const lat = raw.venue?.location?.lat;
	const lng = raw.venue?.location?.lng;

	const id = createHash('sha256')
		.update(`swarm_checkin:${raw.id}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'swarm_checkin',
			category: 'checkin',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt: null,
			title: venueName,
			summary: [category, raw.shout].filter(Boolean).join(' / ') || null,
			metrics: null,
			location:
				lat !== undefined && lng !== undefined ? new GeoPoint(lat, lng) : null,
			raw,
			sourceRecordId: raw.id,
		},
	};
};
