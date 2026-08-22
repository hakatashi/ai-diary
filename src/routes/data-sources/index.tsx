import {doc} from 'firebase/firestore';
import {type HttpsCallable, httpsCallable} from 'firebase/functions';
import {useFirestore} from 'solid-firebase';
import {createSignal, Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import Doc from '~/lib/Doc';
import {formatDateTime, getTodayDateString, shiftDateString} from '~/lib/date';
import {DataSources, functions} from '~/lib/firebase';
import {
	type MoneyforwardCsvRow,
	parseMoneyforwardCsv,
} from '~/lib/moneyforwardCsv';
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
const connectImmich = httpsCallable<
	{serverUrl: string; apiKey: string},
	{status: 'ok'; email: string}
>(functions, 'connectImmich');
const syncImmichNow = httpsCallable<{fullBackfill?: boolean}, unknown>(
	functions,
	'syncImmichNow',
);
const connectPlaynite = httpsCallable<
	undefined,
	{status: 'ok'; ingestToken: string}
>(functions, 'connectPlaynite');
const importGoogleMapsTimelineChunk = httpsCallable<
	{segments: Record<string, unknown>[]},
	{imported: number; skipped: number}
>(functions, 'importGoogleMapsTimelineChunk', {timeout: 300_000});
const beginZaimOAuth = httpsCallable<undefined, {authUrl: string}>(
	functions,
	'beginZaimOAuth',
);
const syncZaimNow = httpsCallable(functions, 'syncZaimNow');
const importMoneyforwardRows = httpsCallable<
	{rows: MoneyforwardCsvRow[]},
	{imported: number}
>(functions, 'importMoneyforwardRows', {timeout: 300_000});
const dedupeLogEntriesNow = httpsCallable<
	{dateFrom: string; dateTo: string},
	{status: string; datesProcessed: number}
>(functions, 'dedupeLogEntriesNow');
const applyFinanceRulesNow = httpsCallable<
	{dateFrom: string; dateTo: string},
	{status: string; updated: number}
>(functions, 'applyFinanceRulesNow');
const disconnectDataSource = httpsCallable<
	{dataSourceId: string},
	{status: 'ok'}
>(functions, 'disconnectDataSource');

// ── 認証解除(再認証を可能にするため、保存済みの認証情報を削除する) ────────

const DisconnectButton = (props: {
	dataSourceId: string;
	onDisconnected: () => void;
}) => {
	const [confirming, setConfirming] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleDisconnect = async () => {
		setBusy(true);
		setError(null);
		try {
			await disconnectDataSource({dataSourceId: props.dataSourceId});
			setConfirming(false);
			props.onDisconnected();
		} catch {
			setError('認証解除に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<Show
			when={confirming()}
			fallback={
				<button
					type="button"
					onClick={() => setConfirming(true)}
					class="btn btn-secondary"
				>
					認証解除
				</button>
			}
		>
			<div class="flex flex-col items-end gap-1">
				<p class="text-[13px] text-accent">
					認証情報を削除します。再度接続するには認証をやり直す必要があります。よろしいですか?
				</p>
				{error() && <p class="text-[13px] text-accent">{error()}</p>}
				<div class="flex gap-2">
					<button
						type="button"
						onClick={handleDisconnect}
						disabled={busy()}
						class="btn btn-primary"
					>
						{busy() ? '解除中...' : '解除する'}
					</button>
					<button
						type="button"
						onClick={() => setConfirming(false)}
						disabled={busy()}
						class="btn btn-secondary"
					>
						キャンセル
					</button>
				</div>
			</div>
		</Show>
	);
};

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
							<div class="flex flex-col items-end gap-2">
								<button
									type="button"
									onClick={handleSync}
									disabled={busy()}
									class="btn btn-secondary"
								>
									{busy() ? '同期中...' : '今すぐ同期'}
								</button>
								<DisconnectButton
									dataSourceId={props.id}
									onDisconnected={() => {}}
								/>
							</div>
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
		path: number;
		memory: number;
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
			// 中断されても新しい(=直近の)データが優先的に取り込まれるよう、
			// 日時が新しい順に並べ替えてからインポートする。
			const filtered = segments
				.filter(
					(segment) =>
						'visit' in segment ||
						'activity' in segment ||
						'timelinePath' in segment ||
						'timelineMemory' in segment,
				)
				.sort((a, b) => {
					const aTime = Date.parse((a as {startTime?: string}).startTime ?? '');
					const bTime = Date.parse((b as {startTime?: string}).startTime ?? '');
					return bTime - aTime;
				});
			const visitCount = filtered.filter((s) => 'visit' in s).length;
			const activityCount = filtered.filter((s) => 'activity' in s).length;
			const pathCount = filtered.filter((s) => 'timelinePath' in s).length;
			const memoryCount = filtered.filter((s) => 'timelineMemory' in s).length;
			if (filtered.length === 0) {
				setError('インポート可能な訪問記録・移動記録が見つかりませんでした。');
				return;
			}
			setPendingSegments(filtered);
			setCounts({
				visit: visitCount,
				activity: activityCount,
				path: pathCount,
				memory: memoryCount,
			});
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
								訪問記録 {c().visit}件・移動記録 {c().activity}件・GPS経路{' '}
								{c().path}件・思い出メモ {c().memory}件(合計{' '}
								{c().visit + c().activity + c().path + c().memory}
								件)をインポートします。よろしいですか?
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

// ── Immich(自己ホスト、APIキーによる接続) ────────────────────────────

const ImmichCard = () => {
	const dataSourceState = useFirestore(doc(DataSources, 'immich'));
	const [serverUrl, setServerUrl] = createSignal('');
	const [apiKey, setApiKey] = createSignal('');
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [connectedEmail, setConnectedEmail] = createSignal<string | null>(null);

	const handleConnect = async (event: Event) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const result = await connectImmich({
				serverUrl: serverUrl(),
				apiKey: apiKey(),
			});
			setConnectedEmail(result.data.email);
			setApiKey('');
		} catch {
			setError('接続に失敗しました。サーバーURLとAPIキーを確認してください。');
		} finally {
			setBusy(false);
		}
	};

	const handleSync = async (fullBackfill: boolean) => {
		setBusy(true);
		setError(null);
		try {
			await syncImmichNow({fullBackfill});
		} catch {
			setError('同期に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	const connectForm = (
		<form onSubmit={handleConnect} class="flex flex-col gap-2">
			<input
				type="url"
				placeholder="サーバーURL(https://immich.example.com/api)"
				value={serverUrl()}
				onInput={(e) => setServerUrl(e.currentTarget.value)}
				required
				class="input"
			/>
			<input
				type="password"
				placeholder="APIキー"
				value={apiKey()}
				onInput={(e) => setApiKey(e.currentTarget.value)}
				required
				class="input"
			/>
			<button
				type="submit"
				disabled={busy()}
				class="btn btn-primary self-start"
			>
				{busy() ? '接続中...' : '接続'}
			</button>
		</form>
	);

	return (
		<li class="flex flex-col gap-2 border-divider border-b-2 pb-4">
			<div>
				<p class="font-heading font-extrabold">Immich(自己ホスト写真管理)</p>
				<p class="text-[12px] text-text/55">
					サーバーURL(例:
					https://immich.example.com/api)とAPIキーを入力して接続します。
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
									最終同期: {formatDateTime(data.lastSyncedAt.toDate())}
								</p>
							)}
							{data.lastSyncError && (
								<p class="text-[13px] text-accent">{data.lastSyncError}</p>
							)}
						</>
					)}
				</Doc>
				{connectedEmail() && (
					<p class="text-[13px] text-text/55">
						{connectedEmail()} として接続しました。
					</p>
				)}
				{error() && <p class="text-[13px] text-accent">{error()}</p>}
			</div>
			<Doc data={dataSourceState} fallback={connectForm}>
				{(data) =>
					data.status === 'connected' ? (
						<div class="flex flex-col items-end gap-2">
							<div class="flex gap-2">
								<button
									type="button"
									onClick={() => handleSync(false)}
									disabled={busy()}
									class="btn btn-secondary"
								>
									{busy() ? '同期中...' : '今すぐ同期'}
								</button>
								<button
									type="button"
									onClick={() => handleSync(true)}
									disabled={busy()}
									class="btn btn-secondary"
								>
									{busy() ? '同期中...' : '全期間を同期'}
								</button>
							</div>
							<DisconnectButton
								dataSourceId="immich"
								onDisconnected={() => setConnectedEmail(null)}
							/>
						</div>
					) : (
						connectForm
					)
				}
			</Doc>
		</li>
	);
};

