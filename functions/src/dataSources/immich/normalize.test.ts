import {expect, test} from 'vitest';
import {normalizeAsset} from './normalize.ts';

test('normalizeAsset derives date from localDateTime without further timezone conversion', () => {
	const {entry} = normalizeAsset({
		id: 'aaf3bea8-7e22-48a8-bd4f-bd637b4a45ea',
		type: 'IMAGE',
		originalFileName: 'IMG20260821160637.jpg',
		fileCreatedAt: '2026-08-21T07:06:37.064Z',
		localDateTime: '2026-08-21T16:06:37.064Z',
	});

	expect(entry.date).toBe('2026-08-21');
	expect(entry.startAt.toDate().toISOString()).toBe('2026-08-21T07:06:37.064Z');
	expect(entry.title).toBe('IMG20260821160637.jpg');
	expect(entry.category).toBe('photo');
	expect(entry.sourceType).toBe('immich_photo');
	expect(entry.location).toBeNull();
	expect(entry.summary).toBeNull();
});

test('normalizeAsset builds a location and summary when exif data is present', () => {
	const {entry} = normalizeAsset({
		id: 'asset-2',
		originalFileName: 'IMG_0002.jpg',
		fileCreatedAt: '2026-07-01T03:00:00.000Z',
		localDateTime: '2026-07-01T12:00:00.000Z',
		exifInfo: {
			latitude: 35.6812,
			longitude: 139.7671,
			city: '千代田区',
			country: '日本',
		},
	});

	expect(entry.location?.latitude).toBeCloseTo(35.6812);
	expect(entry.location?.longitude).toBeCloseTo(139.7671);
	expect(entry.summary).toBe('千代田区, 日本');
});

test('normalizeAsset produces a deterministic id for the same asset id', () => {
	const first = normalizeAsset({
		id: 'same-id',
		fileCreatedAt: '2026-01-01T00:00:00.000Z',
	});
	const second = normalizeAsset({
		id: 'same-id',
		fileCreatedAt: '2026-01-01T00:00:00.000Z',
	});
	expect(first.id).toBe(second.id);
});
