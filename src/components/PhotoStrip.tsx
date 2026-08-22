import {httpsCallable} from 'firebase/functions';
import {createSignal, For, Show} from 'solid-js';
import {formatTime} from '~/lib/date';
import {functions} from '~/lib/firebase';
import type {LogEntry} from '~/lib/schema.ts';

interface GetImmichThumbnailResponse {
	dataUrl: string;
}

const getImmichThumbnail = httpsCallable<
	{assetId: string; size?: 'thumbnail' | 'preview'},
	GetImmichThumbnailResponse
>(functions, 'getImmichThumbnail');

// サムネイルは同一セッション内で使い回す(日付をまたいで再訪しても再取得しない)。
const thumbnailCache = new Map<string, string>();
const previewCache = new Map<string, string>();

const PhotoThumbnail = (props: {entry: LogEntry; onOpen: () => void}) => {
	const [dataUrl, setDataUrl] = createSignal(
		thumbnailCache.get(props.entry.sourceRecordId),
	);

	if (!dataUrl()) {
		void getImmichThumbnail({
			assetId: props.entry.sourceRecordId,
			size: 'thumbnail',
		})
			.then((result) => {
				thumbnailCache.set(props.entry.sourceRecordId, result.data.dataUrl);
				setDataUrl(result.data.dataUrl);
			})
			.catch(() => {
				// 取得失敗時はプレースホルダのまま(1枚の失敗で一覧全体を止めない)。
			});
	}

	return (
		<button
			type="button"
			onClick={props.onOpen}
			class="relative h-[146px] w-[130px] flex-none cursor-pointer overflow-hidden border-none bg-neutral-300 p-0"
		>
			<Show when={dataUrl()}>
				{(url) => (
					<img
						src={url()}
						alt={props.entry.title}
						class="h-full w-full object-cover"
					/>
				)}
			</Show>
			<span class="absolute bottom-1.5 left-1.5 bg-black/45 px-1.5 text-[10px] text-white">
				{formatTime(props.entry.startAt.toDate())}
			</span>
		</button>
	);
};

const PhotoStrip = (props: {entries: LogEntry[]}) => {
	const [openIndex, setOpenIndex] = createSignal<number | null>(null);
	const [previewUrl, setPreviewUrl] = createSignal<string | undefined>();

	const openPhoto = (index: number) => {
		setOpenIndex(index);
		const entry = props.entries[index];
		const cached = previewCache.get(entry.sourceRecordId);
		if (cached) {
			setPreviewUrl(cached);
			return;
		}
		setPreviewUrl(undefined);
		void getImmichThumbnail({
			assetId: entry.sourceRecordId,
			size: 'preview',
		})
			.then((result) => {
				previewCache.set(entry.sourceRecordId, result.data.dataUrl);
				setPreviewUrl(result.data.dataUrl);
			})
			.catch(() => {
				// プレビュー取得失敗時はサムネイル画像のまま表示する。
			});
	};

	const closePhoto = () => setOpenIndex(null);
	const selectedEntry = () => {
		const index = openIndex();
		return index === null ? null : props.entries[index];
	};

	return (
		<>
			<div class="flex h-[170px] flex-none gap-2 overflow-x-auto border-divider border-t-2 bg-bg p-3">
				<For each={props.entries}>
					{(entry, index) => (
						<PhotoThumbnail entry={entry} onOpen={() => openPhoto(index())} />
					)}
				</For>
			</div>

			<Show when={selectedEntry()} keyed={true}>
				{(entry) => (
					<div class="fixed inset-0 z-100 grid place-items-center bg-black/75 p-4">
						<div class="flex h-[94vh] w-[94vw] max-w-[1600px] flex-col bg-bg shadow-lg">
							<div class="min-h-0 flex-1">
								<Show
									when={previewUrl()}
									fallback={
										<div class="flex h-full items-center justify-center text-[13px] text-text/55">
											読み込み中…
										</div>
									}
								>
									{(url) => (
										<img
											src={url()}
											alt={entry.title}
											class="h-full w-full object-contain"
										/>
									)}
								</Show>
							</div>
							<div class="flex items-center justify-between border-divider border-t-2 px-5 py-4">
								<span class="text-[13px] text-text/60">
									{formatTime(entry.startAt.toDate())} に撮影
								</span>
								<button
									type="button"
									class="btn btn-secondary"
									onClick={closePhoto}
								>
									閉じる
								</button>
							</div>
						</div>
					</div>
				)}
			</Show>
		</>
	);
};

export default PhotoStrip;
