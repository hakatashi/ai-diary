import {info as logInfo} from 'firebase-functions/logger';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import {db} from '../../lib/firebaseAdmin';
import {type DedupCandidate, findBestMatch} from './geo';

const toCandidate = (id: string, data: LogEntry): DedupCandidate => ({
	id,
	startAtMs: data.startAt.toMillis(),
	location: data.location
		? {latitude: data.location.latitude, longitude: data.location.longitude}
		: null,
});

/**
 * 指定した日付群について、Google Mapsの訪問記録(google_maps_visit)と
 * Swarmのチェックイン(category: checkin)が同一の訪問イベントを指していると
 * 判定できる場合、Swarm側のエントリを hidden にして dedupedInto に統合先を記録する。
 * どちらのエントリも削除はしない(生データは保持する)。
 */
export const dedupeVisitsAndCheckins = async (
	dates: string[],
): Promise<void> => {
	const uniqueDates = [...new Set(dates)];

	for (const date of uniqueDates) {
		const [visitsSnap, checkinsSnap] = await Promise.all([
			db
				.collection('logEntries')
				.where('date', '==', date)
				.where('sourceType', '==', 'google_maps_visit')
				.get(),
			db
				.collection('logEntries')
				.where('date', '==', date)
				.where('category', '==', 'checkin')
				.get(),
		]);

		const visits = visitsSnap.docs
			.filter((docSnap) => !(docSnap.data() as LogEntry).hidden)
			.map((docSnap) => toCandidate(docSnap.id, docSnap.data() as LogEntry));

		const checkinDocs = checkinsSnap.docs.filter((docSnap) => {
			const data = docSnap.data() as LogEntry;
			return !data.hidden && !data.dedupedInto;
		});

		const batch = db.batch();
		let writesInBatch = 0;

		for (const checkinDoc of checkinDocs) {
			const candidate = toCandidate(
				checkinDoc.id,
				checkinDoc.data() as LogEntry,
			);
			const match = findBestMatch(candidate, visits);
			if (match) {
				batch.set(
					checkinDoc.ref,
					{hidden: true, dedupedInto: match.id},
					{merge: true},
				);
				writesInBatch += 1;
			}
		}

		if (writesInBatch > 0) {
			await batch.commit();
			logInfo(`Deduped ${writesInBatch} Swarm checkins on ${date}.`);
		}
	}
};
