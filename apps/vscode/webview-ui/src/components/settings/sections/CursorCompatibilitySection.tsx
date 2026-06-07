import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { UiServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface CursorCompatibilitySectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ROUTES = [
	"/createchat",
	"/mcp/install",
	"/background-agent",
	"/settings",
	"/prompt",
	"/command",
	"/rule",
	"/pr-review",
	"/plugin/add",
	"/glass",
	"/automation/ingest",
	"/git/checkout",
	"/git/branch",
	"/git/commit",
] as const

const EXAMPLES = [
	{
		label: "Chat",
		uri: "vscode://cline.cline/createchat?prompt=Review%20the%20current%20diff",
	},
	{
		label: "MCP",
		uri: "vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
	},
	{
		label: "Background",
		uri: "vscode://cline.cline/background-agent?prompt=Investigate%20flaky%20tests&repo=owner%2Frepo",
	},
	{
		label: "Plugin",
		uri: "vscode://cline.cline/plugin/add?id=docs-helper&replace=true",
	},
	{
		label: "Git",
		uri: "codevibe://git/checkout?branch=feature%2Fdemo",
	},
] as const

type LaunchStatus =
	| { kind: "success"; message: string }
	| { kind: "error"; message: string }

const CursorCompatibilitySection = ({ renderSectionHeader }: CursorCompatibilitySectionProps) => {
	const [uri, setUri] = useState("")
	const [isLaunching, setIsLaunching] = useState(false)
	const [status, setStatus] = useState<LaunchStatus | null>(null)

	const launchUri = useCallback(async () => {
		const trimmedUri = uri.trim()
		if (!trimmedUri) {
			setStatus({ kind: "error", message: "Enter a Cursor or CodeVibe URI." })
			return
		}

		setIsLaunching(true)
		setStatus(null)

		try {
			const result = await UiServiceClient.handleUri(StringRequest.create({ value: trimmedUri }))
			setStatus(
				result.value
					? { kind: "success", message: "URI accepted." }
					: { kind: "error", message: "URI was rejected or cancelled." },
			)
		} catch (error) {
			setStatus({
				kind: "error",
				message: error instanceof Error ? error.message : "URI handling failed.",
			})
		} finally {
			setIsLaunching(false)
		}
	}, [uri])

	const handleSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			void launchUri()
		},
		[launchUri],
	)

	return (
		<div>
			{renderSectionHeader("cursor-compat")}
			<Section>
				<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
					<div className="flex flex-col gap-1">
						<label className="text-xs font-medium text-foreground/80" htmlFor="cursor-compatible-uri">
							URI
						</label>
						<VSCodeTextArea
							className="w-full"
							id="cursor-compatible-uri"
							onInput={(event) => {
								setUri((event.target as HTMLTextAreaElement).value)
								setStatus(null)
							}}
							placeholder="vscode://cline.cline/createchat?prompt=..."
							resize="vertical"
							rows={4}
							value={uri}
						/>
					</div>

					<div className="flex flex-wrap gap-2">
						{EXAMPLES.map((example) => (
							<VSCodeButton
								appearance="secondary"
								key={example.label}
								onClick={() => {
									setUri(example.uri)
									setStatus(null)
								}}
								type="button">
								{example.label}
							</VSCodeButton>
						))}
					</div>

					<VSCodeButton disabled={isLaunching || !uri.trim()} type="submit">
						{isLaunching ? "Launching..." : "Launch URI"}
					</VSCodeButton>

					{status && (
						<div
							className={
								status.kind === "success"
									? "text-xs text-success"
									: "text-xs text-(--vscode-errorForeground)"
							}
							role="status">
							{status.message}
						</div>
					)}
				</form>
			</Section>
			<Section>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Routes</div>
				<div className="flex flex-wrap gap-1.5">
					{ROUTES.map((route) => (
						<Badge key={route} variant="outline">
							{route}
						</Badge>
					))}
				</div>
			</Section>
		</div>
	)
}

export default CursorCompatibilitySection