// ── Playnite(ローカルPC拡張からのpush、専用ingestトークンによる接続) ────────

const PLAYNITE_INGEST_URL =
	'https://asia-northeast1-hakatadiary.cloudfunctions.net/recordPlayniteSession';

const PlayniteCard = () => {
	const dataSourceState = useFirestore(doc(DataSources, 'playnite'));
	const [issuedToken, setIssuedToken] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleConnect = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await connectPlaynite();
			setIssuedToken(result.data.ingestToken);
		} catch {
			setError('トークンの発行に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<li class="flex flex-col gap-2 border-divider border-b-2 pb-4">
			<div>
				<p class="font-heading font-extrabold">Playnite (PCゲームプレイ記録)</p>
				<p class="text-[12px] text-text/55">
					Playnite拡張(PowerShellスクリプト)がゲーム終了時にプレイ記録をpushします。定期自動同期はなく、接続するとingestトークンが一度だけ表示されるので拡張の設定ファイルにコピーしてください。
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
									最終受信: {formatDateTime(data.lastSyncedAt.toDate())}
								</p>
							)}
							{data.lastSyncError && (
								<p class="text-[13px] text-accent">{data.lastSyncError}</p>
							)}
						</>
					)}
				</Doc>
				{issuedToken() && (
					<div class="mt-2 flex flex-col gap-1 border-divider border-2 p-2">
						<p class="text-[13px]">
							ingestトークン(この画面を離れると再表示できません):
						</p>
						<code class="break-all text-[12px]">{issuedToken()}</code>
						<p class="text-[12px] text-text/55">
							エンドポイント: {PLAYNITE_INGEST_URL}
						</p>
					</div>
				)}
				{error() && <p class="text-[13px] text-accent">{error()}</p>}
			</div>
			<Doc
				data={dataSourceState}
				fallback={
					<button
						type="button"
						onClick={handleConnect}
						disabled={busy()}
						class="btn btn-primary self-start"
					>
						{busy() ? '発行中...' : '接続'}
					</button>
				}
			>
				{(data) => (
					<div class="flex flex-col items-end gap-2">
						<div class="flex gap-2">
							<button
								type="button"
								onClick={handleConnect}
								disabled={busy()}
								class="btn btn-secondary"
							>
								{busy() ? '発行中...' : 'トークンを再発行'}
							</button>
						</div>
						{data.status === 'connected' && (
							<DisconnectButton
								dataSourceId="playnite"
								onDisconnected={() => setIssuedToken(null)}
							/>
						)}
					</div>
				)}
			</Doc>
		</li>
	);
};

