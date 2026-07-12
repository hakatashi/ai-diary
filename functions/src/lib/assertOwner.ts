import {HttpsError, type CallableRequest} from 'firebase-functions/https';

const ALLOWED_EMAIL = 'hakatasiloving@gmail.com';

export const assertOwner = (request: CallableRequest): void => {
	const email = request.auth?.token.email;
	const emailVerified = request.auth?.token.email_verified;

	if (email !== ALLOWED_EMAIL || !emailVerified) {
		throw new HttpsError('permission-denied', 'Not authorized.');
	}
};
