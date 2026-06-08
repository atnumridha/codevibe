import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">CodeVibe v{version}</h2>
					<p>
						An AI assistant that can use your CLI and editor. CodeVibe can handle complex software development tasks
						step-by-step with tools that let it create and edit files, explore large projects, use the browser, and
						execute terminal commands (after you grant permission).
					</p>

					<h3 className="text-md font-semibold">Community & Support</h3>
					<p>
						<VSCodeLink href="https://github.com/atnumridha/codevibe">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/atnumridha/codevibe/issues">Issues</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/atnumridha/codevibe">Source</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/atnumridha/codevibe/releases">Releases</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://docs.cline.bot/">Documentation</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://cline.bot/">https://cline.bot</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
