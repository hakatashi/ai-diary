import {doc, serverTimestamp, setDoc} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {createEffect, createSignal} from 'solid-js';
import {JournalEntries} from '~/lib/firebase';

const MemoEditor = (props: {date: string}) => {
	const journalRef = () => doc(JournalEntries, props.date);
	const journalState = useFirestore(journalRef);
	const [memo, setMemo] = createSignal('');
	const [saving, setSaving] = createSignal(false);

	createEffect(() => {
		if (!journalState.loading) {
			setMemo(journalState.data?.memo ?? '');
		}
	});

	const handleSave = async () => {
		setSaving(true);
		try {
			await setDoc(
				journalRef(),
				{
					date: props.date,
					memo: memo(),
					updatedAt: serverTimestamp(),
					...(journalState.data ? {} : {createdAt: serverTimestamp()}),
				},
				{merge: true},
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div class="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-4">
			<h2 class="font-semibold text-slate-700">メモ</h2>
			<textarea
				class="min-h-32 rounded-md border border-slate-300 p-2 text-sm"
				value={memo()}
				onInput={(event) => setMemo(event.currentTarget.value)}
				placeholder="今日の出来事を記録..."
			/>
			<button
				type="button"
				onClick={handleSave}
				disabled={saving()}
				class="self-start rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
			>
				{saving() ? '保存中...' : '保存'}
			</button>
		</div>
	);
};

export default MemoEditor;
