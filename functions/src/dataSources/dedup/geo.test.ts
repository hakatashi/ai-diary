import {expect, test} from 'vitest';
import {findBestMatch, haversineDistanceMeters} from './geo.ts';

test('haversineDistanceMeters returns ~0 for identical points', () => {
	const point = {latitude: 35.6812, longitude: 139.7671};
	expect(haversineDistanceMeters(point, point)).toBeCloseTo(0, 3);
});

test('haversineDistanceMeters returns a plausible distance between two known points', () => {
	// 東京駅と渋谷駅(実距離は約6.5km)
	const tokyoStation = {latitude: 35.681236, longitude: 139.767125};
	const shibuyaStation = {latitude: 35.658034, longitude: 139.701636};
	const distance = haversineDistanceMeters(tokyoStation, shibuyaStation);
	expect(distance).toBeGreaterThan(5500);
	expect(distance).toBeLessThan(7500);
});

test('findBestMatch matches a checkin to a visit within the time/distance threshold', () => {
	const checkin = {
		id: 'checkin-1',
		startAtMs: Date.parse('2026-07-01T12:00:00+09:00'),
		location: {latitude: 35.6812, longitude: 139.7671},
	};
	const visits = [
		{
			id: 'visit-far',
			startAtMs: Date.parse('2026-07-01T12:05:00+09:00'),
			location: {latitude: 35.0, longitude: 139.0},
		},
		{
			id: 'visit-close',
			startAtMs: Date.parse('2026-07-01T12:05:00+09:00'),
			location: {latitude: 35.6813, longitude: 139.7672},
		},
	];

	expect(findBestMatch(checkin, visits)?.id).toBe('visit-close');
});

test('findBestMatch returns null when time difference exceeds the window', () => {
	const checkin = {
		id: 'checkin-1',
		startAtMs: Date.parse('2026-07-01T12:00:00+09:00'),
		location: {latitude: 35.6812, longitude: 139.7671},
	};
	const visits = [
		{
			id: 'visit-late',
			startAtMs: Date.parse('2026-07-01T13:00:00+09:00'),
			location: {latitude: 35.6812, longitude: 139.7671},
		},
	];

	expect(findBestMatch(checkin, visits)).toBeNull();
});

test('findBestMatch returns null when checkin has no location', () => {
	const checkin = {
		id: 'checkin-1',
		startAtMs: Date.parse('2026-07-01T12:00:00+09:00'),
		location: null,
	};
	const visits = [
		{
			id: 'visit-1',
			startAtMs: Date.parse('2026-07-01T12:00:00+09:00'),
			location: {latitude: 35.6812, longitude: 139.7671},
		},
	];

	expect(findBestMatch(checkin, visits)).toBeNull();
});
