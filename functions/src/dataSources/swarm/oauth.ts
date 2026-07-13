import {randomBytes} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {onCall, onRequest} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import {foursquareClientId, foursquareClientSecret} from '../../lib/secrets';
import type {DataSourceSecret, OAuthState} from '../types';

export const REGION = 'asia-northeast1';
const PROJECT_ID = 'hakatadiary';
export const DATA_SOURCE_ID = 'swarm';
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/swarmOAuthCallback`;
const APP_URL = `https://${PROJECT_ID}.web.app/data-sources`;

// Foursquare独自のOAuth2フロー(Googleとは無関係)。参照:
// https://location.foursquare.com/developer/reference/personalization-apis-authentication
export const beginSwarmOAuth = onCall(
	{region: REGION, secrets: [foursquareClientSecret]},
	async (request) => {
		assertOwner(request);

		const state = randomBytes(24).toString('hex');
		const stateData: OAuthState = {
			dataSourceId: DATA_SOURCE_ID,
			createdAt: Timestamp.now(),
		};
		await db.collection('oauthStates').doc(state).set(stateData);

		const authUrl = new URL('https://foursquare.com/oauth2/authenticate');
		authUrl.searchParams.set('client_id', foursquareClientId.value());
		authUrl.searchParams.set('response_type', 'code');
		authUrl.searchParams.set('redirect_uri', CALLBACK_URL);
		authUrl.searchParams.set('state', state);

		return {authUrl: authUrl.toString()};
	},
);

export const swarmOAuthCallback = onRequest(
	{region: REGION, secrets: [foursquareClientSecret]},
	async (req, res) => {
		const {code, state} = req.query;

		if (typeof code !== 'string' || typeof state !== 'string') {
			res.status(400).send('Invalid request.');
			return;
		}

		const stateRef = db.collection('oauthStates').doc(state);
		const stateDoc = await stateRef.get();

		if (!stateDoc.exists) {
			res.status(400).send('Invalid or expired state.');
			return;
		}

		const stateData = stateDoc.data() as OAuthState | undefined;
		await stateRef.delete();

		if (
			!stateData ||
			stateData.dataSourceId !== DATA_SOURCE_ID ||
			Date.now() - stateData.createdAt.toMillis() > STATE_TTL_MS
		) {
			res.status(400).send('State expired.');
			return;
		}

		try {
			const tokenUrl = new URL('https://foursquare.com/oauth2/access_token');
			tokenUrl.searchParams.set('client_id', foursquareClientId.value());
			tokenUrl.searchParams.set(
				'client_secret',
				foursquareClientSecret.value(),
			);
			tokenUrl.searchParams.set('grant_type', 'authorization_code');
			tokenUrl.searchParams.set('redirect_uri', CALLBACK_URL);
			tokenUrl.searchParams.set('code', code);

			const response = await fetch(tokenUrl, {method: 'POST'});
			if (!response.ok) {
				throw new Error(
					`Foursquare token exchange failed: ${response.status} ${await response.text()}`,
				);
			}
			const body = (await response.json()) as {access_token?: string};
			if (!body.access_token) {
				throw new Error('No access_token returned from Foursquare.');
			}

			const now = Timestamp.now();
			const secretData: DataSourceSecret = {
				credentialType: 'oauth2_access_token',
				payload: {accessToken: body.access_token},
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
					displayName: 'Swarm (チェックイン履歴)',
					category: 'checkin',
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

			logInfo('Swarm OAuth connected.');
			res.redirect(302, APP_URL);
		} catch (err) {
			logError('Swarm OAuth callback failed', err);
			res.status(500).send('OAuth exchange failed.');
		}
	},
);
