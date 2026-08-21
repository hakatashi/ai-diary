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

interface GetCheckinsResponse {
	response?: {
		checkins?: {
			count?: number;
			items?: RawCheckin[];
		};
	};
}

export interface CheckinsPage {
	items: RawCheckin[];
	/** サーバー側が把握している全チェックイン件数(ページネーションの終了判定に使う)。 */
	count: number;
}

// `/v2/users/self/historysearch` はPersonalization APIのクレジット制対象で、
// 実接続で 402 credits_exhausted となったため使用しない。代わりにclassic v2 APIの
// `/v2/users/self/checkins` を使う(Foursquareのドキュメントでchekcins系エンドポイントは
// 無料枠のまま継続すると明記されている)。ページネーションは beforeTimestamp ではなく
// offset/limit方式。
// 参照: https://docs.foursquare.com/developer/reference/get-user-checkins
// レスポンスの実フィールドは未検証(ドキュメントからの推定)。初回実接続時に
// Google Health連携同様の調整が必要になる可能性がある。
export const listCheckins = async (
	accessToken: string,
	options: {offset?: number; limit?: number} = {},
): Promise<CheckinsPage> => {
	const url = new URL(`${API_BASE_URL}/users/self/checkins`);
	url.searchParams.set('oauth_token', accessToken);
	url.searchParams.set('v', API_VERSION);
	url.searchParams.set('limit', String(options.limit ?? 250));
	url.searchParams.set('offset', String(options.offset ?? 0));

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Foursquare checkins request failed: ${response.status} ${await response.text()}`,
		);
	}

	const body = (await response.json()) as GetCheckinsResponse;
	return {
		items: body.response?.checkins?.items ?? [],
		count: body.response?.checkins?.count ?? 0,
	};
};
