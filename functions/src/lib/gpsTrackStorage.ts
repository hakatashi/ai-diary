import {gzipSync} from 'node:zlib';
import {haversineDistanceMeters} from '../dataSources/dedup/geo';
import {getBucket} from './firebaseAdmin';

export interface GpsTrackPoint {
	lat: number;
	lng: number;
	time: string;
}

export interface GpsTrackBoundingBox {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
}

export interface SavedGpsTrack {
	storagePath: string;
	pointCount: number;
	distanceMeters: number;
	boundingBox: GpsTrackBoundingBox;
}

/**
 * タイムスタンプ付き座標配列をgzip圧縮してFirebase Storageに保存し、
 * Firestoreにインラインで持たせるのに適した軽量なメタデータを返す。
 * 点列本体はStorage側にのみ存在し、呼び出し元のlogEntryには含めない。
 */
export const saveGpsTrack = async (
	path: string,
	points: GpsTrackPoint[],
): Promise<SavedGpsTrack> => {
	const body = gzipSync(Buffer.from(JSON.stringify(points), 'utf-8'));
	await getBucket()
		.file(path)
		.save(body, {
			contentType: 'application/json',
			metadata: {contentEncoding: 'gzip'},
		});

	let distanceMeters = 0;
	for (let i = 1; i < points.length; i += 1) {
		distanceMeters += haversineDistanceMeters(
			{latitude: points[i - 1].lat, longitude: points[i - 1].lng},
			{latitude: points[i].lat, longitude: points[i].lng},
		);
	}

	const lats = points.map((p) => p.lat);
	const lngs = points.map((p) => p.lng);

	return {
		storagePath: path,
		pointCount: points.length,
		distanceMeters,
		boundingBox: {
			minLat: Math.min(...lats),
			maxLat: Math.max(...lats),
			minLng: Math.min(...lngs),
			maxLng: Math.max(...lngs),
		},
	};
};
