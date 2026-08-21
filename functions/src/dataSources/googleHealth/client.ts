import {getGoogleAccessToken} from '../../lib/googleOAuth';

const API_BASE_URL = 'https://health.googleapis.com/v4';

export type RawExerciseDataPoint = Record<string, unknown>;

interface ListExerciseResponse {
	dataPoints?: RawExerciseDataPoint[];
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

const buildTimeRangeFilter = (startTime: Date, endTime: Date): string => {
	const startDate = civilDateFormatter.format(startTime);
	const exclusiveEndDate = nextCivilDate(civilDateFormatter.format(endTime));
	return `exercise.interval.civil_start_time >= "${startDate}" AND exercise.interval.civil_start_time < "${exclusiveEndDate}"`;
};

export const listExercises = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawExerciseDataPoint[]> => {
	const accessToken = await getGoogleAccessToken(refreshToken);
	const results: RawExerciseDataPoint[] = [];
	let pageToken: string | undefined;

	do {
		const url = new URL(
			`${API_BASE_URL}/users/me/dataTypes/exercise/dataPoints`,
		);
		url.searchParams.set('filter', buildTimeRangeFilter(startTime, endTime));
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

		const body = (await response.json()) as ListExerciseResponse;
		results.push(...(body.dataPoints ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);

	return results;
};
