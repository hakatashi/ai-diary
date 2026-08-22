import {createHash} from 'node:crypto';
import {GeoPoint, Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import {type GpsTrackPoint, saveGpsTrack} from '../../lib/gpsTrackStorage';
import type {
	RawExerciseDataPoint,
	RawNutritionDataPoint,
	RawSleepDataPoint,
	RawWeightDataPoint,
} from './client';

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

// exportExerciseTcx呼び出しはAPI往復コストがあるため、GPSが存在する見込みが薄い
// エクササイズ(手動ログ・屋内種目等、距離メトリクスを持たないもの)には試みない。
// Google Health APIのExerciseMetadataにGPS有無を示す専用フィールドがあるかは実接続で
// 確認できなかったため、距離メトリクスの有無という保守的な指標で絞り込む。
export const mayHaveGpsTrack = (raw: RawExerciseDataPoint): boolean => {
	const point = raw as unknown as ExerciseDataPoint;
	return point.exercise.metricsSummary?.distanceMillimeters !== undefined;
};

export const getDataPointName = (
	raw: RawExerciseDataPoint,
): string | undefined => {
	const point = raw as unknown as ExerciseDataPoint;
	return point.name;
};

/**
 * TCXエクスポートから得たGPS点列をFirebase Storageに保存し、そのメタデータ
 * (storagePath/pointCount/boundingBox)とlocationを正規化済みエントリに合成する。
 * 点列本体はlogEntryに含めない(gpsTrackStorage.tsのsaveGpsTrack参照)。
 */
export const attachGpsTrack = async (
	normalized: NormalizedExercise,
	points: GpsTrackPoint[],
): Promise<NormalizedExercise> => {
	const track = await saveGpsTrack(
		`gpsTracks/google_health_exercise/${normalized.id}.json.gz`,
		points,
	);

	return {
		id: normalized.id,
		entry: {
			...normalized.entry,
			location: new GeoPoint(points[0].lat, points[0].lng),
			raw: {
				...normalized.entry.raw,
				gpsTrack: {
					storagePath: track.storagePath,
					pointCount: track.pointCount,
					boundingBox: track.boundingBox,
				},
			},
		},
	};
};

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
		point.name ??
		`${exerciseType ?? 'unknown'}_${interval.startTime}_${interval.endTime ?? ''}`;

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

// nutrition-log, sleep, weightのSessionTimeInterval/int64フィールドはJSON上では
// 文字列として表現される(protobuf int64のJSONマッピング)ため、数値化にはNumber()を使う。
const parseInt64 = (value: string | undefined): number | undefined =>
	value === undefined ? undefined : Number(value);

interface SessionTimeInterval {
	startTime: string;
	endTime?: string;
}

const MEAL_TYPE_LABELS: Record<string, string> = {
	BREAKFAST: '朝食',
	BRUNCH: 'ブランチ',
	LUNCH: '昼食',
	SNACK: '間食',
	DINNER: '夕食',
	DESSERT: 'デザート',
	ALCOHOL: '飲酒',
	JUICE: 'ジュース',
	TEA: 'お茶',
	WATER: '水分補給',
};

const formatMealType = (mealType: string | undefined): string =>
	(mealType && MEAL_TYPE_LABELS[mealType]) || '食事';

interface EnergyQuantity {
	value?: number;
}

interface NutritionLogData {
	interval: SessionTimeInterval;
	mealType?: string;
	foodDisplayName?: string;
	energy?: EnergyQuantity;
}

interface NutritionDataPoint {
	name?: string;
	nutritionLog: NutritionLogData;
}

export interface NormalizedNutritionLog {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
// energy.valueは実接続で確認した限りkcal単位で返る(EnergyUnitがJOULE等になるケースは未確認)。
export const normalizeNutritionLog = (
	raw: RawNutritionDataPoint,
): NormalizedNutritionLog => {
	const point = raw as unknown as NutritionDataPoint;
	const {interval, mealType, foodDisplayName, energy} = point.nutritionLog;

	const startDate = new Date(interval.startTime);
	const endDate = interval.endTime ? new Date(interval.endTime) : null;

	const sourceRecordId = point.name ?? `nutrition_${interval.startTime}`;
	const calories = energy?.value;

	const id = createHash('sha256')
		.update(`google_health_nutrition:${sourceRecordId}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_health_nutrition',
			category: 'nutrition',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt: endDate ? Timestamp.fromDate(endDate) : null,
			title: formatMealType(mealType),
			summary: foodDisplayName ?? null,
			metrics: calories !== undefined ? {calories} : null,
			location: null,
			raw,
			sourceRecordId,
		},
	};
};

const SLEEP_STAGE_LABELS: Record<string, string> = {
	LIGHT: '浅い睡眠',
	DEEP: '深い睡眠',
	REM: 'レム睡眠',
	AWAKE: '覚醒',
	RESTLESS: '浅い眠り',
	ASLEEP: '睡眠',
};

interface SleepStageSummary {
	type?: string;
	minutes?: string;
}

interface SleepSummary {
	stagesSummary?: SleepStageSummary[];
	minutesAsleep?: string;
}

interface SleepData {
	interval: SessionTimeInterval;
	summary?: SleepSummary;
}

interface SleepDataPoint {
	name?: string;
	sleep: SleepData;
}

export interface NormalizedSleep {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

const formatSleepSummary = (
	summary: SleepSummary | undefined,
): string | null => {
	const stages = summary?.stagesSummary;
	if (!stages || stages.length === 0) {
		return null;
	}
	return stages
		.map((stage) => {
			const minutes = parseInt64(stage.minutes);
			const label =
				(stage.type && SLEEP_STAGE_LABELS[stage.type]) || stage.type;
			return minutes !== undefined ? `${label} ${minutes}分` : null;
		})
		.filter((text): text is string => text !== null)
		.join(' / ');
};

// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
export const normalizeSleep = (raw: RawSleepDataPoint): NormalizedSleep => {
	const point = raw as unknown as SleepDataPoint;
	const {interval, summary} = point.sleep;

	const startDate = new Date(interval.startTime);
	const endDate = interval.endTime ? new Date(interval.endTime) : null;

	const sourceRecordId = point.name ?? `sleep_${interval.startTime}`;
	const minutesAsleep = parseInt64(summary?.minutesAsleep);

	const id = createHash('sha256')
		.update(`google_health_sleep:${sourceRecordId}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_health_sleep',
			category: 'sleep',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt: endDate ? Timestamp.fromDate(endDate) : null,
			title: '睡眠',
			summary: formatSleepSummary(summary),
			metrics:
				minutesAsleep !== undefined ? {durationMinutes: minutesAsleep} : null,
			location: null,
			raw,
			sourceRecordId,
		},
	};
};

interface WeightData {
	sampleTime: {physicalTime: string};
	notes?: string;
	weightGrams: number;
}

interface WeightDataPoint {
	name?: string;
	weight: WeightData;
}

export interface NormalizedWeight {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
export const normalizeWeight = (raw: RawWeightDataPoint): NormalizedWeight => {
	const point = raw as unknown as WeightDataPoint;
	const {sampleTime, notes, weightGrams} = point.weight;

	const sampleDate = new Date(sampleTime.physicalTime);
	const sourceRecordId = point.name ?? `weight_${sampleTime.physicalTime}`;

	const id = createHash('sha256')
		.update(`google_health_weight:${sourceRecordId}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'google_health_weight',
			category: 'weight',
			date: dateFormatter.format(sampleDate),
			startAt: Timestamp.fromDate(sampleDate),
			endAt: null,
			title: '体重',
			summary: notes ?? null,
			metrics: {weightKilograms: weightGrams / 1000},
			location: null,
			raw,
			sourceRecordId,
		},
	};
};
