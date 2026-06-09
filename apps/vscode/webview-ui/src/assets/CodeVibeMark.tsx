import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

const CodeVibeMark = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const accentColor =
		environment === "local" || environment === "staging" ? getEnvironmentColor(environment) : "var(--color-codevibe, #2f8cff)"
	const lineColor = "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="64" viewBox="0 0 64 64" width="64" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<title>CodeVibe</title>
			<path
				d="M32 5.5 55 18.75v26.5L32 58.5 9 45.25v-26.5L32 5.5Z"
				stroke={lineColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="4"
			/>
			<path
				d="M19 23.5 32 43.5 45 23.5"
				stroke={accentColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="6"
			/>
			<path d="M22 18.5h20" stroke={lineColor} strokeLinecap="round" strokeWidth="4" />
			<circle cx="19" cy="23.5" fill={lineColor} r="4" />
			<circle cx="45" cy="23.5" fill={lineColor} r="4" />
			<circle cx="32" cy="43.5" fill={accentColor} r="4.5" />
		</svg>
	)
}

export default CodeVibeMark
