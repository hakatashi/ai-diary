import {Navigate} from '@solidjs/router';
import {getCurrentMonthString} from '~/lib/date';

const FinanceIndex = () => (
	<Navigate href={`/finance/${getCurrentMonthString()}`} />
);

export default FinanceIndex;
