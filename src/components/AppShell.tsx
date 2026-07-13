import {A} from '@solidjs/router';
import {type JSX, Show} from 'solid-js';
import {signOut} from '~/lib/firebase';

const AppShell = (props: {
	children: JSX.Element;
	fullBleed?: boolean;
	dateNav?: () => JSX.Element;
}) => (
	<div class="flex h-screen flex-col overflow-hidden">
		<header class="nav relative shrink-0">
			<A href="/" class="nav-brand">
				ai-diary
			</A>
			<Show when={props.dateNav}>
				{(dateNav) => (
					<div class="-translate-x-1/2 absolute left-1/2 hidden items-center gap-2 lg:flex">
						{dateNav()()}
					</div>
				)}
			</Show>
			<div class="ml-auto flex items-center gap-4">
				<A href="/data-sources">データソース</A>
				<A href="/settings">設定</A>
				<button
					type="button"
					onClick={() => signOut()}
					class="cursor-pointer border-0 bg-transparent p-0 text-sm text-inherit hover:text-accent"
				>
					サインアウト
				</button>
			</div>
		</header>
		<Show when={props.dateNav}>
			{(dateNav) => (
				<div class="flex h-14 shrink-0 items-center justify-center gap-2 border-divider border-b-2 px-4 lg:hidden">
					{dateNav()()}
				</div>
			)}
		</Show>
		<main
			class={
				props.fullBleed ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto p-6'
			}
		>
			{props.children}
		</main>
	</div>
);

export default AppShell;
