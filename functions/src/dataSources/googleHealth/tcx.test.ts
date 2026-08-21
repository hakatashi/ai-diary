import {expect, test} from 'vitest';
import {parseTcxTrackpoints} from './tcx';

// exportExerciseTcxの実レスポンス形式を模したサンプル(Google Health API v4)。
const gpsTcx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
	<Activities>
		<Activity Sport="Biking">
			<Id>2025-09-08T08:44:43.000+01:00</Id>
			<Lap StartTime="2025-09-08T08:44:43.000+01:00">
				<Track>
					<Trackpoint>
						<Time>2025-09-08T08:45:21.000+01:00</Time>
						<Position>
							<LatitudeDegrees>51.532945</LatitudeDegrees>
							<LongitudeDegrees>-0.12476333333333334</LongitudeDegrees>
						</Position>
						<AltitudeMeters>108.4</AltitudeMeters>
						<HeartRateBpm><Value>112</Value></HeartRateBpm>
					</Trackpoint>
					<Trackpoint>
						<Time>2025-09-08T08:45:22.000+01:00</Time>
						<Position>
							<LatitudeDegrees>51.53294666666667</LatitudeDegrees>
							<LongitudeDegrees>-0.12476333333333334</LongitudeDegrees>
						</Position>
						<AltitudeMeters>108.4</AltitudeMeters>
						<HeartRateBpm><Value>112</Value></HeartRateBpm>
					</Trackpoint>
				</Track>
			</Lap>
		</Activity>
	</Activities>
</TrainingCenterDatabase>`;

test('parseTcxTrackpoints extracts lat/lng/time from Trackpoint elements', () => {
	const points = parseTcxTrackpoints(gpsTcx);
	expect(points).toEqual([
		{lat: 51.532945, lng: -0.12476333333333334, time: '2025-09-08T08:45:21.000+01:00'},
		{lat: 51.53294666666667, lng: -0.12476333333333334, time: '2025-09-08T08:45:22.000+01:00'},
	]);
});

test('parseTcxTrackpoints skips trackpoints without a Position element', () => {
	const tcx = `<TrainingCenterDatabase><Activities><Activity><Lap><Track>
		<Trackpoint><Time>2026-06-01T07:00:01.000Z</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
	</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
	expect(parseTcxTrackpoints(tcx)).toEqual([]);
});

test('parseTcxTrackpoints returns an empty array for a lap-less (indoor) export', () => {
	const tcx = '<TrainingCenterDatabase><Activities><Activity><Id>2026-06-07T12:30:31.000+01:00</Id></Activity></Activities></TrainingCenterDatabase>';
	expect(parseTcxTrackpoints(tcx)).toEqual([]);
});

test('parseTcxTrackpoints returns an empty array for unrelated/malformed XML', () => {
	expect(parseTcxTrackpoints('<html><body>error</body></html>')).toEqual([]);
	expect(parseTcxTrackpoints('{"tcxData": "oops"}')).toEqual([]);
});
