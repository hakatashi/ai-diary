import {A} from '@solidjs/router';
import type {JSX} from 'solid-js';
import {signOut} from '~/lib/firebase';

const AppShell = (props: {children: JSX.Element}) => (
	<div class="min-h-screen bg-slate-50">
		<header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
			<A href="/" class="text-lg font-semibold text-slate-800">
				ai-diary
			</A>
			<nav class="flex items-center gap-4 text-sm text-slate-600">
				<A href="/data-sources" class="hover:text-slate-900">
					データソース
				</A>
				<A href="/settings" class="hover:text-slate-900">
					設定
				</A>
				<button
					type="button"
					onClick={() => signOut()}
					class="hover:text-slate-900"
				>
					サインアウト
				</button>
			</nav>
		</header>
		<main class="p-4">{props.children}</main>
	</div>
);

export default AppShell;
