import {IonIcon} from '@ionic-solidjs/core';
import {
	chevronBackOutline,
	chevronForwardOutline,
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
