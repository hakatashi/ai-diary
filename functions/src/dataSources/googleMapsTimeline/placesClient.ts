import {FieldValue, GeoPoint, Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import type {PlaceCacheEntry} from '../../../../src/lib/schema.ts';
import {mapWithConcurrency} from '../../lib/concurrency';
import {db} from '../../lib/firebaseAdmin';
import {googlePlacesApiKey} from '../../lib/secrets';

// Place Details (Pro SKU) の無料枠は月5,000件(Google Cloudの請求単位)。
// 複数の同時インポートや将来の増分同期を考慮し、500件の安全マージンを設けて
// この上限に達したら以降の呼び出しをスキップする(フォールバック表示に切り替える)。
const MONTHLY_CALL_LIMIT = 4500;
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;
// 未キャッシュの場所をPlaces APIで解決する際の同時実行数。
const RESOLVE_CONCURRENCY = 20;

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
 * 複数のplaceIdから場所の詳細(名称等)をまとめて取得する。
 * まず placesCache を `getAll` で一括参照し(個別 `get` をplaceId件数分発行しない)、
 * キャッシュに無いものだけ Places API (New) で解決して、新規エントリは最後に
 * まとめて `batch.commit` でキャッシュに書き込む(1件ずつの `set` を避ける)。
 * 月間呼び出しカウンタ(`placesApiUsage`)自体は、呼び出し自体が課金対象になりうるため
 * 個々のAPI呼び出し直後に都度書き込む(`fetchPlaceDetailsFromApi` 内の `recordApiCall`。
 * ここをバッチ化して遅延書き込みにすると、途中でクラッシュした場合に実際に発生した
 * 呼び出し回数を記録し損ねる恐れがあるため意図的に個別書き込みのまま残している)。
 * APIキー未設定・月間呼び出し上限到達・API呼び出し失敗時は該当placeIdをnullとして返す
 * (呼び出し元は緯度経度表記にフォールバックし、インポート全体を失敗させない)。
 */
export const resolvePlacesBatch = async (
	placeIds: string[],
): Promise<Map<string, PlaceCacheEntry | null>> => {
	const uniqueIds = [...new Set(placeIds)];
	const result = new Map<string, PlaceCacheEntry | null>();
	if (uniqueIds.length === 0) {
		return result;
	}

	const refs = uniqueIds.map((placeId) =>
		db.collection('placesCache').doc(placeId),
	);
	const snapshots = await db.getAll(...refs);
	const missingIds: string[] = [];
	snapshots.forEach((snapshot, index) => {
		if (snapshot.exists) {
			result.set(uniqueIds[index], snapshot.data() as PlaceCacheEntry);
		} else {
			missingIds.push(uniqueIds[index]);
		}
	});

	if (missingIds.length === 0) {
		return result;
	}

	// 月間呼び出し回数はこのバッチ内で1回だけ読み取り、以降はローカルでカウントする
	// (呼び出しごとに毎回読み直すのは冗長で、同じドキュメントを繰り返し読むだけのため)。
	const usageRef = db.collection('placesApiUsage').doc(getCurrentMonthKey());
	const usageSnapshot = await usageRef.get();
	let callCount = (usageSnapshot.data()?.callCount as number | undefined) ?? 0;

	const pendingCacheWrites: {
		ref: FirebaseFirestore.DocumentReference;
		entry: Omit<PlaceCacheEntry, never>;
	}[] = [];

	await mapWithConcurrency(missingIds, RESOLVE_CONCURRENCY, async (placeId) => {
		if (callCount >= MONTHLY_CALL_LIMIT) {
			logInfo(
				`Places API monthly call budget (${MONTHLY_CALL_LIMIT}) reached; skipping lookup for ${placeId}.`,
			);
			result.set(placeId, null);
			return;
		}
		// チェックと加算をawaitを挟まず同期的に行うことで、並列実行中の他タスクとの
		// 競合(上限を超えて呼び出してしまう)を避ける。
		callCount += 1;

		try {
			const details = await fetchPlaceDetailsFromApi(placeId);
			if (!details) {
				result.set(placeId, null);
				return;
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
			pendingCacheWrites.push({
				ref: db.collection('placesCache').doc(placeId),
				entry,
			});
			result.set(placeId, entry as unknown as PlaceCacheEntry);
		} catch (err) {
			logError(`Failed to resolve place ${placeId}`, err);
			result.set(placeId, null);
		}
	});

	for (let i = 0; i < pendingCacheWrites.length; i += MAX_OPS_PER_COMMIT) {
		const batch = db.batch();
		for (const {ref, entry} of pendingCacheWrites.slice(
			i,
			i + MAX_OPS_PER_COMMIT,
		)) {
			batch.set(ref, entry);
		}
		await batch.commit();
	}

	return result;
};
