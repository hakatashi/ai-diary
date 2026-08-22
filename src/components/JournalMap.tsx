import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {createEffect, onCleanup} from 'solid-js';
import {fetchGpsTrack, type GpsTrackPoint} from '~/lib/gpsTrack';
import type {LogEntry, LogEntryCategory} from '~/lib/schema.ts';

const CATEGORY_COLOR: Record<LogEntryCategory, string> = {
	exercise: '#ec3013',
	nutrition: '#7d7979',
	sleep: '#7d7979',
	weight: '#7d7979',
	location: '#7d7979',
	checkin: '#ec3013',
	calendar: '#7d7979',
	photo: '#7d7979',
	game: '#7d7979',
};

// 移動経路(ポリライン)はアクセントカラーを基本とし、電車・車など高速な乗り物による移動のみ
// サブアクセントカラーで区別する(地図タイルのグレースケール化により埋もれないようにするため)。
const PATH_COLOR = '#ec3013';
const PATH_COLOR_FAST = '#1f6fb0';

// google_maps_activityのactivityType(normalize.tsのACTIVITY_TYPE_LABELS参照)のうち、
// 電車・バス・車等の「乗り物による移動」とみなすもの。徒歩・自転車・ランニング等は含めない。
const FAST_ACTIVITY_TYPES = new Set([
	'IN_PASSENGER_VEHICLE',
	'IN_BUS',
	'IN_TRAIN',
	'IN_SUBWAY',
	'IN_TRAM',
	'IN_FERRY',
	'FLYING',
	'MOTORCYCLING',
]);

const DEFAULT_CENTER: [number, number] = [35.681236, 139.767125];

interface RawWithStoragePath {
	storagePath?: unknown;
}

interface RawWithGpsTrack {
	gpsTrack?: {storagePath?: unknown};
}

interface RawWithActivityType {
	activity?: {topCandidate?: {type?: unknown}};
}

const getPathStoragePath = (entry: LogEntry): string | null => {
	if (entry.sourceType === 'google_maps_path') {
		const storagePath = (entry.raw as RawWithStoragePath).storagePath;
		return typeof storagePath === 'string' ? storagePath : null;
	}
	const storagePath = (entry.raw as RawWithGpsTrack).gpsTrack?.storagePath;
	return typeof storagePath === 'string' ? storagePath : null;
};

interface ActivityInterval {
	startMs: number;
	endMs: number;
	isFast: boolean;
}

// google_maps_pathの1エントリは実移動時間ではなく2時間固定のバケットで区切られており
// (Google Maps Timelineエクスポート仕様)、経路の一部だけが電車等の高速移動というケースが
// 多いため、エントリ単位ではなくgoogle_maps_activityのactivityTypeとの時間帯マッチングで
// GPS点ごとに色分けする。
const buildActivityIntervals = (entries: LogEntry[]): ActivityInterval[] => {
	const intervals: ActivityInterval[] = [];
	for (const entry of entries) {
		if (entry.sourceType !== 'google_maps_activity' || !entry.endAt) {
			continue;
		}
		const activityType = (entry.raw as RawWithActivityType).activity
			?.topCandidate?.type;
		if (typeof activityType !== 'string') {
			continue;
		}
		intervals.push({
			startMs: entry.startAt.toDate().getTime(),
			endMs: entry.endAt.toDate().getTime(),
			isFast: FAST_ACTIVITY_TYPES.has(activityType),
		});
	}
	return intervals.sort((a, b) => a.startMs - b.startMs);
};

const findPathColor = (
	intervals: ActivityInterval[],
	timeMs: number,
): string => {
	for (const interval of intervals) {
		if (timeMs >= interval.startMs && timeMs < interval.endMs) {
			return interval.isFast ? PATH_COLOR_FAST : PATH_COLOR;
		}
	}
	return PATH_COLOR;
};

