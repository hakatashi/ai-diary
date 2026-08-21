import {createHash} from 'node:crypto';
import {GeoPoint, Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import type {ImmichAsset} from './client';

export interface NormalizedAsset {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// Immichの `localDateTime` はEXIF等から解決した撮影地点の壁時計時刻を "Z" 付きの
// ISO文字列として返す(実際のUTCではない、Immich独自の仕様)。日付部分をそのまま
// `date` フィールドに使うことで、Google Photos連携時のような固定タイムゾーンでの
// 再計算をせずに済む。
export const normalizeAsset = (raw: ImmichAsset): NormalizedAsset => {
	const localDateTime = raw.localDateTime ?? raw.fileCreatedAt;
	const date = (localDateTime ?? new Date().toISOString()).slice(0, 10);
	const startDate = raw.fileCreatedAt
		? new Date(raw.fileCreatedAt)
		: new Date(localDateTime ?? Date.now());

	const latitude = raw.exifInfo?.latitude;
	const longitude = raw.exifInfo?.longitude;

	const id = createHash('sha256')
		.update(`immich_photo:${raw.id}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'immich_photo',
			category: 'photo',
			date,
			startAt: Timestamp.fromDate(startDate),
			endAt: null,
			title: raw.originalFileName ?? '写真',
			summary:
				[raw.exifInfo?.city, raw.exifInfo?.country]
					.filter(Boolean)
					.join(', ') || null,
			metrics: null,
			location:
				typeof latitude === 'number' && typeof longitude === 'number'
					? new GeoPoint(latitude, longitude)
					: null,
			raw,
			sourceRecordId: raw.id,
		},
	};
};
