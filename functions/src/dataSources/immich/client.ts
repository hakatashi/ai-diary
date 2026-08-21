// 自己ホストImmichサーバーのREST API。サーバーURLは `dataSourceSecrets/immich` に保存された
// APIベースURL(例: `https://immich.example.com/api`)で、各エンドポイントはこれに相対パスを
// 連結して呼び出す。認証は `x-api-key` ヘッダ。
// 参照: https://immich.app/docs/api/

export interface ImmichAsset {
	id: string;
	type?: string;
	originalFileName?: string;
	fileCreatedAt?: string;
	localDateTime?: string;
	isFavorite?: boolean;
	isArchived?: boolean;
	isTrashed?: boolean;
	visibility?: string;
	duration?: string | null;
	exifInfo?: {
		latitude?: number | null;
		longitude?: number | null;
		city?: string | null;
		country?: string | null;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface SearchMetadataResponse {
	assets?: {
		items?: ImmichAsset[];
		nextPage?: string | null;
	};
}

export interface AssetsPage {
	items: ImmichAsset[];
	nextPage: string | null;
}

/** APIキーが有効か・接続先が正しいImmichサーバーかを確認する。 */
export const pingImmich = async (
	serverUrl: string,
	apiKey: string,
): Promise<{email: string} | null> => {
	const response = await fetch(`${serverUrl}/users/me`, {
		headers: {'x-api-key': apiKey},
	});
	if (!response.ok) {
		return null;
	}
	const body = (await response.json()) as {email?: string};
	return {email: body.email ?? ''};
};

// `takenAfter`/`takenBefore` はISO 8601の日時文字列(タイムゾーンオフセット必須)のみ
// サポートされ、日付のみの文字列は `Validation failed` になることを実接続で確認済み。
export const searchAssets = async (
	serverUrl: string,
	apiKey: string,
	options: {
		takenAfter?: Date;
		takenBefore?: Date;
		page?: number;
		size?: number;
	} = {},
): Promise<AssetsPage> => {
	const response = await fetch(`${serverUrl}/search/metadata`, {
		method: 'POST',
		headers: {
			'x-api-key': apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			page: options.page ?? 1,
			size: options.size ?? 250,
			order: 'desc',
			withExif: true,
			isTrashed: false,
			...(options.takenAfter
				? {takenAfter: options.takenAfter.toISOString()}
				: {}),
			...(options.takenBefore
				? {takenBefore: options.takenBefore.toISOString()}
				: {}),
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Immich search/metadata request failed: ${response.status} ${await response.text()}`,
		);
	}

	const body = (await response.json()) as SearchMetadataResponse;
	return {
		items: body.assets?.items ?? [],
		nextPage: body.assets?.nextPage ?? null,
	};
};
