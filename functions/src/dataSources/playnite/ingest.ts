import {timingSafeEqual} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {onRequest} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {DATA_SOURCE_ID} from './connect';
import {normalizePlayniteSession, type RawPlayniteSession} from './normalize';

export const REGION = 'asia-northeast1';

// トークン長が一致しない場合にtimingSafeEqualが例外を投げるため、比較前に長さを揃える。
const safeCompare = (presented: string, expected: string): boolean => {
	const presentedBuf = Buffer.from(presented);
	const expectedBuf = Buffer.from(expected);
	if (presentedBuf.length !== expectedBuf.length) {
		return false;
	}
	return timingSafeEqual(presentedBuf, expectedBuf);
};

interface IngestRequestBody {
	gameId?: unknown;
	gameName?: unknown;
	source?: unknown;
	startAt?: unknown;
	endAt?: unknown;
	elapsedSeconds?: unknown;
}

// Playnite拡張(ローカルPowerShellスクリプト)からOnGameStopped発火時にPOSTされる。
// ブラウザの生ナビゲーションではないがFirebase Authのインタラクティブサインインが
// できない非対話クライアントであるため、onCallではなくBearerトークン認証の
// onRequestにする(詳細: docs/adr/0012-playnite-game-session-ingest.md)。
export const recordPlayniteSession = onRequest(
	{region: REGION},
	async (req, res) => {
		if (req.method !== 'POST') {
			res.status(405).send('Method Not Allowed');
			return;
		}

		const authHeader = req.get('authorization') ?? '';
		const presentedToken = authHeader.startsWith('Bearer ')
			? authHeader.slice('Bearer '.length)
			: '';

		if (!presentedToken) {
			res.status(401).send('Missing bearer token.');
			return;
		}

		const secretDoc = await db
			.collection('dataSourceSecrets')
			.doc(DATA_SOURCE_ID)
			.get();
		if (!secretDoc.exists) {
			res.status(401).send('Playnite is not connected.');
			return;
		}
		const secret = secretDoc.data() as DataSourceSecret;
		const expectedToken = secret.payload.apiKey;
		if (!expectedToken || !safeCompare(presentedToken, expectedToken)) {
			res.status(401).send('Invalid bearer token.');
			return;
		}

		const body = req.body as IngestRequestBody;
		if (
			typeof body.gameId !== 'string' ||
			typeof body.gameName !== 'string' ||
			typeof body.startAt !== 'string' ||
			typeof body.endAt !== 'string' ||
			typeof body.elapsedSeconds !== 'number' ||
			body.elapsedSeconds <= 0
		) {
			res.status(400).send('Invalid request body.');
			return;
		}

		try {
			const raw: RawPlayniteSession = {
				gameId: body.gameId,
				gameName: body.gameName,
				source: typeof body.source === 'string' ? body.source : null,
				startAt: body.startAt,
				endAt: body.endAt,
				elapsedSeconds: body.elapsedSeconds,
			};
			const {id, entry} = normalizePlayniteSession(raw);
			const now = Timestamp.now();
			const ref = db.collection('logEntries').doc(id);
			const existing = await ref.get();
			await ref.set(
				{
					...entry,
					dataSourceId: DATA_SOURCE_ID,
					updatedAt: now,
					...(existing.exists ? {} : {createdAt: now}),
				},
				{merge: true},
			);

			await db
				.collection('dataSources')
				.doc(DATA_SOURCE_ID)
				.set(
					{
						status: 'connected',
						lastSyncedAt: now,
						lastSyncStatus: 'success',
						lastSyncError: null,
						updatedAt: now,
					},
					{merge: true},
				);

			logInfo(`Recorded Playnite session: ${body.gameName}`);
			res.status(200).json({status: 'ok'});
		} catch (err) {
			logError('Failed to record Playnite session', err);
			res.status(500).send('Internal error.');
		}
	},
);
