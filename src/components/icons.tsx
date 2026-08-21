import {IonIcon} from '@ionic-solidjs/core';
import {
	calendarOutline,
	chevronBackOutline,
	chevronForwardOutline,
	flagOutline,
	imageOutline,
	locationOutline,
	mapOutline,
	pencilOutline,
	pulseOutline,
} from 'ionicons/icons';
import type {JSX} from 'solid-js';

interface IconProps {
	size?: number;
	class?: string;
}

const iconSize = (size: number) => ({
	width: `${size}px`,
	height: `${size}px`,
});

export const ChevronLeftIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={chevronBackOutline}
		style={iconSize(props.size ?? 18)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const ChevronRightIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={chevronForwardOutline}
		style={iconSize(props.size ?? 18)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const PencilIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={pencilOutline}
		style={iconSize(props.size ?? 14)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const ActivityIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={pulseOutline}
		style={iconSize(props.size ?? 14)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const MapIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={mapOutline}
		style={iconSize(props.size ?? 22)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const LocationIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={locationOutline}
		style={iconSize(props.size ?? 14)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const CheckinIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={flagOutline}
		style={iconSize(props.size ?? 14)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const CalendarIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={calendarOutline}
		style={iconSize(props.size ?? 14)}
		class={props.class}
		aria-hidden="true"
	/>
);

export const PhotoIcon = (props: IconProps): JSX.Element => (
	<IonIcon
		icon={imageOutline}
		style={iconSize(props.size ?? 14)}
		class={props.class}
		aria-hidden="true"
	/>
);
