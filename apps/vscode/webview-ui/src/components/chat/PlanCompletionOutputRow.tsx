import { LoaderCircleIcon, NotepadTextIcon, PlayIcon } from "lucide-react"
import { memo, useState } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
	headClassNames?: string
	onBuildLocally?: () => Promise<void>
}

/**
 * Styled completion output for Plan Mode responses
 * Uses grayscale colors to distinguish from Act Mode's green success theme
 */
const PlanCompletionOutputRow = memo(({ text, headClassNames, onBuildLocally }: PlanCompletionOutputProps) => {
	const [isStartingBuild, setIsStartingBuild] = useState(false)

	const handleBuildLocally = async () => {
		if (!onBuildLocally || isStartingBuild) {
			return
		}
		setIsStartingBuild(true)
		try {
			await onBuildLocally()
		} catch (error) {
			console.error("Failed to build plan locally:", error)
		} finally {
			setIsStartingBuild(false)
		}
	}

	return (
		<div className="rounded-sm border border-description/50 overflow-visible bg-code p-2 pt-3">
			{/* Header */}
			<div className={cn(headClassNames, "justify-between px-1")}>
				<div className="flex gap-2 items-center">
					<NotepadTextIcon className="size-2" />
					<span className="text-foreground font-bold">Plan Created</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
				<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
					<div className="wrap-anywhere [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} />
					</div>
				</div>
			</div>

			{onBuildLocally && (
				<div className="flex justify-end border-t-1 border-description/20 pt-2 px-1">
					<Button
						aria-label="Build Locally"
						disabled={isStartingBuild}
						onClick={handleBuildLocally}
						size="sm"
						title="Run this accepted plan locally in Act mode">
						{isStartingBuild ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
						Build Locally
					</Button>
				</div>
			)}
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
