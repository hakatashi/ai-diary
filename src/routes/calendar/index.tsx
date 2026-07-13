import {Navigate} from '@solidjs/router';
import {getCurrentMonthString} from '~/lib/date';

const CalendarIndex = () => (
	<Navigate href={`/calendar/${getCurrentMonthString()}`} />
);

export default CalendarIndex;
