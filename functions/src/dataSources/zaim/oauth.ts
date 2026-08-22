import {Timestamp} from 'firebase-admin/firestore';
import {onCall, onRequest} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import {zaimConsumerKey, zaimConsumerSecret} from '../../lib/secrets';
import {
	buildZaimAuthorizeUrl,
	exchangeAccessToken,
	obtainRequestToken,
} from '../../lib/zaimOAuth';
import type {DataSourceSecret, OAuthState} from '../types';

export const REGION = 'asia-northeast1';
const PROJECT_ID = 'hakatadiary';
export const DATA_SOURCE_ID = 'zaim';
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/zaimOAuthCallback`;
const APP_URL = `https://${PROJECT_ID}.web.app/data-sources`;

// ZaimはOAuth 1.0a(3-legged)のためGoogle/Swarmが使うOAuth2の createGoogleOAuthFlow は
// 流用できない。request tokenのcallback→access token交換の間で oauth_token_secret を
// 引き継ぐ必要があるため、oauthStatesのドキュメントIDにはZaim自身の oauth_token を使う
// (Google/SwarmのようなCSRF対策用ランダムstateではなく、oauth_token自体が相関キーになる)。
export const beginZaimOAuth = onCall(
	{region: REGION, secrets: [zaimConsumerSecret]},
	async (request) => {
		assertOwner(request);

		const {oauthToken, oauthTokenSecret} = await obtainRequestToken(
			zaimConsumerKey.value(),
			zaimConsumerSecret.value(),
			CALLBACK_URL,
		);

		const stateData: OAuthState = {
			dataSourceId: DATA_SOURCE_ID,
			createdAt: Timestamp.now(),
			oauthTokenSecret,
		};
		await db.collection('oauthStates').doc(oauthToken).set(stateData);

		return {authUrl: buildZaimAuthorizeUrl(oauthToken)};
	},
);

export const zaimOAuthCallback = onRequest(
	{region: REGION, secrets: [zaimConsumerSecret]},
	async (req, res) => {
		const {oauth_token: oauthToken, oauth_verifier: verifier} = req.query;

		if (typeof oauthToken !== 'string' || typeof verifier !== 'string') {
			res.status(400).send('Invalid request.');
			return;
		}

		const stateRef = db.collection('oauthStates').doc(oauthToken);
		const stateDoc = await stateRef.get();

		if (!stateDoc.exists) {
			res.status(400).send('Invalid or expired request token.');
			return;
		}

		const stateData = stateDoc.data() as OAuthState | undefined;
		await stateRef.delete();

		if (
			!stateData ||
			stateData.dataSourceId !== DATA_SOURCE_ID ||
			!stateData.oauthTokenSecret ||
			Date.now() - stateData.createdAt.toMillis() > STATE_TTL_MS
		) {
			res.status(400).send('Request token expired.');
			return;
		}

		try {
			const {accessToken, accessTokenSecret} = await exchangeAccessToken(
				zaimConsumerKey.value(),
				zaimConsumerSecret.value(),
				oauthToken,
				stateData.oauthTokenSecret,
				verifier,
			);

			const now = Timestamp.now();
			const secretData: DataSourceSecret = {
				credentialType: 'oauth1_access_token',
				payload: {accessToken, accessTokenSecret},
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
					displayName: 'Zaim (家計簿)',
					category: 'finance',
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

			logInfo('Zaim OAuth connected.');
			res.redirect(302, APP_URL);
		} catch (err) {
			logError('Zaim OAuth callback failed', err);
			res.status(500).send('OAuth exchange failed.');
		}
	},
);
