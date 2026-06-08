import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useMemo, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { UiServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import {
	buildCursorUriPreview,
	CURSOR_COMPATIBILITY_SURFACES,
	CURSOR_COMPATIBLE_ROUTE_LABELS,
} from "./cursorCompatibilityPreview"

interface CursorCompatibilitySectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const EXAMPLES = [
	{
		label: "Chat",
		uri: "codevibe://createchat?prompt=Review%20the%20current%20diff",
	},
	{
		label: "MCP",
		uri: "codevibe://mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
	},
	{
		label: "Background",
		uri: "codevibe://background-agent?prompt=Investigate%20flaky%20tests&repo=owner%2Frepo",
	},
	{
		label: "Plugin",
		uri: "codevibe://plugin/add?id=docs-helper&replace=true",
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
	const preview = useMemo(() => buildCursorUriPreview(uri), [uri])

	const launchUri = useCallback(async () => {
		const trimmedUri = uri.trim()
		if (!trimmedUri) {
			setStatus({ kind: "error", message: "Enter a CodeVibe or compatible URI." })
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
						<textarea
							className="min-h-24 w-full resize-y rounded border border-input-border bg-input-background p-2 text-sm text-foreground outline-none focus:border-button-background"
							id="cursor-compatible-uri"
							onChange={(event) => {
								setUri((event.target as HTMLTextAreaElement).value)
								setStatus(null)
							}}
							placeholder="codevibe://createchat?prompt=..."
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

					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Preview</div>
							{preview.redacted && <Badge variant="outline">redacted</Badge>}
							{preview.route && <Badge variant="info">{preview.route}</Badge>}
						</div>
						<pre
							aria-label="Redacted URI preview"
							className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-input-foreground/20 bg-input-background/40 p-2 text-xs">
							{preview.text}
						</pre>
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
					{CURSOR_COMPATIBLE_ROUTE_LABELS.map((route) => (
						<Badge key={route.path} variant={preview.route === route.path ? "info" : "outline"}>
							{route.label}: {route.path}
						</Badge>
					))}
				</div>
			</Section>
			<Section>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Surfaces</div>
				<div className="flex flex-wrap gap-1.5">
					{CURSOR_COMPATIBILITY_SURFACES.map((surface) => (
						<Badge key={surface} variant="outline">
							{surface}
						</Badge>
					))}
				</div>
			</Section>
		</div>
	)
}

export default CursorCompatibilitySection
