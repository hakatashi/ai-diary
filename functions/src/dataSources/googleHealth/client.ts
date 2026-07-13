import {OAuth2Client} from 'google-auth-library';
import {googleClientId, googleClientSecret} from '../../lib/secrets';

const API_BASE_URL = 'https://health.googleapis.com/v4';

export type RawExerciseDataPoint = Record<string, unknown>;

interface ListExerciseResponse {
	dataPoints?: RawExerciseDataPoint[];
	nextPageToken?: string;
}

const getAccessToken = async (refreshToken: string): Promise<string> => {
	const client = new OAuth2Client({
		clientId: googleClientId.value(),
		clientSecret: googleClientSecret.value(),
	});
	client.setCredentials({refresh_token: refreshToken});
	const {token} = await client.getAccessToken();
	if (!token) {
		throw new Error('Failed to obtain a Google Health API access token.');
	}
	return token;
};

// dataPoints.list はクエリパラメータではなく AIP-160 形式の filter パラメータで
// 時間範囲を指定する。Session種別のデータタイプ(sleep/ECGを除く)では
// `interval.start_time`/`interval.end_time` はフィルタ不可(INVALID_DATA_POINT_FILTER)で、
// `{type}.interval.civil_start_time` のみがサポートされる(値はcivil dateのプレーンな日付文字列)。
// 参照: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
const civilDateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Tokyo',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

const buildTimeRangeFilter = (startTime: Date, endTime: Date): string =>
	`exercise.interval.civil_start_time >= "${civilDateFormatter.format(startTime)}" AND exercise.interval.civil_start_time <= "${civilDateFormatter.format(endTime)}"`;

export const listExercises = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawExerciseDataPoint[]> => {
	const accessToken = await getAccessToken(refreshToken);
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
