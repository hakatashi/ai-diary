import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {createEffect, onCleanup} from 'solid-js';
import {fetchGpsTrack} from '~/lib/gpsTrack';
import type {LogEntry, LogEntryCategory} from '~/lib/schema.ts';

const CATEGORY_COLOR: Record<LogEntryCategory, string> = {
	exercise: '#ec3013',
	location: '#7d7979',
	checkin: '#ec3013',
	calendar: '#7d7979',
	photo: '#7d7979',
};

const DEFAULT_CENTER: [number, number] = [35.681236, 139.767125];

interface RawWithStoragePath {
	storagePath?: unknown;
}

interface RawWithGpsTrack {
	gpsTrack?: {storagePath?: unknown};
}

const getPathStoragePath = (entry: LogEntry): string | null => {
	if (entry.sourceType === 'google_maps_path') {
		const storagePath = (entry.raw as RawWithStoragePath).storagePath;
		return typeof storagePath === 'string' ? storagePath : null;
	}
	const storagePath = (entry.raw as RawWithGpsTrack).gpsTrack?.storagePath;
	return typeof storagePath === 'string' ? storagePath : null;
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
			const polylines: {latlngs: [number, number][]; color: string}[] = [];

			for (const entry of entries) {
				const storagePath = getPathStoragePath(entry);
				if (storagePath) {
					try {
						const points = await fetchGpsTrack(storagePath);
						const latlngs = points.map(
							(p) => [p.lat, p.lng] as [number, number],
						);
						polylines.push({
							latlngs,
							color: CATEGORY_COLOR[entry.category] ?? '#ec3013',
						});
						bounds.push(...latlngs);
					} catch {
						// 個別トラックの取得失敗は地図全体の描画を止めない。
					}
				}
			}

			if (token !== renderToken) {
				return;
			}

			currentLayerGroup.clearLayers();

			for (const {latlngs, color} of polylines) {
				L.polyline(latlngs, {color, weight: 3, opacity: 0.85}).addTo(
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