// ── Moneyforward(手動CSVアップロード、Shift_JIS) ─────────────────────────

const MONEYFORWARD_CHUNK_SIZE = 400;

const MoneyforwardCard = () => {
	const dataSourceState = useFirestore(doc(DataSources, 'moneyforward'));
	const [pendingRows, setPendingRows] = createSignal<
		MoneyforwardCsvRow[] | null
	>(null);
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
			const buffer = await file.arrayBuffer();
			const text = new TextDecoder('shift_jis').decode(buffer);
			const rows = parseMoneyforwardCsv(text);
			if (rows.length === 0) {
				setError('取り込み可能な明細が見つかりませんでした。');
				return;
			}
			setPendingRows(rows);
		} catch {
			setError(
				'ファイルの読み込みに失敗しました。Moneyforwardの「収入・支出詳細」CSVか確認してください。',
			);
		}
	};

	const handleCancel = () => setPendingRows(null);

	const handleImport = async () => {
		const rows = pendingRows();
		if (!rows) {
			return;
		}
		setBusy(true);
		setError(null);
		setProgress({done: 0, total: rows.length});
		try {
			for (let i = 0; i < rows.length; i += MONEYFORWARD_CHUNK_SIZE) {
				const chunk = rows.slice(i, i + MONEYFORWARD_CHUNK_SIZE);
				await importMoneyforwardRows({rows: chunk});
				setProgress({
					done: Math.min(i + MONEYFORWARD_CHUNK_SIZE, rows.length),
					total: rows.length,
				});
			}
			setPendingRows(null);
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
					Moneyforward(手動CSVインポート)
				</p>
				<p class="text-[12px] text-text/55">
					「収入・支出詳細」でエクスポートしたCSV(Shift_JIS)をアップロードします。定期自動同期はありません。
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
				when={pendingRows()}
				fallback={
					<input
						type="file"
						accept=".csv"
						onChange={handleFileChange}
						disabled={busy()}
						class="input"
					/>
				}
			>
				{(rows) => (
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
								{rows().length}件の明細をインポートします。よろしいですか?
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

// ── メンテナンス: 重複統合の手動再実行 ─────────────────────────────────

const MaintenanceSection = () => {
	const [dateFrom, setDateFrom] = createSignal(
		shiftDateString(getTodayDateString(), -30),
	);
	const [dateTo, setDateTo] = createSignal(getTodayDateString());
	const [busy, setBusy] = createSignal(false);
	const [result, setResult] = createSignal<string | null>(null);

	const [rulesDateFrom, setRulesDateFrom] = createSignal(
		shiftDateString(getTodayDateString(), -30),
	);
	const [rulesDateTo, setRulesDateTo] = createSignal(getTodayDateString());
	const [rulesBusy, setRulesBusy] = createSignal(false);
	const [rulesResult, setRulesResult] = createSignal<string | null>(null);

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

	const handleApplyFinanceRules = async () => {
		setRulesBusy(true);
		setRulesResult(null);
		try {
			const response = await applyFinanceRulesNow({
				dateFrom: rulesDateFrom(),
				dateTo: rulesDateTo(),
			});
			setRulesResult(`${response.data.updated}件のカテゴリを更新しました。`);
		} catch {
			setRulesResult('ルールの再適用に失敗しました。');
		} finally {
			setRulesBusy(false);
		}
	};

	return (
		<div class="flex flex-col gap-4">
			<h2 class="font-heading text-base font-extrabold">メンテナンス</h2>
			<div class="flex flex-col gap-2">
				<p class="text-[12px] text-text/55">
					Google
					Maps訪問記録とSwarmチェックイン、Zaim記録とMoneyforward明細の重複統合を指定期間で再実行します。
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
			<div class="flex flex-col gap-2">
				<p class="text-[12px] text-text/55">
					家計簿の自動振り分けルール(
					<a href="/finance" class="underline">
						/finance
					</a>{' '}
					で管理)を指定期間の既存記録へ再適用します。
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<input
						type="date"
						value={rulesDateFrom()}
						onInput={(e) => setRulesDateFrom(e.currentTarget.value)}
						class="input w-auto"
					/>
					<span class="text-[13px]">〜</span>
					<input
						type="date"
						value={rulesDateTo()}
						onInput={(e) => setRulesDateTo(e.currentTarget.value)}
						class="input w-auto"
					/>
					<button
						type="button"
						onClick={handleApplyFinanceRules}
						disabled={rulesBusy()}
						class="btn btn-secondary"
					>
						{rulesBusy() ? '実行中...' : 'ルールを再適用'}
					</button>
				</div>
				{rulesResult() && (
					<p class="text-[13px] text-text/55">{rulesResult()}</p>
				)}
			</div>
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
				<OAuthDataSourceCard
					id="zaim"
					displayName="Zaim (家計簿)"
					beginOAuth={beginZaimOAuth}
					syncNow={syncZaimNow}
				/>
				<MoneyforwardCard />
				<GoogleMapsTimelineCard />
				<ImmichCard />
				<PlayniteCard />
			</ul>
			<hr class="hr" />
			<MaintenanceSection />
		</div>
	</AppShell>
);

export default DataSourcesPage;
