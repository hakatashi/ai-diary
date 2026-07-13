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

export interface RawPickedMediaItem {
	id: string;
	createTime?: string;
	type?: string;
	mediaFile?: {
		baseUrl?: string;
		filename?: string;
		mimeType?: string;
	};
	[key: string]: unknown;
}

export interface NormalizedPhoto {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// Photos Picker APIで選択されたメディアの baseUrl は短時間(目安60分程度)で
// 失効するため、ここに保存したbaseUrlはインポート直後の一時的なプレビュー用途に
// とどまる。恒久的なサムネイル表示は将来の課題(AGENTS.md参照)。
export const normalizePhoto = (raw: RawPickedMediaItem): NormalizedPhoto => {
	const createDate = raw.createTime ? new Date(raw.createTime) : new Date();

	const id = createHash('sha256')
		.update(`google_photos_photo:${raw.id}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_photos_photo',
			category: 'photo',
			date: dateFormatter.format(createDate),
			startAt: Timestamp.fromDate(createDate),
			endAt: null,
			title: raw.mediaFile?.filename ?? '写真',
			summary: null,
			metrics: null,
			location: null,
			raw,
			sourceRecordId: raw.id,
		},
	};
};
