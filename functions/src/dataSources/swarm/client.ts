const API_BASE_URL = 'https://api.foursquare.com/v2';
// Foursquare v2 API の `v` パラメータ(APIバージョン、YYYYMMDD形式)。
const API_VERSION = '20240101';

export interface RawCheckin {
	id: string;
	// Unix秒。
	createdAt?: number;
	shout?: string;
	venue?: {
		id?: string;
		name?: string;
		location?: {
			lat?: number;
			lng?: number;
			address?: string;
			city?: string;
			country?: string;
		};
		categories?: Array<{name?: string; primary?: boolean}>;
	};
	[key: string]: unknown;
}

interface HistorySearchResponse {
	response?: {
		items?: RawCheckin[];
	};
}

// 参照: https://zenn.dev/h4y4bus4/scraps/79a3ffd301e89e
// レスポンスの実フィールドは未検証(ドキュメント/ブログ記事からの推定)。
// 初回実接続時にGoogle Health連携同様の調整が必要になる可能性がある。
export const listCheckins = async (
	accessToken: string,
	options: {beforeTimestamp?: number; limit?: number} = {},
): Promise<RawCheckin[]> => {
	const url = new URL(`${API_BASE_URL}/users/self/historysearch`);
	url.searchParams.set('oauth_token', accessToken);
	url.searchParams.set('v', API_VERSION);
	url.searchParams.set('limit', String(options.limit ?? 250));
	if (options.beforeTimestamp) {
		url.searchParams.set('beforeTimestamp', String(options.beforeTimestamp));
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Foursquare historysearch request failed: ${response.status} ${await response.text()}`,
		);
	}

	const body = (await response.json()) as HistorySearchResponse;
	return body.response?.items ?? [];
};
