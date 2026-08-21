import {HttpsError, onCall} from 'firebase-functions/https';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {DATA_SOURCE_ID} from './connect';

export const REGION = 'asia-northeast1';

interface GetImmichThumbnailRequest {
	assetId: string;
	size?: 'thumbnail' | 'preview';
}

interface GetImmichThumbnailResponse {
	dataUrl: string;
}

// Immichはユーザーの自己ホストサーバー上にあり、APIキー(functions側のみ保持)による
// 認証が必要なため、クライアントから直接サムネイルURLを叩くことはできない。
// onCallでバイナリをbase64のdata URLとして返すことで、Callable Functions中心設計
// (AGENTS.md参照)を崩さずに画像を取得する。写真枚数・解像度は個人利用規模のため
// base64化のオーバーヘッドは許容範囲と判断した。
export const getImmichThumbnail = onCall<GetImmichThumbnailRequest>(
	{region: REGION},
	async (request): Promise<GetImmichThumbnailResponse> => {
		assertOwner(request);

		const assetId = request.data?.assetId;
		const size = request.data?.size === 'preview' ? 'preview' : 'thumbnail';
		if (!assetId) {
			throw new HttpsError('invalid-argument', 'assetId is required.');
		}

		const secretDoc = await db
			.collection('dataSourceSecrets')
			.doc(DATA_SOURCE_ID)
			.get();
		if (!secretDoc.exists) {
			throw new HttpsError('failed-precondition', 'Immich is not connected.');
		}

		const {apiKey, serverUrl} = (secretDoc.data() as DataSourceSecret).payload;
		if (!apiKey || !serverUrl) {
			throw new HttpsError(
				'failed-precondition',
				'Immich secret is missing an apiKey or serverUrl.',
			);
		}

		const response = await fetch(
			`${serverUrl}/assets/${assetId}/thumbnail?size=${size}`,
			{headers: {'x-api-key': apiKey}},
		);
		if (!response.ok) {
			throw new HttpsError(
				'internal',
				`Immich thumbnail request failed: ${response.status}`,
			);
		}

		const contentType = response.headers.get('content-type') ?? 'image/jpeg';
		const buffer = Buffer.from(await response.arrayBuffer());
		return {dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`};
	},
);
