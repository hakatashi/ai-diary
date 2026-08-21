import {info as logInfo} from 'firebase-functions/logger';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import {mapWithConcurrency} from '../../lib/concurrency';
import {db} from '../../lib/firebaseAdmin';
import {type DedupCandidate, findBestMatch} from './geo';

// 日付ごとのクエリを逐次awaitすると対象日数に比例して処理時間が伸びるため、
// 同時実行数を上げて待ち時間を短縮する。
const DEDUPE_CONCURRENCY = 20;
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;

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

	// 日付ごとの書き込みをその場でcommitすると対象日数と同じ回数のFirestore往復が
	// 発生するため、マッチした更新内容を集約してから最後にまとめてコミットする。
	const pendingWrites: {
		ref: FirebaseFirestore.DocumentReference;
		dedupedInto: string;
	}[] = [];

	await mapWithConcurrency(uniqueDates, DEDUPE_CONCURRENCY, async (date) => {
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

		for (const checkinDoc of checkinDocs) {
			const candidate = toCandidate(
				checkinDoc.id,
				checkinDoc.data() as LogEntry,
			);
			const match = findBestMatch(candidate, visits);
			if (match) {
				pendingWrites.push({ref: checkinDoc.ref, dedupedInto: match.id});
			}
		}
	});

	for (let i = 0; i < pendingWrites.length; i += MAX_OPS_PER_COMMIT) {
		const batch = db.batch();
		for (const {ref, dedupedInto} of pendingWrites.slice(
			i,
			i + MAX_OPS_PER_COMMIT,
		)) {
			batch.set(ref, {hidden: true, dedupedInto}, {merge: true});
		}
		await batch.commit();
	}

	if (pendingWrites.length > 0) {
		logInfo(
			`Deduped ${pendingWrites.length} Swarm checkins across ${uniqueDates.length} dates.`,
		);
	}
};
