/**
 * items を最大 concurrency 件まで同時実行しつつ fn を適用し、結果を元の順序で返す。
 * Firestore/外部APIへの逐次awaitがボトルネックになる一括インポート処理向け。
 */
export const mapWithConcurrency = async <T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const workerCount = Math.min(concurrency, items.length);
	const workers = Array.from({length: workerCount}, async () => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
};
