import {A, Navigate, useParams} from '@solidjs/router';
import {orderBy, query, where} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {createMemo, For, Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import {ChevronLeftIcon, ChevronRightIcon} from '~/components/icons';
import {
	formatMonthLabel,
	getCurrentMonthString,
	getDaysInMonth,
	getWeekdayIndex,
	isValidMonthString,
	shiftMonthString,
} from '~/lib/date';
import {LogEntries} from '~/lib/firebase';
import {visibleLogEntries} from '~/lib/logEntries';
import type {LogEntry} from '~/lib/schema.ts';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

const MonthNav = (props: {month: string}) => (
	<>
		<A
			href={`/calendar/${shiftMonthString(props.month, -1)}`}
			class="btn btn-secondary btn-icon"
			aria-label="前月"
		>
			<ChevronLeftIcon />
		</A>
		<span class="min-w-[140px] text-center font-heading text-base font-extrabold">
			{formatMonthLabel(props.month)}
		</span>
		<A
			href={`/calendar/${shiftMonthString(props.month, 1)}`}
			class="btn btn-secondary btn-icon"
			aria-label="翌月"
		>
			<ChevronRightIcon />
		</A>
	</>
);

const CalendarMonthView = (props: {month: string}) => {
	const days = createMemo(() => getDaysInMonth(props.month));
	const logEntriesState = useFirestore(() =>
		query(
			LogEntries,
			where('date', '>=', days()[0]),
			where('date', '<=', days()[days().length - 1]),
			orderBy('date'),
			orderBy('startAt'),
		),
	);

	const entriesByDate = createMemo(() => {
		const map = new Map<string, LogEntry[]>();
		const visible = visibleLogEntries(logEntriesState).data ?? [];
		for (const entry of visible) {
			const list = map.get(entry.date) ?? [];
			list.push(entry);
			map.set(entry.date, list);
		}
		return map;
	});

	const leadingBlanks = createMemo(() => getWeekdayIndex(days()[0]));

	return (
		<AppShell dateNav={() => <MonthNav month={props.month} />}>
			<div class="mx-auto flex max-w-4xl flex-col gap-4 p-6">
				<div class="grid grid-cols-7 gap-px bg-divider">
					<For each={WEEKDAY_LABELS}>
						{(label) => (
							<div class="bg-surface py-2 text-center font-heading text-[12px] font-extrabold">
								{label}
							</div>
						)}
					</For>
					<For each={Array.from({length: leadingBlanks()})}>
						{() => <div class="bg-bg" />}
					</For>
					<For each={days()}>
						{(date) => {
							const entries = () => entriesByDate().get(date) ?? [];
							return (
								<A
									href={`/${date}`}
									class="flex min-h-20 flex-col gap-1 bg-bg p-1.5 hover:bg-surface"
								>
									<span class="text-[12px] text-text/55">
										{Number(date.slice(-2))}
									</span>
									<div class="flex flex-wrap gap-1">
										<For each={entries().slice(0, 4)}>
											{() => (
												<span class="h-1.5 w-1.5 rounded-full bg-accent" />
											)}
										</For>
									</div>
									<Show when={entries().length > 0}>
										<span class="text-[10px] text-text/45">
											{entries().length}件
										</span>
									</Show>
								</A>
							);
						}}
					</For>
				</div>
			</div>
		</AppShell>
	);
};

const CalendarMonthPage = () => {
	const params = useParams<{month: string}>();

	return (
		<Show
			when={isValidMonthString(params.month)}
			fallback={<Navigate href={`/calendar/${getCurrentMonthString()}`} />}
		>
			<CalendarMonthView month={params.month} />
		</Show>
	);
};

export default CalendarMonthPage;
