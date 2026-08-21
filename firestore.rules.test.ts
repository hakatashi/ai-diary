import fs from 'node:fs';
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestContext,
	type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {afterAll, beforeAll, describe, test} from 'vitest';

const OWNER_EMAIL = 'hakatasiloving@gmail.com';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
	testEnv = await initializeTestEnvironment({
		projectId: 'hakatadiary',
		firestore: {
			rules: fs.readFileSync('firestore.rules', 'utf8'),
			host: 'localhost',
			port: 40615,
		},
	});
});

afterAll(async () => {
	await testEnv.cleanup();
});

function ownerContext() {
	return testEnv.authenticatedContext('owner', {
		email: OWNER_EMAIL,
		email_verified: true,
	});
}

function unverifiedOwnerContext() {
	return testEnv.authenticatedContext('owner-unverified', {
		email: OWNER_EMAIL,
		email_verified: false,
	});
}

function otherUserContext() {
	return testEnv.authenticatedContext('other', {
		email: 'someone-else@example.com',
		email_verified: true,
	});
}

function unauthenticatedContext() {
	return testEnv.unauthenticatedContext();
}

async function seed(
	setup: (db: ReturnType<RulesTestContext['firestore']>) => Promise<void>,
) {
	await testEnv.withSecurityRulesDisabled(async (context) => {
		await setup(context.firestore());
	});
}

describe('dataSources/{dataSourceId}', () => {
	test('owner can read', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health'});
		});
		await assertSucceeds(
			ownerContext().firestore().doc('dataSources/google_health').get(),
		);
	});

	test('non-owner cannot read', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health'});
		});
		await assertFails(
			otherUserContext().firestore().doc('dataSources/google_health').get(),
		);
	});

	test('unauthenticated user cannot read', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health'});
		});
		await assertFails(
			unauthenticatedContext()
				.firestore()
				.doc('dataSources/google_health')
				.get(),
		);
	});

	test('unverified owner cannot read', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health'});
		});
		await assertFails(
			unverifiedOwnerContext()
				.firestore()
				.doc('dataSources/google_health')
				.get(),
		);
	});

	test('owner can update only enabled/updatedAt', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health', enabled: true});
		});
		await assertSucceeds(
			ownerContext()
				.firestore()
				.doc('dataSources/google_health')
				.update({enabled: false, updatedAt: 'now'}),
		);
	});

	test('owner cannot update fields outside enabled/updatedAt', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health', enabled: true});
		});
		await assertFails(
			ownerContext()
				.firestore()
				.doc('dataSources/google_health')
				.update({displayName: 'Tampered'}),
		);
	});

	test('non-owner cannot update', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health', enabled: true});
		});
		await assertFails(
			otherUserContext()
				.firestore()
				.doc('dataSources/google_health')
				.update({enabled: false}),
		);
	});

	test('owner cannot create', async () => {
		await assertFails(
			ownerContext()
				.firestore()
				.doc('dataSources/new_source')
				.set({displayName: 'New Source'}),
		);
	});

	test('owner cannot delete', async () => {
		await seed(async (db) => {
			await db
				.doc('dataSources/google_health')
				.set({displayName: 'Google Health'});
		});
		await assertFails(
			ownerContext().firestore().doc('dataSources/google_health').delete(),
		);
	});
});

describe.each([
	['dataSourceSecrets', 'google_health'],
	['oauthStates', 'some-state'],
	['placesCache', 'some-place'],
	['placesApiUsage', '2026-08'],
])('%s/{id} (fully locked down)', (collection, docId) => {
	const path = `${collection}/${docId}`;

	test('owner cannot read', async () => {
		await seed(async (db) => {
			await db.doc(path).set({value: 'secret'});
		});
		await assertFails(ownerContext().firestore().doc(path).get());
	});

	test('owner cannot write', async () => {
		await assertFails(
			ownerContext().firestore().doc(path).set({value: 'secret'}),
		);
	});

	test('non-owner cannot read or write', async () => {
		await seed(async (db) => {
			await db.doc(path).set({value: 'secret'});
		});
		await assertFails(otherUserContext().firestore().doc(path).get());
		await assertFails(
			otherUserContext().firestore().doc(path).set({value: 'tampered'}),
		);
	});

	test('unauthenticated user cannot read or write', async () => {
		await seed(async (db) => {
			await db.doc(path).set({value: 'secret'});
		});
		await assertFails(unauthenticatedContext().firestore().doc(path).get());
		await assertFails(
			unauthenticatedContext().firestore().doc(path).set({value: 'tampered'}),
		);
	});
});

describe('logEntries/{logEntryId}', () => {
	test('owner can read', async () => {
		await seed(async (db) => {
			await db.doc('logEntries/entry-1').set({date: '2026-08-22'});
		});
		await assertSucceeds(
			ownerContext().firestore().doc('logEntries/entry-1').get(),
		);
	});

	test('non-owner cannot read', async () => {
		await seed(async (db) => {
			await db.doc('logEntries/entry-1').set({date: '2026-08-22'});
		});
		await assertFails(
			otherUserContext().firestore().doc('logEntries/entry-1').get(),
		);
	});

	test('unauthenticated user cannot read', async () => {
		await seed(async (db) => {
			await db.doc('logEntries/entry-1').set({date: '2026-08-22'});
		});
		await assertFails(
			unauthenticatedContext().firestore().doc('logEntries/entry-1').get(),
		);
	});

	test('owner cannot write', async () => {
		await assertFails(
			ownerContext()
				.firestore()
				.doc('logEntries/entry-1')
				.set({date: '2026-08-22'}),
		);
	});
});

describe('journalEntries/{date}', () => {
	test('owner can read', async () => {
		await seed(async (db) => {
			await db
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-22', memo: 'hi'});
		});
		await assertSucceeds(
			ownerContext().firestore().doc('journalEntries/2026-08-22').get(),
		);
	});

	test('non-owner cannot read', async () => {
		await seed(async (db) => {
			await db
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-22', memo: 'hi'});
		});
		await assertFails(
			otherUserContext().firestore().doc('journalEntries/2026-08-22').get(),
		);
	});

	test('owner can create when data.date matches the document id', async () => {
		await assertSucceeds(
			ownerContext()
				.firestore()
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-22', memo: 'hi'}),
		);
	});

	test('owner cannot create when data.date does not match the document id', async () => {
		await assertFails(
			ownerContext()
				.firestore()
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-23', memo: 'hi'}),
		);
	});

	test('owner can update when data.date matches the document id', async () => {
		await seed(async (db) => {
			await db
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-22', memo: 'hi'});
		});
		await assertSucceeds(
			ownerContext()
				.firestore()
				.doc('journalEntries/2026-08-22')
				.update({memo: 'updated'}),
		);
	});

	test('non-owner cannot create or update', async () => {
		await assertFails(
			otherUserContext()
				.firestore()
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-22', memo: 'hi'}),
		);
	});

	test('owner cannot delete', async () => {
		await seed(async (db) => {
			await db
				.doc('journalEntries/2026-08-22')
				.set({date: '2026-08-22', memo: 'hi'});
		});
		await assertFails(
			ownerContext().firestore().doc('journalEntries/2026-08-22').delete(),
		);
	});
});
