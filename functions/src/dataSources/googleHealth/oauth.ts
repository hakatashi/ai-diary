import {randomBytes} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {onCall, onRequest} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {OAuth2Client} from 'google-auth-library';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import {googleClientId, googleClientSecret} from '../../lib/secrets';
import type {DataSourceSecret, OAuthState} from '../types';

export const REGION = 'asia-northeast1';
const PROJECT_ID = 'hakatadiary';
export const DATA_SOURCE_ID = 'google_health';
const SCOPE =
	'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/googleHealthOAuthCallback`;
const APP_URL = `https://${PROJECT_ID}.web.app/data-sources`;

const createOAuthClient = () =>
	new OAuth2Client({
		clientId: googleClientId.value(),
		clientSecret: googleClientSecret.value(),
		redirectUri: CALLBACK_URL,
	});

export const beginGoogleHealthOAuth = onCall(
	{region: REGION, secrets: [googleClientSecret]},
	async (request) => {
		assertOwner(request);

		const state = randomBytes(24).toString('hex');
		const stateData: OAuthState = {
			dataSourceId: DATA_SOURCE_ID,
			createdAt: Timestamp.now(),
		};
		await db.collection('oauthStates').doc(state).set(stateData);

		const client = createOAuthClient();
		const authUrl = client.generateAuthUrl({
			access_type: 'offline',
			prompt: 'consent',
			scope: [SCOPE],
			state,
		});

		return {authUrl};
	},
);

export const googleHealthOAuthCallback = onRequest(
	{region: REGION, secrets: [googleClientSecret]},
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
			Date.now() - stateData.createdAt.toMillis() > STATE_TTL_MS
		) {
			res.status(400).send('State expired.');
			return;
		}

		try {
			const client = createOAuthClient();
			const {tokens} = await client.getToken(code);

			if (!tokens.refresh_token) {
				logError(
					'No refresh token returned from Google Health OAuth callback.',
				);
				res
					.status(400)
					.send('No refresh token returned. Please retry the connection.');
				return;
			}

			const now = Timestamp.now();
			const secretData: DataSourceSecret = {
				credentialType: 'oauth2_refresh_token',
				payload: {
					refreshToken: tokens.refresh_token,
					scope: tokens.scope ?? SCOPE,
				},
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
					displayName: 'Google Health (運動記録)',
					category: 'fitness',
					status: 'connected',
					enabled: true,
					lastSyncError: null,
					updatedAt: now,
					...(existingDataSource.exists ? {} : {createdAt: now}),
				},
				{merge: true},
			);

			logInfo('Google Health OAuth connected.');
			res.redirect(302, APP_URL);
		} catch (err) {
			logError('Google Health OAuth callback failed', err);
			res.status(500).send('OAuth exchange failed.');
		}
	},
);
