import type {GpsTrackPoint} from '../../lib/gpsTrackStorage';

// exportExerciseTcxが返すTCX(Training Center XML v2)から座標付きのTrackpointのみを
// 抽出する。汎用XMLパーサは使わず正規表現で十分な理由: このXMLはGoogle Health API自身が
// 生成する構造が固定されたマシン生成データであり(<Activities><Activity><Lap><Track>
// <Trackpoint><Time/><Position><LatitudeDegrees/><LongitudeDegrees/></Position>...
// </Trackpoint>という一定の入れ子)、任意のXML入力を安全に扱う必要がないため。
// 屋内エクササイズ等GPSが存在しない場合、Trackpoint自体が0件、またはPositionを
// 持たないTrackpoint(心拍数のみ等)が混在することがあるため、Position(緯度経度)が
// 取得できた点のみを結果に含める。
const TRACKPOINT_REGEX = /<Trackpoint\b[\s\S]*?<\/Trackpoint>/g;
const TIME_REGEX = /<Time>([^<]+)<\/Time>/;
const LATITUDE_REGEX = /<LatitudeDegrees>(-?[\d.]+)<\/LatitudeDegrees>/;
const LONGITUDE_REGEX = /<LongitudeDegrees>(-?[\d.]+)<\/LongitudeDegrees>/;

export const parseTcxTrackpoints = (tcx: string): GpsTrackPoint[] => {
	const points: GpsTrackPoint[] = [];

	for (const match of tcx.matchAll(TRACKPOINT_REGEX)) {
		const block = match[0];
		const time = TIME_REGEX.exec(block)?.[1];
		const lat = LATITUDE_REGEX.exec(block)?.[1];
		const lng = LONGITUDE_REGEX.exec(block)?.[1];
		if (time && lat && lng) {
			points.push({lat: Number(lat), lng: Number(lng), time});
		}
	}

	return points;
};
