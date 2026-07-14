import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError, onCall} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import {getGoogleAccessToken, REGION} from '../../lib/googleOAuth';
import {googleClientSecret} from '../../lib/secrets';
import type {DataSourceSecret} from '../types';
import {normalizePhoto, type RawPickedMediaItem} from './normalize';
import {DATA_SOURCE_ID} from './oauth';

const PICKER_API_BASE_URL = 'https://photospicker.googleapis.com/v1';

const getRefreshToken = async (): Promise<string> => {
	const secretDoc = await db
		.collection('dataSourceSecrets')
		.doc(DATA_SOURCE_ID)
		.get();
	if (!secretDoc.exists) {
		throw new HttpsError(
			'failed-precondition',
			'Google Photos is not connected yet.',
		);
	}
	const secret = secretDoc.data() as DataSourceSecret;
	if (!secret.payload.refreshToken) {
		throw new HttpsError(
			'failed-precondition',
			'Google Photos refresh token is missing.',
		);
	}
	return secret.payload.refreshToken;
};

interface PickerSessionResponse {
	id: string;
	pickerUri: string;
	mediaItemsSet?: boolean;
}

export const beginGooglePhotosPickerSession = onCall(
	{region: REGION, secrets: [googleClientSecret]},
	async (request): Promise<{pickerUri: string; sessionId: string}> => {
		assertOwner(request);

		const refreshToken = await getRefreshToken();
		const accessToken = await getGoogleAccessToken(refreshToken);

		const response = await fetch(`${PICKER_API_BASE_URL}/sessions`, {
			method: 'POST',
			headers: {Authorization: `Bearer ${accessToken}`},
		});
		if (!response.ok) {
			logError(
				`Failed to create Google Photos picker session: ${response.status} ${await response.text()}`,
			);
			throw new HttpsError(
				'internal',
				'Failed to create a Google Photos picker session.',
			);
		}

		const body = (await response.json()) as PickerSessionResponse;
		return {pickerUri: body.pickerUri, sessionId: body.id};
	},
);

export const getGooglePhotosPickerSessionStatus = onCall<{
	sessionId: string;
}>(
	{region: REGION, secrets: [googleClientSecret]},
	async (request): Promise<{mediaItemsSet: boolean}> => {
		assertOwner(request);

		const sessionId = request.data?.sessionId;
		if (!sessionId) {
			throw new HttpsError('invalid-argument', 'sessionId is required.');
		}

		const refreshToken = await getRefreshToken();
		const accessToken = await getGoogleAccessToken(refreshToken);

		const response = await fetch(
			`${PICKER_API_BASE_URL}/sessions/${sessionId}`,
			{headers: {Authorization: `Bearer ${accessToken}`}},
		);
		if (!response.ok) {
			logError(
				`Failed to get Google Photos picker session: ${response.status} ${await response.text()}`,
			);
			throw new HttpsError(
				'internal',
				'Failed to get the Google Photos picker session status.',
			);
		}

		const body = (await response.json()) as PickerSessionResponse;
		return {mediaItemsSet: Boolean(body.mediaItemsSet)};
	},
);

interface ListMediaItemsResponse {
	mediaItems?: RawPickedMediaItem[];
	nextPageToken?: string;
}

export const importGooglePhotosSelection = onCall<{sessionId: string}>(
	{region: REGION, secrets: [googleClientSecret]},
	async (request): Promise<{imported: number}> => {
		assertOwner(request);

		const sessionId = request.data?.sessionId;
		if (!sessionId) {
			throw new HttpsError('invalid-argument', 'sessionId is required.');
		}

		const refreshToken = await getRefreshToken();
		const accessToken = await getGoogleAccessToken(refreshToken);

		const mediaItems: RawPickedMediaItem[] = [];
		let pageToken: string | undefined;
		do {
			const url = new URL(`${PICKER_API_BASE_URL}/mediaItems`);
			url.searchParams.set('sessionId', sessionId);
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}
			const response = await fetch(url, {
				headers: {Authorization: `Bearer ${accessToken}`},
			});
			if (!response.ok) {
				logError(
					`Failed to list Google Photos picker media items: ${response.status} ${await response.text()}`,
				);
				throw new HttpsError('internal', 'Failed to list selected photos.');
			}
			const body = (await response.json()) as ListMediaItemsResponse;
			mediaItems.push(...(body.mediaItems ?? []));
			pageToken = body.nextPageToken;
		} while (pageToken);

		const now = Timestamp.now();
		if (mediaItems.length > 0) {
			const batch = db.batch();
			for (const item of mediaItems) {
				const {id, entry} = normalizePhoto(item);
				const ref = db.collection('logEntries').doc(id);
				batch.set(
					ref,
					{
						...entry,
						dataSourceId: DATA_SOURCE_ID,
						updatedAt: now,
						createdAt: now,
					},
					{merge: true},
				);
			}
			await batch.commit();
		}

		const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
		await dataSourceRef.set(
			{
				status: 'connected',
				lastSyncedAt: now,
				lastSyncStatus: 'success',
				lastSyncError: null,
				updatedAt: now,
			},
			{merge: true},
		);

		logInfo(`Imported ${mediaItems.length} Google Photos items.`);
		return {imported: mediaItems.length};
	},
);
