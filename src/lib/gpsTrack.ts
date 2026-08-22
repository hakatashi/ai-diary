import {getDownloadURL, ref} from 'firebase/storage';
import {storage} from './firebase';

export interface GpsTrackPoint {
	lat: number;
	lng: number;
	time: string;
}

/**
 * gpsTrackStorage.ts(functions側)がgzip圧縮して保存したGPS点列を取得する。
 * オブジェクトは `contentEncoding: gzip` メタデータ付きで保存されており、
 * ブラウザは `Accept-Encoding: gzip` を常に送るため、fetch()が返す時点で
 * 既にブラウザ側で透過的に解凍済み(Content-Encodingの標準的な扱い)。
 * そのため手動でのgzip解凍は不要かつ二重解凍によりエラーになるため行わない。
 */
export const fetchGpsTrack = async (
	storagePath: string,
): Promise<GpsTrackPoint[]> => {
	const url = await getDownloadURL(ref(storage, storagePath));
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch GPS track: ${response.status}`);
	}
	return (await response.json()) as GpsTrackPoint[];
};
