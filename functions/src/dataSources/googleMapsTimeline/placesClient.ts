import {FieldValue, GeoPoint, Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import type {PlaceCacheEntry} from '../../../../src/lib/schema.ts';
import {db} from '../../lib/firebaseAdmin';
import {googlePlacesApiKey} from '../../lib/secrets';

// Place Details (Pro SKU) の無料枠は月5,000件(Google Cloudの請求単位)。
// 複数の同時インポートや将来の増分同期を考慮し、500件の安全マージンを設けて
// この上限に達したら以降の呼び出しをスキップする(フォールバック表示に切り替える)。
const MONTHLY_CALL_LIMIT = 4500;

// displayName を要求した時点で最も高いPro SKU料金が発生するため、同じ呼び出しの中で
// 追加費用なく取得できるEssentials/Essentials IDs Only/Pro SKUのフィールドは
// できる限りまとめて取得し、再呼び出しの必要がないようキャッシュしておく。
const FIELD_MASK = [
	'id',
	'attributions',
	'name',
	'photos',
	'formattedAddress',
	'shortFormattedAddress',
	'location',
	'plusCode',
	'types',
	'viewport',
	'businessStatus',
	'displayName',
	'googleMapsLinks',
	'googleMapsUri',
	'iconBackgroundColor',
	'iconMaskBaseUri',
	'primaryType',
	'primaryTypeDisplayName',
	'timeZone',
	'utcOffsetMinutes',
].join(',');

const getCurrentMonthKey = (): string =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
	}).format(new Date());

const canMakeApiCall = async (): Promise<boolean> => {
	const usageRef = db.collection('placesApiUsage').doc(getCurrentMonthKey());
	const usageDoc = await usageRef.get();
	const callCount = (usageDoc.data()?.callCount as number | undefined) ?? 0;
	return callCount < MONTHLY_CALL_LIMIT;
};

const recordApiCall = async (): Promise<void> => {
	const usageRef = db.collection('placesApiUsage').doc(getCurrentMonthKey());
	await usageRef.set(
		{callCount: FieldValue.increment(1), updatedAt: Timestamp.now()},
		{merge: true},
	);
};

interface PlaceDetailsResult {
	displayName: string;
	formattedAddress: string | null;
	location: {lat: number; lng: number} | null;
	types: string[];
	raw: Record<string, unknown>;
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

	// languageCode=ja / regionCode=JP を指定し、displayName等が日本語で返るようにする。
	const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
	url.searchParams.set('languageCode', 'ja');
	url.searchParams.set('regionCode', 'JP');

	const response = await fetch(url, {
		headers: {
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask': FIELD_MASK,
		},
	});

	// 呼び出し自体(成功・失敗を問わず)がPlaces APIの請求対象になりうるため、
	// レスポンス内容を見る前に必ず月間カウンタへ記録する。
	await recordApiCall();

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
		raw: body,
	};
};

/**
 * placeIdから場所の詳細(名称等)を取得する。まず placesCache を参照し、無ければ
 * Places API (New) を呼び出してキャッシュする。
 * APIキー未設定・月間呼び出し上限到達・API呼び出し失敗時はnullを返す(呼び出し元は
 * 緯度経度表記にフォールバックし、インポート全体を失敗させない)。
 */
export const resolvePlace = async (
	placeId: string,
): Promise<PlaceCacheEntry | null> => {
	const cacheRef = db.collection('placesCache').doc(placeId);
	const cached = await cacheRef.get();
	if (cached.exists) {
		return cached.data() as PlaceCacheEntry;
	}

	const canCall = await canMakeApiCall();
	if (!canCall) {
		logInfo(
			`Places API monthly call budget (${MONTHLY_CALL_LIMIT}) reached; skipping lookup for ${placeId}.`,
		);
		return null;
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
			raw: details.raw,
			fetchedAt: Timestamp.now(),
		};
		await cacheRef.set(entry);
		return entry as unknown as PlaceCacheEntry;
	} catch (err) {
		logError(`Failed to resolve place ${placeId}`, err);
		return null;
	}
};
