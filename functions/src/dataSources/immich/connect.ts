import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError, onCall} from 'firebase-functions/https';
import {info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {pingImmich} from './client';

export const REGION = 'asia-northeast1';
export const DATA_SOURCE_ID = 'immich';
export const DISPLAY_NAME = 'Immich (自己ホスト写真管理)';

interface ConnectImmichRequest {
	serverUrl: string;
	apiKey: string;
}

interface ConnectImmichResponse {
	status: 'ok';
	email: string;
}

// ImmichはOAuthを持たないため、ユーザーがサーバーURL・APIキーをブラウザから直接入力する
// (AGENTS.mdの「クライアントから直接Firestoreに書き込ませない」方針に従い、専用の
// Callable Functionを経由してAdmin SDKで書き込む)。
export const connectImmich = onCall<ConnectImmichRequest>(
	{region: REGION},
	async (request): Promise<ConnectImmichResponse> => {
		assertOwner(request);

		const serverUrl = request.data?.serverUrl?.trim().replace(/\/+$/, '');
		const apiKey = request.data?.apiKey?.trim();

		if (!serverUrl || !apiKey) {
			throw new HttpsError(
				'invalid-argument',
				'serverUrl and apiKey are required.',
			);
		}
		if (!/^https?:\/\//.test(serverUrl)) {
			throw new HttpsError(
				'invalid-argument',
				'serverUrl must start with http:// or https://.',
			);
		}

		const identity = await pingImmich(serverUrl, apiKey);
		if (!identity) {
			throw new HttpsError(
				'failed-precondition',
				'Failed to authenticate with the Immich server. Check the server URL and API key.',
			);
		}

		const now = Timestamp.now();
		const secretData: DataSourceSecret = {
			credentialType: 'api_key',
			payload: {apiKey, serverUrl},
			updatedAt: now,
		};
		await db
			.collection('dataSourceSecrets')
			.doc(DATA_SOURCE_ID)
			.set(secretData);

		const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
		const existingDataSource = await dataSourceRef.get();
		await dataSourceRef.set(
			{
				type: DATA_SOURCE_ID,
				displayName: DISPLAY_NAME,
				category: 'photo',
				status: 'connected',
				enabled: true,
				lastSyncedAt: null,
				lastSyncStatus: null,
				lastSyncError: null,
				syncCursor: null,
				updatedAt: now,
				...(existingDataSource.exists ? {} : {createdAt: now}),
			},
			{merge: true},
		);

		logInfo('Immich connected.');
		return {status: 'ok', email: identity.email};
	},
);
