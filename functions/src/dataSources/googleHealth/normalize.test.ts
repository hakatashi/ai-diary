import {expect, test, vi} from 'vitest';

const saveGpsTrackMock = vi.fn().mockResolvedValue({
	storagePath: 'gpsTracks/google_health_exercise/mock.json.gz',
	pointCount: 2,
	distanceMeters: 42,
	boundingBox: {minLat: 35.68, maxLat: 35.69, minLng: 139.76, maxLng: 139.77},
});
vi.mock('../../lib/gpsTrackStorage', () => ({
	saveGpsTrack: saveGpsTrackMock,
}));

const {
	attachGpsTrack,
	getDataPointName,
	mayHaveGpsTrack,
	normalizeExercise,
	normalizeNutritionLog,
	normalizeSleep,
	normalizeWeight,
} = await import('./normalize.ts');

const baseRaw = {
	name: 'users/me/dataTypes/exercise/dataPoints/123',
	exercise: {
		interval: {
			startTime: '2026-07-05T01:00:00.000Z',
			endTime: '2026-07-05T01:30:00.000Z',
		},
		exerciseType: 'RUNNING',
		metricsSummary: {
			caloriesKcal: 200,
			distanceMillimeters: 5000000,
		},
	},
};

test('normalizeExercise builds a logEntry from an exercise data point', () => {
	const {id, entry} = normalizeExercise(baseRaw);
	expect(id).toMatch(/^[0-9a-f]{64}$/);
	expect(entry.sourceType).toBe('google_health_exercise');
	expect(entry.title).toBe('ランニング');
	expect(entry.metrics?.distanceMeters).toBe(5000);
	expect(entry.location).toBeNull();
});

test('mayHaveGpsTrack is true when the exercise has a distance metric', () => {
	expect(mayHaveGpsTrack(baseRaw)).toBe(true);
});

test('mayHaveGpsTrack is false for exercises without a distance metric (e.g. strength training)', () => {
	const raw = {
		name: 'users/me/dataTypes/exercise/dataPoints/456',
		exercise: {
			interval: {startTime: '2026-07-05T01:00:00.000Z'},
			exerciseType: 'STRENGTH_TRAINING',
			metricsSummary: {caloriesKcal: 100},
		},
	};
	expect(mayHaveGpsTrack(raw)).toBe(false);
});

test('getDataPointName returns the dataPoint resource name', () => {
	expect(getDataPointName(baseRaw)).toBe(
		'users/me/dataTypes/exercise/dataPoints/123',
	);
});

test('attachGpsTrack uploads points via saveGpsTrack and merges location/raw.gpsTrack', async () => {
	const normalized = normalizeExercise(baseRaw);
	const result = await attachGpsTrack(normalized, [
		{lat: 35.68, lng: 139.76, time: '2026-07-05T01:00:00.000Z'},
		{lat: 35.69, lng: 139.77, time: '2026-07-05T01:01:00.000Z'},
	]);

	expect(saveGpsTrackMock).toHaveBeenCalledWith(
		`gpsTracks/google_health_exercise/${normalized.id}.json.gz`,
		[
			{lat: 35.68, lng: 139.76, time: '2026-07-05T01:00:00.000Z'},
			{lat: 35.69, lng: 139.77, time: '2026-07-05T01:01:00.000Z'},
		],
	);
	expect(result.entry.location?.latitude).toBeCloseTo(35.68);
	expect(result.entry.location?.longitude).toBeCloseTo(139.76);
	expect(result.entry.raw.gpsTrack).toEqual({
		storagePath: 'gpsTracks/google_health_exercise/mock.json.gz',
		pointCount: 2,
		boundingBox: {minLat: 35.68, maxLat: 35.69, minLng: 139.76, maxLng: 139.77},
	});
	// 元のexerciseの生データは失わずraw内に保持される。
	expect(result.entry.raw.exercise).toEqual(baseRaw.exercise);
});

test('normalizeNutritionLog builds a logEntry from a nutrition-log data point', () => {
	const raw = {
		name: 'users/me/dataTypes/nutrition-log/dataPoints/789',
		nutritionLog: {
			interval: {
				startTime: '2026-08-22T10:00:00.000Z',
				endTime: '2026-08-22T10:01:00.000Z',
			},
			mealType: 'DINNER',
			foodDisplayName: '夕食(塩麹揚げ・十六穀米)',
			energy: {value: 1114},
		},
	};
	const {id, entry} = normalizeNutritionLog(raw);
	expect(id).toMatch(/^[0-9a-f]{64}$/);
	expect(entry.sourceType).toBe('google_health_nutrition');
	expect(entry.category).toBe('nutrition');
	expect(entry.title).toBe('夕食');
	expect(entry.summary).toBe('夕食(塩麹揚げ・十六穀米)');
	expect(entry.metrics?.calories).toBe(1114);
});

test('normalizeNutritionLog falls back to a generic title for an unknown meal type', () => {
	const raw = {
		name: 'users/me/dataTypes/nutrition-log/dataPoints/790',
		nutritionLog: {
			interval: {startTime: '2026-08-22T10:00:00.000Z'},
		},
	};
	const {entry} = normalizeNutritionLog(raw);
	expect(entry.title).toBe('食事');
	expect(entry.metrics).toBeNull();
});

test('normalizeSleep builds a logEntry from a sleep data point with stage summary', () => {
	const raw = {
		name: 'users/me/dataTypes/sleep/dataPoints/456',
		sleep: {
			interval: {
				startTime: '2026-08-21T21:09:00.000Z',
				endTime: '2026-08-22T02:00:00.000Z',
			},
			summary: {
				minutesAsleep: '284',
				stagesSummary: [
					{type: 'LIGHT', minutes: '158'},
					{type: 'DEEP', minutes: '44'},
				],
			},
		},
	};
	const {id, entry} = normalizeSleep(raw);
	expect(id).toMatch(/^[0-9a-f]{64}$/);
	expect(entry.sourceType).toBe('google_health_sleep');
	expect(entry.category).toBe('sleep');
	expect(entry.title).toBe('睡眠');
	expect(entry.summary).toBe('浅い睡眠 158分 / 深い睡眠 44分');
	expect(entry.metrics?.durationMinutes).toBe(284);
});

test('normalizeWeight builds a logEntry from a weight data point', () => {
	const raw = {
		name: 'users/me/dataTypes/weight/dataPoints/321',
		weight: {
			sampleTime: {physicalTime: '2026-08-22T22:00:00.000Z'},
			weightGrams: 65200,
		},
	};
	const {id, entry} = normalizeWeight(raw);
	expect(id).toMatch(/^[0-9a-f]{64}$/);
	expect(entry.sourceType).toBe('google_health_weight');
	expect(entry.category).toBe('weight');
	expect(entry.title).toBe('体重');
	expect(entry.metrics?.weightKilograms).toBeCloseTo(65.2);
});
