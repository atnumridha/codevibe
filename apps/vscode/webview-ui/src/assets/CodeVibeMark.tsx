import { SVGProps } from "react";
import type { Environment } from "../../../src/shared/config-types";
import { getEnvironmentColor } from "../utils/environmentColors";

const CodeVibeMark = (
	props: SVGProps<SVGSVGElement> & { environment?: Environment },
) => {
	const { environment, ...svgProps } = props;
	const accentColor =
		environment === "local" || environment === "staging"
			? getEnvironmentColor(environment)
			: "var(--color-codevibe, #24c8b2)";
	const warmColor = "var(--color-codevibe-warm, #d6a84f)";
	const lineColor = "var(--vscode-foreground)";
	const secondaryColor = "var(--vscode-descriptionForeground)";

	return (
		<svg
			fill="none"
			height="64"
			role="img"
			viewBox="0 0 64 64"
			width="64"
			xmlns="http://www.w3.org/2000/svg"
			{...svgProps}
		>
			<title>Codie</title>
			<rect
				height="46"
				rx="12"
				stroke={secondaryColor}
				strokeOpacity="0.34"
				strokeWidth="3"
				width="46"
				x="9"
				y="9"
			/>
			<path
				d="M38.5 19.5C34.5 16.2 27.2 15.9 22.5 20.1 16.6 25.4 16.6 38.6 22.5 43.9 27.2 48.1 34.7 47.7 38.9 44"
				stroke={lineColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="5.8"
			/>
			<path
				d="M26 25.5 32.6 40.6 45.5 23.4"
				stroke={accentColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="5.8"
			/>
			<path
				d="M45.5 23.4h6"
				stroke={warmColor}
				strokeLinecap="round"
				strokeWidth="5.8"
			/>
			<circle cx="45.5" cy="23.4" fill={warmColor} r="3" />
			<circle cx="32.6" cy="40.6" fill={accentColor} r="3" />
		</svg>
	);
};

export default CodeVibeMark;
