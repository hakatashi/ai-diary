import {doc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {useFirestore} from 'solid-firebase';
import {createSignal} from 'solid-js';
import AppShell from '~/components/AppShell';
import {DataSources, functions} from '~/lib/firebase';
import type {DataSourceStatus} from '~/lib/schema.ts';

interface KnownDataSource {
	id: string;
	displayName: string;
	category: string;
}

const KNOWN_DATA_SOURCES: KnownDataSource[] = [
	{
		id: 'google_health',
		displayName: 'Google Health (運動記録)',
		category: 'fitness',
	},
];

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

const DataSourceCard = (props: {source: KnownDataSource}) => {
	const dataSourceState = useFirestore(doc(DataSources, props.source.id));
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const status = (): DataSourceStatus =>
		dataSourceState.data?.status ?? 'disconnected';

	const handleConnect = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await beginGoogleHealthOAuth();
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
			await syncGoogleHealthNow();
		} catch {
			setError('同期に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<li class="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-medium text-slate-800">{props.source.displayName}</p>
				<p class="text-sm text-slate-500">状態: {STATUS_LABEL[status()]}</p>
				{dataSourceState.data?.lastSyncedAt && (
					<p class="text-sm text-slate-500">
						最終同期:{' '}
						{dataSourceState.data.lastSyncedAt.toDate().toLocaleString('ja-JP')}
					</p>
				)}
				{dataSourceState.data?.lastSyncError && (
					<p class="text-sm text-red-600">
						{dataSourceState.data.lastSyncError}
					</p>
				)}
				{error() && <p class="text-sm text-red-600">{error()}</p>}
			</div>
			<div>
				{status() === 'connected' ? (
					<button
						type="button"
						onClick={handleSync}
						disabled={busy()}
						class="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
					>
						{busy() ? '同期中...' : '今すぐ同期'}
					</button>
				) : (
					<button
						type="button"
						onClick={handleConnect}
						disabled={busy()}
						class="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
					>
						接続
					</button>
				)}
			</div>
		</li>
	);
};

const DataSourcesPage = () => (
	<AppShell>
		<div class="mx-auto flex max-w-3xl flex-col gap-4">
			<h1 class="text-xl font-semibold text-slate-800">データソース管理</h1>
			<ul class="flex flex-col gap-2">
				{KNOWN_DATA_SOURCES.map((source) => (
					<DataSourceCard source={source} />
				))}
			</ul>
		</div>
	</AppShell>
);

export default DataSourcesPage;
