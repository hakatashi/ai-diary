import {A, Navigate, useParams} from '@solidjs/router';
import {orderBy, query, where} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {type JSX, Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import {
	ActivityIcon,
	CalendarIcon,
	CheckinIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	LocationIcon,
	MapIcon,
	PhotoIcon,
} from '~/components/icons';
import MemoEditor from '~/components/MemoEditor';
import Collection from '~/lib/Collection';
import {
	formatJournalDate,
	formatTime,
	getTodayDateString,
	isValidDateString,
	shiftDateString,
} from '~/lib/date';
import {LogEntries} from '~/lib/firebase';
import {visibleLogEntries} from '~/lib/logEntries';
import type {LogEntry, LogEntryCategory} from '~/lib/schema.ts';

const CATEGORY_ICON: Record<
	LogEntryCategory,
	(props: {size?: number}) => JSX.Element
> = {
	exercise: ActivityIcon,
	location: LocationIcon,
	checkin: CheckinIcon,
	calendar: CalendarIcon,
	photo: PhotoIcon,
};

const DateNav = (props: {date: string}) => (
	<>
		<A
			href={`/${shiftDateString(props.date, -1)}`}
			class="btn btn-secondary btn-icon"
			aria-label="前日"
		>
			<ChevronLeftIcon />
		</A>
		<span class="min-w-[200px] text-center font-heading text-base font-extrabold">
			{formatJournalDate(props.date)}
		</span>
		<A
			href={`/${shiftDateString(props.date, 1)}`}
			class="btn btn-secondary btn-icon"
			aria-label="翌日"
		>
			<ChevronRightIcon />
		</A>
	</>
);

const LogEntryItem = (props: {entry: LogEntry; isLast: boolean}) => {
	const entry = props.entry;
	const Icon = CATEGORY_ICON[entry.category] ?? ActivityIcon;
	return (
		<div class="relative flex gap-4 pb-6">
			{!props.isLast && (
				<div class="absolute top-7 bottom-0 left-[13px] w-0.5 bg-divider" />
			)}
			<div class="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-divider bg-bg">
				<Icon size={14} />
			</div>
			<div class="flex-1 pt-0.5">
				<div class="flex items-baseline justify-between gap-2">
					<span class="font-heading text-[15px] font-extrabold">
						{entry.title}
					</span>
					<span class="flex-none text-[11px] text-text/55">
						{formatTime(entry.startAt.toDate())}
						{entry.endAt && ` - ${formatTime(entry.endAt.toDate())}`}
					</span>
				</div>
				{entry.summary && (
					<p class="mt-1.5 text-[13px] opacity-80">{entry.summary}</p>
				)}
				{entry.metrics && (
					<div class="mt-2 flex flex-wrap gap-1.5">
						{entry.metrics.distanceMeters !== undefined && (
							<span class="tag tag-neutral">
								距離 {(entry.metrics.distanceMeters / 1000).toFixed(2)}km
							</span>
						)}
						{entry.metrics.durationMinutes !== undefined && (
							<span class="tag tag-neutral">
								{entry.metrics.durationMinutes}分
							</span>
						)}
						{entry.metrics.calories !== undefined && (
							<span class="tag tag-neutral">{entry.metrics.calories}kcal</span>
						)}
						{entry.metrics.avgHeartRate !== undefined && (
							<span class="tag tag-neutral">
								平均心拍 {entry.metrics.avgHeartRate}bpm
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
};

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
			<AppShell fullBleed dateNav={() => <DateNav date={params.date} />}>
				<div class="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
					<div
						class="flex h-56 shrink-0 items-center justify-center border-divider border-b-2 bg-surface lg:h-full lg:w-1/2 lg:border-r-2 lg:border-b-0"
						style="background-image:linear-gradient(var(--color-neutral-300) 1px, transparent 1px),linear-gradient(90deg, var(--color-neutral-300) 1px, transparent 1px);background-size:40px 40px;"
					>
						<div class="flex flex-col items-center gap-3 px-8 text-center">
							<MapIcon size={28} class="text-text/35" />
							<p class="max-w-xs text-[13px] text-text/55">
								GPSログ・写真は今後のフェーズで追加予定です。
							</p>
						</div>
					</div>

					<div class="flex flex-1 flex-col gap-6 px-7 pt-6 pb-10 lg:min-h-0 lg:w-1/2 lg:overflow-y-auto">
						<MemoEditor date={params.date} />
						<hr class="hr" />
						<div class="flex flex-col">
							<Collection
								data={visibleLogEntries(logEntriesState)}
								empty={
									<p class="text-[13px] text-text/55">
										この日の記録はまだありません。
									</p>
								}
							>
								{(entry, index) => (
									<LogEntryItem
										entry={entry}
										isLast={
											index() ===
											(visibleLogEntries(logEntriesState).data?.length ?? 0) - 1
										}
									/>
								)}
							</Collection>
						</div>
					</div>
				</div>
			</AppShell>
		</Show>
	);
};

export default JournalPage;
