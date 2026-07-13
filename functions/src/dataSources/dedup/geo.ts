// Google Mapsの訪問履歴とSwarmのチェックイン履歴は意味的に重複しうる
// (同じ場所訪問を異なるデータソースが記録する)。この20分/200mというしきい値は
// 「同一の訪問イベントを指している可能性が高い」ことを保証するための保守的な値であり、
// GPS誤差やSwarmでのチェックイン操作の遅延を吸収する目的で選んでいる。
// firebase-adminに依存しない純粋関数として切り出し、単体テストしやすくしている。
export const TIME_WINDOW_MS = 20 * 60 * 1000;
export const DISTANCE_THRESHOLD_METERS = 200;
const EARTH_RADIUS_METERS = 6371000;

export interface DedupCandidate {
	id: string;
	startAtMs: number;
	location: {latitude: number; longitude: number} | null;
}

export const haversineDistanceMeters = (
	a: {latitude: number; longitude: number},
	b: {latitude: number; longitude: number},
): number => {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b.latitude - a.latitude);
	const dLng = toRad(b.longitude - a.longitude);
	const lat1 = toRad(a.latitude);
	const lat2 = toRad(b.latitude);

	const sinDLat = Math.sin(dLat / 2);
	const sinDLng = Math.sin(dLng / 2);
	const h =
		sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
	const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
	return EARTH_RADIUS_METERS * c;
};

export const findBestMatch = (
	checkin: DedupCandidate,
	visits: DedupCandidate[],
): DedupCandidate | null => {
	if (!checkin.location) {
		return null;
	}
	let best: {visit: DedupCandidate; distance: number} | null = null;
	for (const visit of visits) {
		if (!visit.location) {
			continue;
		}
		const timeDiff = Math.abs(visit.startAtMs - checkin.startAtMs);
		if (timeDiff > TIME_WINDOW_MS) {
			continue;
		}
		const distance = haversineDistanceMeters(checkin.location, visit.location);
		if (distance > DISTANCE_THRESHOLD_METERS) {
			continue;
		}
		if (!best || distance < best.distance) {
			best = {visit, distance};
		}
	}
	return best?.visit ?? null;
};
