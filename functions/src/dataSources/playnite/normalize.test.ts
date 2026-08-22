import {expect, test} from 'vitest';
import {normalizePlatform, normalizePlayniteSession} from './normalize.ts';

test('normalizePlatform maps known store names', () => {
	expect(normalizePlatform('Steam')).toBe('steam');
	expect(normalizePlatform('Epic Games Store')).toBe('epic');
	expect(normalizePlatform('GOG')).toBe('gog');
	expect(normalizePlatform('Xbox')).toBe('xbox');
	expect(normalizePlatform('Ubisoft Connect')).toBe('other');
});

test('normalizePlatform treats missing source as standalone', () => {
	expect(normalizePlatform(null)).toBe('standalone');
	expect(normalizePlatform(undefined)).toBe('standalone');
	expect(normalizePlatform('')).toBe('standalone');
});

test('normalizePlayniteSession derives duration, date and metadata', () => {
	const {entry} = normalizePlayniteSession({
		gameId: 'aaf3bea8-7e22-48a8-bd4f-bd637b4a45ea',
		gameName: 'Hollow Knight',
		source: 'Steam',
		startAt: '2026-08-21T10:00:00.000Z',
		endAt: '2026-08-21T11:30:00.000Z',
		elapsedSeconds: 5400,
	});

	expect(entry.sourceType).toBe('playnite_session');
	expect(entry.category).toBe('game');
	expect(entry.date).toBe('2026-08-21');
	expect(entry.title).toBe('Hollow Knight');
	expect(entry.summary).toBe('Steam');
	expect(entry.metrics?.durationMinutes).toBe(90);
	expect(entry.startAt.toDate().toISOString()).toBe('2026-08-21T10:00:00.000Z');
	expect(entry.endAt?.toDate().toISOString()).toBe('2026-08-21T11:30:00.000Z');
	expect(entry.location).toBeNull();
	expect(entry.raw).toMatchObject({
		gameName: 'Hollow Knight',
		platform: 'steam',
		playniteGameId: 'aaf3bea8-7e22-48a8-bd4f-bd637b4a45ea',
		elapsedSeconds: 5400,
	});
});

test('normalizePlayniteSession produces a deterministic id for the same game/start pair', () => {
	const first = normalizePlayniteSession({
		gameId: 'same-id',
		gameName: 'Celeste',
		source: null,
		startAt: '2026-01-01T00:00:00.000Z',
		endAt: '2026-01-01T01:00:00.000Z',
		elapsedSeconds: 3600,
	});
	const second = normalizePlayniteSession({
		gameId: 'same-id',
		gameName: 'Celeste',
		source: null,
		startAt: '2026-01-01T00:00:00.000Z',
		endAt: '2026-01-01T01:00:00.000Z',
		elapsedSeconds: 3600,
	});
	expect(first.id).toBe(second.id);
	expect(first.entry.summary).toBe('スタンドアロン');
});
