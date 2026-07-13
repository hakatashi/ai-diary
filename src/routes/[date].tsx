import {A, Navigate, useParams} from '@solidjs/router';
import {orderBy, query, where} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import MemoEditor from '~/components/MemoEditor';
import Collection from '~/lib/Collection';
import {
	formatTime,
	getTodayDateString,
	isValidDateString,
	shiftDateString,
} from '~/lib/date';
import {LogEntries} from '~/lib/firebase';
import type {LogEntry} from '~/lib/schema.ts';

const LogEntryItem = (entry: LogEntry) => (
	<li class="rounded-md border border-slate-200 bg-white p-3">
		<div class="flex items-baseline justify-between gap-2">
			<span class="font-medium text-slate-800">{entry.title}</span>
			<span class="shrink-0 text-xs text-slate-500">
				{formatTime(entry.startAt.toDate())}
				{entry.endAt && ` - ${formatTime(entry.endAt.toDate())}`}
			</span>
		</div>
		{entry.summary && (
			<p class="mt-1 text-sm text-slate-600">{entry.summary}</p>
		)}
		{entry.metrics && (
			<dl class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
				{entry.metrics.durationMinutes !== undefined && (
					<div>
						<dt class="inline font-medium">時間: </dt>
						<dd class="inline">{entry.metrics.durationMinutes}分</dd>
					</div>
				)}
				{entry.metrics.distanceMeters !== undefined && (
					<div>
						<dt class="inline font-medium">距離: </dt>
						<dd class="inline">
							{(entry.metrics.distanceMeters / 1000).toFixed(2)}km
						</dd>
					</div>
				)}
				{entry.metrics.calories !== undefined && (
					<div>
						<dt class="inline font-medium">消費カロリー: </dt>
						<dd class="inline">{entry.metrics.calories}kcal</dd>
					</div>
				)}
				{entry.metrics.avgHeartRate !== undefined && (
					<div>
						<dt class="inline font-medium">平均心拍数: </dt>
						<dd class="inline">{entry.metrics.avgHeartRate}bpm</dd>
					</div>
				)}
			</dl>
		)}
	</li>
);

const JournalPage = () => {
	const params = useParams<{date: string}>();
	const logEntriesState = useFirestore(() =>
		query(LogEntries, where('date', '==', params.date), orderBy('startAt')),
	);

	return (
		<Show
			when={isValidDateString(params.date)}
			fallback={<Navigate href={`/${getTodayDateString()}`} />}
		>
			<AppShell>
				<div class="mx-auto flex max-w-5xl flex-col gap-4">
					<div class="flex items-center justify-between">
						<A
							href={`/${shiftDateString(params.date, -1)}`}
							class="rounded-md px-3 py-1 text-slate-600 hover:bg-slate-200"
						>
							← 前日
						</A>
						<h1 class="text-xl font-semibold text-slate-800">{params.date}</h1>
						<A
							href={`/${shiftDateString(params.date, 1)}`}
							class="rounded-md px-3 py-1 text-slate-600 hover:bg-slate-200"
						>
							翌日 →
						</A>
					</div>
					<div class="flex flex-col gap-4 lg:h-[calc(100vh-10rem)] lg:flex-row">
						<aside class="shrink-0 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-400 lg:w-2/5 lg:overflow-y-auto">
							写真・GPSログなどのグラフィカルな表示は今後追加予定です。
						</aside>
						<section class="flex flex-1 flex-col gap-4 lg:overflow-y-auto">
							<MemoEditor date={params.date} />
							<ul class="flex flex-col gap-2">
								<Collection
									data={logEntriesState}
									empty={
										<p class="text-sm text-slate-400">
											この日の記録はまだありません。
										</p>
									}
								>
									{(entry) => <LogEntryItem {...entry} />}
								</Collection>
							</ul>
						</section>
					</div>
				</div>
			</AppShell>
		</Show>
	);
};

export default JournalPage;
