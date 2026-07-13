import type {JSX} from 'solid-js';

interface IconProps {
	size?: number;
	class?: string;
}

const svgProps = (size: number) => ({
	width: size,
	height: size,
	viewBox: '0 0 24 24',
	fill: 'none',
	stroke: 'currentColor',
	'stroke-width': 2,
	'stroke-linecap': 'round' as const,
	'stroke-linejoin': 'round' as const,
});

export const ChevronLeftIcon = (props: IconProps): JSX.Element => (
	<svg {...svgProps(props.size ?? 18)} class={props.class} aria-hidden="true">
		<polyline points="15 18 9 12 15 6" />
	</svg>
);

export const ChevronRightIcon = (props: IconProps): JSX.Element => (
	<svg {...svgProps(props.size ?? 18)} class={props.class} aria-hidden="true">
		<polyline points="9 18 15 12 9 6" />
	</svg>
);

export const PencilIcon = (props: IconProps): JSX.Element => (
	<svg {...svgProps(props.size ?? 14)} class={props.class} aria-hidden="true">
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
	</svg>
);

export const ActivityIcon = (props: IconProps): JSX.Element => (
	<svg {...svgProps(props.size ?? 14)} class={props.class} aria-hidden="true">
		<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
	</svg>
);

export const MapIcon = (props: IconProps): JSX.Element => (
	<svg {...svgProps(props.size ?? 22)} class={props.class} aria-hidden="true">
		<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
		<path d="M15 5.764v15" />
		<path d="M9 3.236v15" />
	</svg>
);
