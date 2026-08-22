import {error as logError} from 'firebase-functions/logger';
import {getGoogleAccessToken} from '../../lib/googleOAuth';

const API_BASE_URL = 'https://health.googleapis.com/v4';

export type RawExerciseDataPoint = Record<string, unknown>;
export type RawNutritionDataPoint = Record<string, unknown>;
export type RawSleepDataPoint = Record<string, unknown>;
export type RawWeightDataPoint = Record<string, unknown>;

interface ListDataPointsResponse<T> {
	dataPoints?: T[];
	nextPageToken?: string;
}

// dataPoints.list はクエリパラメータではなく AIP-160 形式の filter パラメータで
// 時間範囲を指定する。Session種別のデータタイプ(sleep/ECGを除く)では
// `interval.start_time`/`interval.end_time` はフィルタ不可(INVALID_DATA_POINT_FILTER)で、
// `{type}.interval.civil_start_time` のみがサポートされる(値はcivil dateのプレーンな日付文字列)。
// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
//
// さらに `civil_start_time` は GREATER_THAN_EQUALS と LESS_THAN の2つのコンパレータしか
// サポートしない(`<=` を使うと INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR エラーになる、
// 実接続で確認済み)。同期対象の最終日を含めるため、上限には endTime の翌日の日付を
// 排他境界(`<`)として使う。
const civilDateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Tokyo',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

const nextCivilDate = (dateStr: string): string => {
	const [year, month, day] = dateStr.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day));
	shifted.setUTCDate(shifted.getUTCDate() + 1);
	return shifted.toISOString().slice(0, 10);
};

// セッション種別のデータタイプ(exercise, nutrition-log等。sleep/ECGを除く)向けの
// civil date範囲フィルタ。`{fieldPath} >= "YYYY-MM-DD" AND {fieldPath} < "YYYY-MM-DD"` の形。
const buildCivilDateRangeFilter = (
	fieldPath: string,
	startTime: Date,
	endTime: Date,
): string => {
	const startDate = civilDateFormatter.format(startTime);
	const exclusiveEndDate = nextCivilDate(civilDateFormatter.format(endTime));
	return `${fieldPath} >= "${startDate}" AND ${fieldPath} < "${exclusiveEndDate}"`;
};

// sleep(セッション種別の例外)・weight(サンプル種別)向けの、civil dateではなく
// RFC 3339タイムスタンプそのものによる範囲フィルタ。
// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
const buildTimestampRangeFilter = (
	fieldPath: string,
	startTime: Date,
	endTime: Date,
): string =>
	`${fieldPath} >= "${startTime.toISOString()}" AND ${fieldPath} < "${endTime.toISOString()}"`;

const listDataPoints = async <T>(
	refreshToken: string,
	dataTypeId: string,
	filter: string,
): Promise<T[]> => {
	const accessToken = await getGoogleAccessToken(refreshToken);
	const results: T[] = [];
	let pageToken: string | undefined;

	do {
		const url = new URL(
			`${API_BASE_URL}/users/me/dataTypes/${dataTypeId}/dataPoints`,
		);
		url.searchParams.set('filter', filter);
		if (pageToken) {
			url.searchParams.set('pageToken', pageToken);
		}

		const response = await fetch(url, {
			headers: {Authorization: `Bearer ${accessToken}`},
		});

		if (!response.ok) {
			throw new Error(
				`Google Health API request failed: ${response.status} ${await response.text()}`,
			);
		}

		const body = (await response.json()) as ListDataPointsResponse<T>;
		results.push(...(body.dataPoints ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);

	return results;
};

export const listExercises = (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawExerciseDataPoint[]> =>
	listDataPoints<RawExerciseDataPoint>(
		refreshToken,
		'exercise',
		buildCivilDateRangeFilter(
			'exercise.interval.civil_start_time',
			startTime,
			endTime,
		),
	);

// nutrition-logはexerciseと同じセッション種別のデータタイプのため、
// civil_start_timeによる範囲フィルタのみサポートされる(実接続で確認した挙動と同様の制約と推測)。
export const listNutritionLogs = (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawNutritionDataPoint[]> =>
	listDataPoints<RawNutritionDataPoint>(
		refreshToken,
		'nutrition-log',
		buildCivilDateRangeFilter(
			'nutrition-log.interval.civil_start_time',
			startTime,
			endTime,
		),
	);

// sleepはセッション種別の例外で、civil dateではなく素のinterval.end_timeでフィルタ可能
// (公式リファレンスに明記)。
export const listSleepSessions = (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawSleepDataPoint[]> =>
	listDataPoints<RawSleepDataPoint>(
		refreshToken,
		'sleep',
		buildTimestampRangeFilter('sleep.interval.end_time', startTime, endTime),
	);

// weightはサンプル種別のデータタイプで、sample_time.physical_timeでフィルタする。
export const listWeights = (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawWeightDataPoint[]> =>
	listDataPoints<RawWeightDataPoint>(
		refreshToken,
		'weight',
		buildTimestampRangeFilter(
			'weight.sample_time.physical_time',
			startTime,
			endTime,
		),
	);

// exercise dataPointのGPSトラックはカスタムメソッド exportExerciseTcx で
// TCX(Training Center XML)形式として取得する(listExercises/dataPointsのレスポンスには
// 座標は含まれない)。`?alt=media` を付けないとTCX本体ではなく
// `{tcxData: "..."}` というJSONラッパーが返るため必ず付与する。
// このメソッドは activity_and_fitness スコープに加えて location スコープが必要
// (実接続調査で判明。未同意の場合は403になるため呼び出し元でnull扱いにフォールバックする)。
export const fetchExerciseTcx = async (
	refreshToken: string,
	dataPointName: string,
): Promise<string | null> => {
	const accessToken = await getGoogleAccessToken(refreshToken);
	const url = new URL(`${API_BASE_URL}/${dataPointName}:exportExerciseTcx`);
	url.searchParams.set('alt', 'media');

	const response = await fetch(url, {
		headers: {Authorization: `Bearer ${accessToken}`},
	});

	if (!response.ok) {
		logError(
			`Google Health TCX export failed for ${dataPointName}: ${response.status} ${await response.text()}`,
		);
		return null;
	}

	return await response.text();
};
