import {expect, test, vi} from 'vitest';

const saveGpsTrackMock = vi.fn().mockResolvedValue({
	storagePath: 'gpsTracks/google_maps_path/mock.json.gz',
	pointCount: 2,
	distanceMeters: 42,
	boundingBox: {minLat: 35.68, maxLat: 35.69, minLng: 139.76, maxLng: 139.77},
});
vi.mock('../../lib/gpsTrackStorage', () => ({
	saveGpsTrack: saveGpsTrackMock,
}));

const {
	isMemorySegment,
	isPathSegment,
	normalizeMemorySegment,
	normalizePathSegment,
} = await import('./normalize.ts');

test('isPathSegment/isMemorySegment discriminate raw segments', () => {
	expect(isPathSegment({timelinePath: []})).toBe(true);
	expect(isPathSegment({visit: {}})).toBe(false);
	expect(isMemorySegment({timelineMemory: {note: {note: 'hi'}}})).toBe(true);
	expect(isMemorySegment({activity: {}})).toBe(false);
});

test('normalizePathSegment uploads points via saveGpsTrack and stores only metadata', async () => {
	const result = await normalizePathSegment({
		startTime: '2026-08-18T08:00:00.000+09:00',
		endTime: '2026-08-18T08:30:00.000+09:00',
		timelinePath: [
			{
				point: '35.6805259°, 139.5650109°',
				time: '2026-08-18T08:00:00.000+09:00',
			},
			{
				point: '35.6807771°, 139.565015°',
				time: '2026-08-18T08:05:00.000+09:00',
			},
		],
	});

	expect(result).not.toBeNull();
	expect(result?.entry.sourceType).toBe('google_maps_path');
	expect(result?.entry.category).toBe('location');
	expect(result?.entry.date).toBe('2026-08-18');
	expect(result?.entry.metrics?.distanceMeters).toBe(42);
	expect(result?.entry.metrics?.durationMinutes).toBe(30);
	expect(result?.entry.location?.latitude).toBeCloseTo(35.6805259);
	expect(result?.entry.raw).toEqual({
		storagePath: 'gpsTracks/google_maps_path/mock.json.gz',
		pointCount: 2,
		boundingBox: {minLat: 35.68, maxLat: 35.69, minLng: 139.76, maxLng: 139.77},
	});
	expect(saveGpsTrackMock).toHaveBeenCalledTimes(1);
});

test('normalizePathSegment skips segments with no parseable points', async () => {
	const result = await normalizePathSegment({
		startTime: '2026-08-18T08:00:00.000+09:00',
		endTime: '2026-08-18T08:30:00.000+09:00',
		timelinePath: [
			{point: 'not-a-coordinate', time: '2026-08-18T08:00:00.000+09:00'},
		],
	});
	expect(result).toBeNull();
});

test('normalizePathSegment produces a deterministic id for the same segment', async () => {
	const segment = {
		startTime: '2026-08-18T08:00:00.000+09:00',
		endTime: '2026-08-18T08:30:00.000+09:00',
		timelinePath: [
			{
				point: '35.6805259°, 139.5650109°',
				time: '2026-08-18T08:00:00.000+09:00',
			},
		],
	};
	const first = await normalizePathSegment(segment);
	const second = await normalizePathSegment(segment);
	expect(first?.id).toBe(second?.id);
});

test('normalizeMemorySegment skips empty notes', () => {
	const result = normalizeMemorySegment({
		startTime: '2026-08-18T00:00:00.000+09:00',
		endTime: '2026-08-19T00:00:00.000+09:00',
		timelineMemory: {note: {note: ''}},
	});
	expect(result).toBeNull();
});

test('normalizeMemorySegment builds a logEntry from a non-empty note', () => {
	const result = normalizeMemorySegment({
		startTime: '2026-08-18T00:00:00.000+09:00',
		endTime: '2026-08-19T00:00:00.000+09:00',
		timelineMemory: {note: {note: '楽しい旅行だった'}},
	});
	expect(result).not.toBeNull();
	expect(result?.entry.sourceType).toBe('google_maps_memory');
	expect(result?.entry.summary).toBe('楽しい旅行だった');
	expect(result?.entry.location).toBeNull();
});
