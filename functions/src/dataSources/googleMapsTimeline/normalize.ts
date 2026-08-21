import {createHash} from 'node:crypto';
import {GeoPoint, Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import {resolvePlace} from './placesClient';

const TIME_ZONE = 'Asia/Tokyo';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

interface RawLatLngPoint {
	latLng: string;
}

export interface RawVisitSegment {
	startTime: string;
	endTime: string;
	visit: {
		hierarchyLevel?: number;
		probability?: number;
		topCandidate?: {
			placeId?: string;
			semanticType?: string;
			probability?: number;
			placeLocation?: RawLatLngPoint;
		};
	};
}

export interface RawActivitySegment {
	startTime: string;
	endTime: string;
	activity: {
		distanceMeters?: number;
		start?: RawLatLngPoint;
		end?: RawLatLngPoint;
		topCandidate?: {
			type?: string;
			probability?: number;
		};
	};
}

export type RawTimelineSegment =
	| RawVisitSegment
	| RawActivitySegment
	| Record<string, unknown>;

export interface NormalizedSegment {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// Google Maps Timelineエクスポートの座標は "35.6805259°, 139.5650109°" という
// 度記号付きの文字列で表現される。
export const parseLatLng = (
	value: string | undefined,
): {lat: number; lng: number} | null => {
	if (!value) {
		return null;
	}
	const match = value.match(/(-?\d+(?:\.\d+)?)°?,\s*(-?\d+(?:\.\d+)?)°?/);
	if (!match) {
		return null;
	}
	return {lat: Number(match[1]), lng: Number(match[2])};
};

const SEMANTIC_TYPE_LABELS: Record<string, string> = {
	HOME: '自宅',
	WORK: '職場',
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
	WALKING: '徒歩',
	CYCLING: '自転車',
	RUNNING: 'ランニング',
	IN_PASSENGER_VEHICLE: '車での移動',
	IN_BUS: 'バスでの移動',
	IN_TRAIN: '電車での移動',
	IN_SUBWAY: '地下鉄での移動',
	IN_TRAM: '路面電車での移動',
	IN_FERRY: 'フェリーでの移動',
	FLYING: '飛行機での移動',
	MOTORCYCLING: 'バイクでの移動',
	SKIING: 'スキー',
	SAILING: 'セーリング',
	STILL: '静止',
	UNKNOWN_ACTIVITY_TYPE: '移動',
};

const formatActivityType = (type: string | undefined): string => {
	if (!type) {
		return '移動';
	}
	if (ACTIVITY_TYPE_LABELS[type]) {
		return ACTIVITY_TYPE_LABELS[type];
	}
	return type
		.toLowerCase()
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
};

export const isVisitSegment = (
	segment: RawTimelineSegment,
): segment is RawVisitSegment =>
	'visit' in segment && Boolean((segment as RawVisitSegment).visit);

export const isActivitySegment = (
	segment: RawTimelineSegment,
): segment is RawActivitySegment =>
	'activity' in segment && Boolean((segment as RawActivitySegment).activity);

export const normalizeVisitSegment = async (
	segment: RawVisitSegment,
): Promise<NormalizedSegment | null> => {
	const startDate = new Date(segment.startTime);
	const endDate = segment.endTime ? new Date(segment.endTime) : null;
	if (Number.isNaN(startDate.getTime())) {
		return null;
	}

	const topCandidate = segment.visit.topCandidate;
	const placeId = topCandidate?.placeId;
	const coords = parseLatLng(topCandidate?.placeLocation?.latLng);

	let title: string | undefined;
	if (placeId) {
		const place = await resolvePlace(placeId);
		title = place?.displayName;
	}
	if (!title && topCandidate?.semanticType) {
		title = SEMANTIC_TYPE_LABELS[topCandidate.semanticType];
	}
	if (!title) {
		title = coords
			? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} 付近`
			: '訪問';
	}

	const sourceRecordId = `${segment.startTime}_${segment.endTime}_${
		placeId ?? topCandidate?.placeLocation?.latLng ?? ''
	}`;
	const id = createHash('sha256')
		.update(`google_maps_visit:${sourceRecordId}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_maps_visit',
			category: 'location',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt:
				endDate && !Number.isNaN(endDate.getTime())
					? Timestamp.fromDate(endDate)
					: null,
			title,
			summary: null,
			metrics: null,
			location: coords ? new GeoPoint(coords.lat, coords.lng) : null,
			raw: segment as unknown as Record<string, unknown>,
			sourceRecordId,
		},
	};
};

export const normalizeActivitySegment = (
	segment: RawActivitySegment,
): NormalizedSegment | null => {
	const startDate = new Date(segment.startTime);
	const endDate = segment.endTime ? new Date(segment.endTime) : null;
	if (Number.isNaN(startDate.getTime())) {
		return null;
	}

	const startCoords = parseLatLng(segment.activity.start?.latLng);
	const activityType = segment.activity.topCandidate?.type;
	const distanceMeters = segment.activity.distanceMeters;
	const durationMinutes =
		endDate && !Number.isNaN(endDate.getTime())
			? Math.round((endDate.getTime() - startDate.getTime()) / 60000)
			: undefined;
	const hasMetrics =
		distanceMeters !== undefined || durationMinutes !== undefined;

	const sourceRecordId = `${segment.startTime}_${segment.endTime}_${distanceMeters ?? ''}`;
	const id = createHash('sha256')
		.update(`google_maps_activity:${sourceRecordId}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_maps_activity',
			category: 'location',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt:
				endDate && !Number.isNaN(endDate.getTime())
					? Timestamp.fromDate(endDate)
					: null,
			title: formatActivityType(activityType),
			summary: null,
			metrics: hasMetrics
				? {
						...(distanceMeters !== undefined && {distanceMeters}),
						...(durationMinutes !== undefined && {durationMinutes}),
					}
				: null,
			location: startCoords
				? new GeoPoint(startCoords.lat, startCoords.lng)
				: null,
			raw: segment as unknown as Record<string, unknown>,
			sourceRecordId,
		},
	};
};
