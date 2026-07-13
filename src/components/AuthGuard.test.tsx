import {MemoryRouter, Route} from '@solidjs/router';
import {render, waitFor} from '@solidjs/testing-library';
import {expect, test} from 'vitest';
import AuthGuard from './AuthGuard.js';

test('redirects unauthenticated visitors to /login', async () => {
	const {getByText} = render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => <AuthGuard>protected content</AuthGuard>}
			/>
			<Route path="/login" component={() => <div>login page</div>} />
		</MemoryRouter>
	));

	await waitFor(() => {
		expect(getByText('login page')).toBeInTheDocument();
	});
});
