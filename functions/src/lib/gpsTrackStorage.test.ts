import {expect, test, vi} from 'vitest';

const saveMock = vi.fn().mockResolvedValue(undefined);
const fileMock = vi.fn().mockReturnValue({save: saveMock});
vi.mock('./firebaseAdmin', () => ({
	getBucket: () => ({file: fileMock}),
}));

const {saveGpsTrack} = await import('./gpsTrackStorage');

test('saveGpsTrack uploads gzip-compressed points and returns summary metadata', async () => {
	const result = await saveGpsTrack('gpsTracks/google_maps_path/test.json.gz', [
		{lat: 35.6805, lng: 139.7671, time: '2026-08-18T08:00:00.000Z'},
		{lat: 35.6812, lng: 139.7674, time: '2026-08-18T08:01:00.000Z'},
	]);

	expect(fileMock).toHaveBeenCalledWith(
		'gpsTracks/google_maps_path/test.json.gz',
	);
	expect(saveMock).toHaveBeenCalledTimes(1);
	expect(result.storagePath).toBe('gpsTracks/google_maps_path/test.json.gz');
	expect(result.pointCount).toBe(2);
	expect(result.distanceMeters).toBeGreaterThan(0);
	expect(result.boundingBox).toEqual({
		minLat: 35.6805,
		maxLat: 35.6812,
		minLng: 139.7671,
		maxLng: 139.7674,
	});
});

test('saveGpsTrack returns zero distance for a single point', async () => {
	const result = await saveGpsTrack(
		'gpsTracks/google_maps_path/single.json.gz',
		[{lat: 35.6805, lng: 139.7671, time: '2026-08-18T08:00:00.000Z'}],
	);

	expect(result.pointCount).toBe(1);
	expect(result.distanceMeters).toBe(0);
});
