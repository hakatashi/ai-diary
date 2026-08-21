import {getDownloadURL, ref} from 'firebase/storage';
import {storage} from './firebase';

export interface GpsTrackPoint {
	lat: number;
	lng: number;
	time: string;
}

/**
 * gpsTrackStorage.ts(functions側)がgzip圧縮して保存したGPS点列を取得・解凍する。
 * ブラウザ標準のDecompressionStreamを使い、追加の解凍ライブラリは導入しない。
 */
export const fetchGpsTrack = async (
	storagePath: string,
): Promise<GpsTrackPoint[]> => {
	const url = await getDownloadURL(ref(storage, storagePath));
	const response = await fetch(url);
	if (!response.ok || !response.body) {
		throw new Error(`Failed to fetch GPS track: ${response.status}`);
	}
	const decompressed = response.body.pipeThrough(
		new DecompressionStream('gzip'),
	);
	const text = await new Response(decompressed).text();
	return JSON.parse(text) as GpsTrackPoint[];
};
