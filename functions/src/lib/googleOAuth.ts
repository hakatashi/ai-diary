import {randomBytes} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {onCall, onRequest} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {OAuth2Client} from 'google-auth-library';
import type {DataSourceSecret, OAuthState} from '../dataSources/types';
import {assertOwner} from './assertOwner';
import {db} from './firebaseAdmin';
import {googleClientId, googleClientSecret} from './secrets';

export const REGION = 'asia-northeast1';
const PROJECT_ID = 'hakatadiary';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleOAuthFlowOptions {
	/** dataSources/dataSourceSecrets のドキュメントID */
	dataSourceId: string;
	/** dataSources ドキュメントの displayName */
	displayName: string;
	/** dataSources ドキュメントの category */
	category: string;
	/** 要求するOAuthスコープ */
	scope: string | string[];
	/** functions/src/index.ts でこのフローの oauthCallback を export する際の関数名。
	 * リダイレクトURIの構築に使うため、実際のexport名と一致させること。 */
	callbackFunctionName: string;
}

/**
 * Google Health / Google Calendar / Google Photos など、Googleの認可コードフロー
 * (state発行 → 認可URL生成 → コールバックでtoken交換 → dataSources/dataSourceSecrets更新)
 * を共有する複数のデータソースで使うためのファクトリ。
 */
export const createGoogleOAuthFlow = (options: GoogleOAuthFlowOptions) => {
	const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
	const CALLBACK_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${options.callbackFunctionName}`;
	const APP_URL = `https://${PROJECT_ID}.web.app/data-sources`;

	const createOAuthClient = () =>
		new OAuth2Client({
			clientId: googleClientId.value(),
			clientSecret: googleClientSecret.value(),
			redirectUri: CALLBACK_URL,
		});

	const beginOAuth = onCall(
		{region: REGION, secrets: [googleClientSecret]},
		async (request) => {
			assertOwner(request);

			const state = randomBytes(24).toString('hex');
			const stateData: OAuthState = {
				dataSourceId: options.dataSourceId,
				createdAt: Timestamp.now(),
			};
			await db.collection('oauthStates').doc(state).set(stateData);

			const client = createOAuthClient();
			const authUrl = client.generateAuthUrl({
				access_type: 'offline',
				prompt: 'consent',
				scope: scopes,
				state,
			});

			return {authUrl};
		},
	);

	const oauthCallback = onRequest(
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
				stateData.dataSourceId !== options.dataSourceId ||
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
						`No refresh token returned from ${options.dataSourceId} OAuth callback.`,
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
						scope: tokens.scope ?? scopes.join(' '),
					},
					updatedAt: now,
				};
				await db
					.collection('dataSourceSecrets')
					.doc(options.dataSourceId)
					.set(secretData);

				const dataSourceRef = db
					.collection('dataSources')
					.doc(options.dataSourceId);
				const existingDataSource = await dataSourceRef.get();
				await dataSourceRef.set(
					{
						type: options.dataSourceId,
						displayName: options.displayName,
						category: options.category,
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

				logInfo(`${options.dataSourceId} OAuth connected.`);
				res.redirect(302, APP_URL);
			} catch (err) {
				logError(`${options.dataSourceId} OAuth callback failed`, err);
				res.status(500).send('OAuth exchange failed.');
			}
		},
	);

	return {beginOAuth, oauthCallback};
};

/** refresh tokenからGoogle APIのアクセストークンを取得する共通ヘルパー。 */
export const getGoogleAccessToken = async (
	refreshToken: string,
): Promise<string> => {
	const client = new OAuth2Client({
		clientId: googleClientId.value(),
		clientSecret: googleClientSecret.value(),
	});
	client.setCredentials({refresh_token: refreshToken});
	const {token} = await client.getAccessToken();
	if (!token) {
		throw new Error('Failed to obtain a Google API access token.');
	}
	return token;
};
