import {doc} from 'firebase/firestore';
import {type HttpsCallable, httpsCallable} from 'firebase/functions';
import {useFirestore} from 'solid-firebase';
import {createSignal, Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import Doc from '~/lib/Doc';
import {formatDateTime, getTodayDateString, shiftDateString} from '~/lib/date';
import {DataSources, functions} from '~/lib/firebase';
import type {DataSourceStatus} from '~/lib/schema.ts';

const STATUS_LABEL: Record<DataSourceStatus, string> = {
	connected: '接続済み',
	disconnected: '未接続',
	error: 'エラー',
	pending_auth: '認証待ち',
};

const beginGoogleHealthOAuth = httpsCallable<undefined, {authUrl: string}>(
	functions,
	'beginGoogleHealthOAuth',
);
const syncGoogleHealthNow = httpsCallable(functions, 'syncGoogleHealthNow');
const beginGoogleCalendarOAuth = httpsCallable<undefined, {authUrl: string}>(
	functions,
	'beginGoogleCalendarOAuth',
);
const syncGoogleCalendarNow = httpsCallable(functions, 'syncGoogleCalendarNow');
const beginSwarmOAuth = httpsCallable<undefined, {authUrl: string}>(
	functions,
	'beginSwarmOAuth',
);
const syncSwarmNow = httpsCallable(functions, 'syncSwarmNow');
const beginGooglePhotosOAuth = httpsCallable<undefined, {authUrl: string}>(
	functions,
	'beginGooglePhotosOAuth',
);
const beginGooglePhotosPickerSession = httpsCallable<
	undefined,
	{pickerUri: string; sessionId: string}
>(functions, 'beginGooglePhotosPickerSession');
const getGooglePhotosPickerSessionStatus = httpsCallable<
	{sessionId: string},
	{mediaItemsSet: boolean}
>(functions, 'getGooglePhotosPickerSessionStatus');
const importGooglePhotosSelection = httpsCallable<
	{sessionId: string},
	{imported: number}
>(functions, 'importGooglePhotosSelection');
const importGoogleMapsTimelineChunk = httpsCallable<
	{segments: Record<string, unknown>[]},
	{imported: number; skipped: number}
>(functions, 'importGoogleMapsTimelineChunk');
const dedupeLogEntriesNow = httpsCallable<
	{dateFrom: string; dateTo: string},
	{status: string; datesProcessed: number}
>(functions, 'dedupeLogEntriesNow');

// ── OAuth接続型データソース(Google Health / Google Calendar / Swarm) ──────

const OAuthDataSourceCard = (props: {
	id: string;
	displayName: string;
	beginOAuth: HttpsCallable<undefined, {authUrl: string}>;
	syncNow: HttpsCallable<unknown, unknown>;
}) => {
	const dataSourceState = useFirestore(doc(DataSources, props.id));
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleConnect = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await props.beginOAuth();
			window.location.href = result.data.authUrl;
		} catch {
			setError('接続の開始に失敗しました。');
			setBusy(false);
		}
	};

	const handleSync = async () => {
		setBusy(true);
		setError(null);
		try {
			await props.syncNow();
		} catch {
			setError('同期に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	const connectButton = (
		<button
			type="button"
			onClick={handleConnect}
			disabled={busy()}
			class="btn btn-primary"
		>
			{busy() ? '接続中...' : '接続'}
		</button>
	);

	return (
		<li class="flex flex-col gap-2 border-divider border-b-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-heading font-extrabold">{props.displayName}</p>
				<Doc
					data={dataSourceState}
					fallback={
						<p class="text-[13px] text-text/55">
							状態: {STATUS_LABEL.disconnected}
						</p>
					}
				>
					{(data) => (
						<>
							<p class="text-[13px] text-text/55">
								状態: {STATUS_LABEL[data.status]}
							</p>
							{data.lastSyncedAt && (
								<p class="text-[13px] text-text/55">
									最終同期: {formatDateTime(data.lastSyncedAt.toDate())}
								</p>
							)}
							{data.lastSyncError && (
								<p class="text-[13px] text-accent">{data.lastSyncError}</p>
							)}
						</>
					)}
				</Doc>
				{error() && <p class="text-[13px] text-accent">{error()}</p>}
			</div>
			<div>
				<Doc data={dataSourceState} fallback={connectButton}>
					{(data) =>
						data.status === 'connected' ? (
							<button
								type="button"
								onClick={handleSync}
								disabled={busy()}
								class="btn btn-secondary"
							>
								{busy() ? '同期中...' : '今すぐ同期'}
							</button>
						) : (
							connectButton
						)
					}
				</Doc>
			</div>
		</li>
	);
};

// ── Google Maps タイムライン(手動アップロード) ─────────────────────────

const MAPS_TIMELINE_CHUNK_SIZE = 400;

const GoogleMapsTimelineCard = () => {
	const dataSourceState = useFirestore(
		doc(DataSources, 'google_maps_timeline'),
	);
	const [pendingSegments, setPendingSegments] = createSignal<
		Record<string, unknown>[] | null
	>(null);
	const [counts, setCounts] = createSignal<{
		visit: number;
		activity: number;
	} | null>(null);
	const [progress, setProgress] = createSignal<{
		done: number;
		total: number;
	} | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleFileChange = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) {
			return;
		}
		setError(null);
		try {
			const text = await file.text();
			const data = JSON.parse(text) as {
				semanticSegments?: Record<string, unknown>[];
			};
			const segments = data.semanticSegments ?? [];
			const filtered = segments.filter(
				(segment) => 'visit' in segment || 'activity' in segment,
			);
			const visitCount = filtered.filter((s) => 'visit' in s).length;
			const activityCount = filtered.filter((s) => 'activity' in s).length;
			if (filtered.length === 0) {
				setError('インポート可能な訪問記録・移動記録が見つかりませんでした。');
				return;
			}
			setPendingSegments(filtered);
			setCounts({visit: visitCount, activity: activityCount});
		} catch {
			setError(
				'ファイルの読み込みに失敗しました。有効なタイムラインのエクスポートJSONか確認してください。',
			);
		}
	};

	const handleCancel = () => {
		setPendingSegments(null);
		setCounts(null);
	};

	const handleImport = async () => {
		const segments = pendingSegments();
		if (!segments) {
			return;
		}
		setBusy(true);
		setError(null);
		setProgress({done: 0, total: segments.length});
		try {
			for (let i = 0; i < segments.length; i += MAPS_TIMELINE_CHUNK_SIZE) {
				const chunk = segments.slice(i, i + MAPS_TIMELINE_CHUNK_SIZE);
				await importGoogleMapsTimelineChunk({segments: chunk});
				setProgress({
					done: Math.min(i + MAPS_TIMELINE_CHUNK_SIZE, segments.length),
					total: segments.length,
				});
			}
			setPendingSegments(null);
			setCounts(null);
		} catch {
			setError('インポート中にエラーが発生しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<li class="flex flex-col gap-2 border-divider border-b-2 pb-4">
			<div>
				<p class="font-heading font-extrabold">
					Google Maps タイムライン(手動インポート)
				</p>
				<p class="text-[12px] text-text/55">
					GoogleタイムラインからエクスポートしたJSONファイルをアップロードします。定期自動同期はありません。
				</p>
				<Doc
					data={dataSourceState}
					fallback={
						<p class="text-[13px] text-text/55">
							状態: {STATUS_LABEL.disconnected}
						</p>
					}
				>
					{(data) => (
						<>
							<p class="text-[13px] text-text/55">
								状態: {STATUS_LABEL[data.status]}
							</p>
							{data.lastSyncedAt && (
								<p class="text-[13px] text-text/55">
									最終インポート: {formatDateTime(data.lastSyncedAt.toDate())}
								</p>
							)}
						</>
					)}
				</Doc>
				{error() && <p class="text-[13px] text-accent">{error()}</p>}
			</div>
			<Show
				when={counts()}
				fallback={
					<div class="flex flex-col gap-1">
						<input
							type="file"
							accept="application/json"
							onChange={handleFileChange}
							disabled={busy()}
							class="input"
						/>
					</div>
				}
			>
				{(c) => (
					<div class="flex flex-col gap-2">
						<Show
							when={!busy()}
							fallback={
								<p class="text-[13px]">
									インポート中... {progress()?.done ?? 0} /{' '}
									{progress()?.total ?? 0} 件処理済み
								</p>
							}
						>
							<p class="text-[13px]">
								訪問記録 {c().visit}件・移動記録 {c().activity}件(合計{' '}
								{c().visit + c().activity}件)をインポートします。よろしいですか?
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									onClick={handleImport}
									class="btn btn-primary"
								>
									インポート
								</button>
								<button
									type="button"
									onClick={handleCancel}
									class="btn btn-secondary"
								>
									キャンセル
								</button>
							</div>
						</Show>
					</div>
				)}
			</Show>
		</li>
	);
};

// ── Google Photos(Picker APIによる手動インポート) ──────────────────────

const PICKER_POLL_INTERVAL_MS = 3000;

const GooglePhotosCard = () => {
	const dataSourceState = useFirestore(doc(DataSources, 'google_photos'));
	const [busy, setBusy] = createSignal(false);
	const [pickerStatus, setPickerStatus] = createSignal<
		'idle' | 'waiting' | 'importing'
	>('idle');
	const [error, setError] = createSignal<string | null>(null);
	const [importedCount, setImportedCount] = createSignal<number | null>(null);

	const handleConnect = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await beginGooglePhotosOAuth();
			window.location.href = result.data.authUrl;
		} catch {
			setError('接続の開始に失敗しました。');
			setBusy(false);
		}
	};

	const handlePickPhotos = async () => {
		setBusy(true);
		setError(null);
		setImportedCount(null);
		try {
			const beginResult = await beginGooglePhotosPickerSession();
			const {pickerUri, sessionId} = beginResult.data;
			window.open(pickerUri, '_blank', 'noopener,noreferrer');
			setPickerStatus('waiting');

			await new Promise<void>((resolve, reject) => {
				const interval = setInterval(() => {
					getGooglePhotosPickerSessionStatus({sessionId})
						.then((statusResult) => {
							if (statusResult.data.mediaItemsSet) {
								clearInterval(interval);
								resolve();
							}
						})
						.catch((err: unknown) => {
							clearInterval(interval);
							reject(err);
						});
				}, PICKER_POLL_INTERVAL_MS);
			});

			setPickerStatus('importing');
			const importResult = await importGooglePhotosSelection({sessionId});
			setImportedCount(importResult.data.imported);
			setPickerStatus('idle');
		} catch {
			setError('写真の選択・インポートに失敗しました。');
			setPickerStatus('idle');
		} finally {
			setBusy(false);
		}
	};

	const connectButton = (
		<button
			type="button"
			onClick={handleConnect}
			disabled={busy()}
			class="btn btn-primary"
		>
			{busy() ? '接続中...' : '接続'}
		</button>
	);

	return (
		<li class="flex flex-col gap-2 border-divider border-b-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-heading font-extrabold">Google Photos(手動インポート)</p>
				<p class="text-[12px] text-text/55">
					Google側の仕様変更により自動同期はできません。選択した写真のみインポートされます。
				</p>
				<Doc
					data={dataSourceState}
					fallback={
						<p class="text-[13px] text-text/55">
							状態: {STATUS_LABEL.disconnected}
						</p>
					}
				>
					{(data) => (
						<p class="text-[13px] text-text/55">
							状態: {STATUS_LABEL[data.status]}
						</p>
					)}
				</Doc>
				{importedCount() !== null && (
					<p class="text-[13px] text-text/55">
						{importedCount()}件の写真をインポートしました。
					</p>
				)}
				{error() && <p class="text-[13px] text-accent">{error()}</p>}
			</div>
			<div>
				<Doc data={dataSourceState} fallback={connectButton}>
					{(data) =>
						data.status === 'connected' ? (
							<button
								type="button"
								onClick={handlePickPhotos}
								disabled={busy()}
								class="btn btn-secondary"
							>
								{pickerStatus() === 'waiting'
									? '選択待ち...'
									: pickerStatus() === 'importing'
										? 'インポート中...'
										: '写真を選択してインポート'}
							</button>
						) : (
							connectButton
						)
					}
				</Doc>
			</div>
		</li>
	);
};

