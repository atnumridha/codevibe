import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

const CodeVibeMark = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const accentColor =
		environment === "local" || environment === "staging" ? getEnvironmentColor(environment) : "var(--color-codevibe, #5ef5d7)"
	const lineColor = "var(--vscode-icon-foreground)"
	const secondaryColor = "var(--vscode-descriptionForeground)"

	return (
		<svg fill="none" height="64" viewBox="0 0 64 64" width="64" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<title>CodeVibe</title>
			<path
				d="M39 15.5C33.5 10.5 23.5 10.5 17 16.5 8.5 24.5 8.5 39.5 17 47.5c6.5 6 17.5 6 23.5.5"
				stroke={secondaryColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="6.75"
			/>
			<path
				d="M25.5 22.5 33.5 43 50 19"
				stroke={accentColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="6.75"
			/>
			<circle cx="50" cy="19" fill={lineColor} r="3.25" />
			<circle cx="33.5" cy="43" fill={accentColor} r="3.25" />
		</svg>
	)
}

export default CodeVibeMark
