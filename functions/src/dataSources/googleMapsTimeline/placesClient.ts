import {GeoPoint, Timestamp} from 'firebase-admin/firestore';
import {error as logError} from 'firebase-functions/logger';
import type {PlaceCacheEntry} from '../../../../src/lib/schema.ts';
import {db} from '../../lib/firebaseAdmin';
import {googlePlacesApiKey} from '../../lib/secrets';

interface PlaceDetailsResult {
	displayName: string;
	formattedAddress: string | null;
	location: {lat: number; lng: number} | null;
	types: string[];
}

const fetchPlaceDetailsFromApi = async (
	placeId: string,
): Promise<PlaceDetailsResult | null> => {
	let apiKey: string;
	try {
		apiKey = googlePlacesApiKey.value();
	} catch {
		return null;
	}
	if (!apiKey) {
		return null;
	}

	const response = await fetch(
		`https://places.googleapis.com/v1/places/${placeId}`,
		{
			headers: {
				'X-Goog-Api-Key': apiKey,
				'X-Goog-FieldMask': 'displayName,formattedAddress,location,types',
			},
		},
	);

	if (!response.ok) {
		logError(
			`Places API request failed for ${placeId}: ${response.status} ${await response.text()}`,
		);
		return null;
	}

	const body = (await response.json()) as {
		displayName?: {text?: string};
		formattedAddress?: string;
		location?: {latitude?: number; longitude?: number};
		types?: string[];
	};

	return {
		displayName: body.displayName?.text ?? placeId,
		formattedAddress: body.formattedAddress ?? null,
		location:
			body.location?.latitude !== undefined &&
			body.location?.longitude !== undefined
				? {lat: body.location.latitude, lng: body.location.longitude}
				: null,
		types: body.types ?? [],
	};
};

/**
 * placeIdから場所の詳細(名称等)を取得する。まず placesCache を参照し、無ければ
 * Places API (New) を呼び出してキャッシュする。
 * APIキー未設定・API呼び出し失敗時はnullを返す(呼び出し元は緯度経度表記に
 * フォールバックし、インポート全体を失敗させない)。
 */
export const resolvePlace = async (
	placeId: string,
): Promise<PlaceCacheEntry | null> => {
	const cacheRef = db.collection('placesCache').doc(placeId);
	const cached = await cacheRef.get();
	if (cached.exists) {
		return cached.data() as PlaceCacheEntry;
	}

	try {
		const details = await fetchPlaceDetailsFromApi(placeId);
		if (!details) {
			return null;
		}

		const entry = {
			displayName: details.displayName,
			formattedAddress: details.formattedAddress,
			location: details.location
				? new GeoPoint(details.location.lat, details.location.lng)
				: null,
			types: details.types,
			fetchedAt: Timestamp.now(),
		};
		await cacheRef.set(entry);
		return entry as unknown as PlaceCacheEntry;
	} catch (err) {
		logError(`Failed to resolve place ${placeId}`, err);
		return null;
	}
};
