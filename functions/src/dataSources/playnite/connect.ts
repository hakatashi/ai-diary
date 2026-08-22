import {randomBytes} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {onCall} from 'firebase-functions/https';
import {info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';

export const REGION = 'asia-northeast1';
export const DATA_SOURCE_ID = 'playnite';
export const DISPLAY_NAME = 'Playnite (PCゲームプレイ記録)';

interface ConnectPlayniteResponse {
	status: 'ok';
	ingestToken: string;
}

// Playnite拡張(PowerShellスクリプト)はブラウザではないためFirebase Authで
// インタラクティブサインインできない。Immichとは逆にai-diary側がingestトークンを
// 発行し、recordPlayniteSession(onRequest)がBearerトークンとして検証する方式に
// する(詳細: docs/adr/0012-playnite-game-session-ingest.md)。呼び出すたびに
// トークンを再発行するため、再接続すると古いトークンは無効になる。
export const connectPlaynite = onCall(
	{region: REGION},
	async (request): Promise<ConnectPlayniteResponse> => {
		assertOwner(request);

		const ingestToken = randomBytes(32).toString('hex');
		const now = Timestamp.now();
		const secretData: DataSourceSecret = {
			credentialType: 'api_key',
			payload: {apiKey: ingestToken},
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
				category: 'game',
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

		logInfo('Playnite connected (ingest token issued).');
		return {status: 'ok', ingestToken};
	},
);
