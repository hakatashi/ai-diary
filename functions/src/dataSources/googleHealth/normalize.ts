import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import type {RawExerciseDataPoint} from './client';

const TIME_ZONE = 'Asia/Tokyo';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

interface ExerciseInterval {
	startTime: string;
	endTime?: string;
}

interface ExerciseMetricsSummary {
	caloriesKcal?: number;
	distanceMillimeters?: number;
	averageHeartRateBeatsPerMinute?: number;
}

interface ExerciseData {
	interval: ExerciseInterval;
	exerciseType?: string;
	metricsSummary?: ExerciseMetricsSummary;
}

interface ExerciseDataPoint {
	name?: string;
	exercise: ExerciseData;
}

const EXERCISE_TYPE_LABELS: Record<string, string> = {
	RUNNING: 'ランニング',
	WALKING: 'ウォーキング',
	CYCLING: 'サイクリング',
	SWIMMING: '水泳',
	STRENGTH_TRAINING: '筋力トレーニング',
	YOGA: 'ヨガ',
	HIKING: 'ハイキング',
	ELLIPTICAL: 'エリプティカル',
	ROWING: 'ローイング',
};

const formatExerciseType = (exerciseType: string | undefined): string => {
	if (!exerciseType) {
		return 'エクササイズ';
	}
	if (EXERCISE_TYPE_LABELS[exerciseType]) {
		return EXERCISE_TYPE_LABELS[exerciseType];
	}
	return exerciseType
		.toLowerCase()
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
};

export interface NormalizedExercise {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// レスポンスの実際のJSONスキーマ(users.dataTypes.dataPoints リソース)に基づく変換。
// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
export const normalizeExercise = (
	raw: RawExerciseDataPoint,
): NormalizedExercise => {
	const point = raw as unknown as ExerciseDataPoint;
	const {interval, exerciseType, metricsSummary} = point.exercise;

	const startDate = new Date(interval.startTime);
	const endDate = interval.endTime ? new Date(interval.endTime) : null;

	const sourceRecordId =
		point.name ?? `${interval.startTime}_${interval.endTime ?? ''}`;

	const durationMinutes = endDate
		? Math.round((endDate.getTime() - startDate.getTime()) / 60000)
		: undefined;
	const distanceMeters =
		metricsSummary?.distanceMillimeters !== undefined
			? metricsSummary.distanceMillimeters / 1000
			: undefined;
	const calories = metricsSummary?.caloriesKcal;
	const avgHeartRate = metricsSummary?.averageHeartRateBeatsPerMinute;

	const hasMetrics =
		durationMinutes !== undefined ||
		distanceMeters !== undefined ||
		calories !== undefined ||
		avgHeartRate !== undefined;

	const id = createHash('sha256')
		.update(`google_health_exercise:${sourceRecordId}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_health_exercise',
			category: 'exercise',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt: endDate ? Timestamp.fromDate(endDate) : null,
			title: formatExerciseType(exerciseType),
			summary: null,
			metrics: hasMetrics
				? {
						...(durationMinutes !== undefined && {durationMinutes}),
						...(distanceMeters !== undefined && {distanceMeters}),
						...(calories !== undefined && {calories}),
						...(avgHeartRate !== undefined && {avgHeartRate}),
					}
				: null,
			location: null,
			raw,
			sourceRecordId,
		},
	};
};