// ── メンテナンス: 重複統合の手動再実行 ─────────────────────────────────

const MaintenanceSection = () => {
	const [dateFrom, setDateFrom] = createSignal(
		shiftDateString(getTodayDateString(), -30),
	);
	const [dateTo, setDateTo] = createSignal(getTodayDateString());
	const [busy, setBusy] = createSignal(false);
	const [result, setResult] = createSignal<string | null>(null);

	const handleDedupe = async () => {
		setBusy(true);
		setResult(null);
		try {
			const response = await dedupeLogEntriesNow({
				dateFrom: dateFrom(),
				dateTo: dateTo(),
			});
			setResult(
				`${response.data.datesProcessed}日分の重複統合を実行しました。`,
			);
		} catch {
			setResult('重複統合の実行に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div class="flex flex-col gap-2">
			<h2 class="font-heading text-base font-extrabold">メンテナンス</h2>
			<p class="text-[12px] text-text/55">
				Google
				Maps訪問記録とSwarmチェックインの重複統合を指定期間で再実行します。
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<input
					type="date"
					value={dateFrom()}
					onInput={(e) => setDateFrom(e.currentTarget.value)}
					class="input w-auto"
				/>
				<span class="text-[13px]">〜</span>
				<input
					type="date"
					value={dateTo()}
					onInput={(e) => setDateTo(e.currentTarget.value)}
					class="input w-auto"
				/>
				<button
					type="button"
					onClick={handleDedupe}
					disabled={busy()}
					class="btn btn-secondary"
				>
					{busy() ? '実行中...' : '重複を統合'}
				</button>
			</div>
			{result() && <p class="text-[13px] text-text/55">{result()}</p>}
		</div>
	);
};

const DataSourcesPage = () => (
	<AppShell>
		<div class="mx-auto flex max-w-3xl flex-col gap-6">
			<h1 class="font-heading text-xl font-extrabold">データソース管理</h1>
			<ul class="flex flex-col gap-4">
				<OAuthDataSourceCard
					id="google_health"
					displayName="Google Health (運動記録)"
					beginOAuth={beginGoogleHealthOAuth}
					syncNow={syncGoogleHealthNow}
				/>
				<OAuthDataSourceCard
					id="google_calendar"
					displayName="Google Calendar (予定)"
					beginOAuth={beginGoogleCalendarOAuth}
					syncNow={syncGoogleCalendarNow}
				/>
				<OAuthDataSourceCard
					id="swarm"
					displayName="Swarm (チェックイン履歴)"
					beginOAuth={beginSwarmOAuth}
					syncNow={syncSwarmNow}
				/>
				<GoogleMapsTimelineCard />
				<GooglePhotosCard />
			</ul>
			<hr class="hr" />
			<MaintenanceSection />
		</div>
	</AppShell>
);

export default DataSourcesPage;