// GPS点の隣接ペアごとに、その中間時刻がどのactivity区間に属するかで色分けし、
// 同色が連続する区間をまとめて折れ線にする(区間の切り替わり以外で線を分割しすぎないため)。
const buildPathSegments = (
	points: GpsTrackPoint[],
	intervals: ActivityInterval[],
): {latlngs: [number, number][]; color: string}[] => {
	if (points.length < 2) {
		return [];
	}
	const segments: {latlngs: [number, number][]; color: string}[] = [];
	let currentColor: string | null = null;
	let currentLatLngs: [number, number][] = [];

	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		const midMs =
			(new Date(prev.time).getTime() + new Date(curr.time).getTime()) / 2;
		const color = findPathColor(intervals, midMs);
		if (color !== currentColor) {
			if (currentColor && currentLatLngs.length > 1) {
				segments.push({latlngs: currentLatLngs, color: currentColor});
			}
			currentColor = color;
			currentLatLngs = [[prev.lat, prev.lng]];
		}
		currentLatLngs.push([curr.lat, curr.lng]);
	}
	if (currentColor && currentLatLngs.length > 1) {
		segments.push({latlngs: currentLatLngs, color: currentColor});
	}
	return segments;
};

const JournalMap = (props: {entries: LogEntry[]}) => {
	let containerRef: HTMLDivElement | undefined;
	let map: L.Map | undefined;
	let layerGroup: L.LayerGroup | undefined;
	let renderToken = 0;

	onCleanup(() => {
		map?.remove();
	});

	createEffect(() => {
		const entries = props.entries;
		if (!containerRef) {
			return;
		}
		if (!map) {
			map = L.map(containerRef, {attributionControl: true}).setView(
				DEFAULT_CENTER,
				12,
			);
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; OpenStreetMap contributors',
			}).addTo(map);
			layerGroup = L.layerGroup().addTo(map);
		}
		const currentMap = map;
		const currentLayerGroup = layerGroup;
		if (!currentMap || !currentLayerGroup) {
			return;
		}

		renderToken += 1;
		const token = renderToken;

		void (async () => {
			const bounds: [number, number][] = [];
			const activityIntervals = buildActivityIntervals(entries);

			// 各トラックのStorage取得はエントリ数に依存せず並列実行する
			// (逐次awaitだと日誌ページの表示に数秒〜10秒程度かかっていたため)。
			const trackResults = await Promise.all(
				entries.map(async (entry) => {
					const storagePath = getPathStoragePath(entry);
					if (!storagePath) {
						return null;
					}
					try {
						const points = await fetchGpsTrack(storagePath);
						if (entry.sourceType === 'google_maps_path') {
							return buildPathSegments(points, activityIntervals);
						}
						if (points.length < 2) {
							return null;
						}
						// google_health_exercise(徒歩・自転車・ランニング等)は常に通常色。
						return [
							{
								latlngs: points.map((p) => [p.lat, p.lng] as [number, number]),
								color: PATH_COLOR,
							},
						];
					} catch {
						// 個別トラックの取得失敗は地図全体の描画を止めない。
						return null;
					}
				}),
			);

			if (token !== renderToken) {
				return;
			}

			const polylines: {latlngs: [number, number][]; color: string}[] = [];
			for (const result of trackResults) {
				if (!result) {
					continue;
				}
				for (const segment of result) {
					polylines.push(segment);
					bounds.push(...segment.latlngs);
				}
			}

			currentLayerGroup.clearLayers();

			for (const {latlngs, color} of polylines) {
				L.polyline(latlngs, {color, weight: 4.5, opacity: 0.85}).addTo(
					currentLayerGroup,
				);
			}

			for (const entry of entries) {
				if (!entry.location) {
					continue;
				}
				const latlng: [number, number] = [
					entry.location.latitude,
					entry.location.longitude,
				];
				const color = CATEGORY_COLOR[entry.category] ?? '#ec3013';
				const icon = L.divIcon({
					className: '',
					html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
					iconSize: [12, 12],
					iconAnchor: [6, 6],
				});
				L.marker(latlng, {icon})
					.bindTooltip(entry.title, {direction: 'top', offset: [0, -8]})
					.addTo(currentLayerGroup);
				bounds.push(latlng);
			}

			if (bounds.length > 0) {
				currentMap.fitBounds(bounds, {padding: [32, 32], maxZoom: 16});
			} else {
				currentMap.setView(DEFAULT_CENTER, 12);
			}
		})();
	});

	return (
		<div
			ref={containerRef}
			class="journal-map h-full w-full"
			style="background:var(--color-neutral-800);"
		/>
	);
};

export default JournalMap;
