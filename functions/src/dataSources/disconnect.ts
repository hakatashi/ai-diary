import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError, onCall} from 'firebase-functions/https';
import {info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../lib/assertOwner';
import {db} from '../lib/firebaseAdmin';

export const REGION = 'asia-northeast1';

// 認証情報(dataSourceSecrets)を持ちうるデータソースのみ許可する。
// Google Maps タイムラインは手動アップロードのみでOAuth/APIキーを持たないため対象外。
const DISCONNECTABLE_DATA_SOURCE_IDS = new Set([
	'google_health',
	'google_calendar',
	'swarm',
	'immich',
]);

interface DisconnectDataSourceRequest {
	dataSourceId: string;
}

interface DisconnectDataSourceResponse {
	status: 'ok';
}

// 再認証(OAuth再同意・APIキー再入力)ができるよう、保存済みの認証情報を削除し
// dataSourcesのstatusを'disconnected'に戻す。firestore.rulesでクライアントからの
// dataSourceSecrets/dataSources直接操作は遮断されているため、Admin SDK経由のCallable
// Functionとして実装する(AGENTS.mdの「秘密情報管理」方針に従う)。
export const disconnectDataSource = onCall<DisconnectDataSourceRequest>(
	{region: REGION},
	async (request): Promise<DisconnectDataSourceResponse> => {
		assertOwner(request);

		const dataSourceId = request.data?.dataSourceId;
		if (!dataSourceId || !DISCONNECTABLE_DATA_SOURCE_IDS.has(dataSourceId)) {
			throw new HttpsError('invalid-argument', 'Invalid dataSourceId.');
		}

		await db.collection('dataSourceSecrets').doc(dataSourceId).delete();

		const now = Timestamp.now();
		await db.collection('dataSources').doc(dataSourceId).set(
			{
				status: 'disconnected',
				lastSyncError: null,
				syncCursor: null,
				updatedAt: now,
			},
			{merge: true},
		);

		logInfo(`Data source disconnected: ${dataSourceId}`);
		return {status: 'ok'};
	},
);
