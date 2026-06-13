import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useMemo, useState } from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useCodeVibeAuth } from "@/context/CodeVibeAuthContext"
import { AccountServiceClient, TaskServiceClient } from "@/services/grpc-client"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent?: number
	totalPromotions?: number
	message: string
	buyCreditsUrl?: string
}

const DEFAULT_BUY_CREDITS_URL = {
	USER: "https://github.com/atnumridha/codevibe#readme",
	ORG: "https://github.com/atnumridha/codevibe#readme",
}

const ACCOUNT_LIMIT_MESSAGE = "You've reached your usage limit."
const BILLING_COPY_PATTERN = /\b(buy|credit|credits|payment|purchase|billing|spent|spend)\b/i

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({
	message = ACCOUNT_LIMIT_MESSAGE,
	buyCreditsUrl,
	currentBalance,
	totalPromotions,
	totalSpent,
}) => {
	const { activeOrganization } = useCodeVibeAuth()
	const [fullBuyCreditsUrl, setFullBuyCreditsUrl] = useState<string>("")

	const dashboardUrl = useMemo(() => {
		return buyCreditsUrl ?? (activeOrganization?.organizationId ? DEFAULT_BUY_CREDITS_URL.ORG : DEFAULT_BUY_CREDITS_URL.USER)
	}, [buyCreditsUrl, activeOrganization?.organizationId])

	useEffect(() => {
		const fetchCallbackUrl = async () => {
			try {
				const callbackUrl = (await AccountServiceClient.getRedirectUrl({})).value
				const url = new URL(dashboardUrl)
				url.searchParams.set("callback_url", callbackUrl)
				setFullBuyCreditsUrl(url.toString())
			} catch (error) {
				console.error("Error fetching callback URL:", error)
				// Fallback to URL without callback if the API call fails
				setFullBuyCreditsUrl(dashboardUrl)
			}
		}
		fetchCallbackUrl()
	}, [dashboardUrl])

	const displayMessage = BILLING_COPY_PATTERN.test(message) ? ACCOUNT_LIMIT_MESSAGE : message

	// We have to divide because the balance is stored in microcredits
	return (
		<div className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)">
			<div className="mb-3 font-azeret-mono">
				<div className="text-error mb-2">{displayMessage}</div>
				<div className="mb-3">
					{currentBalance ? (
						<div className="text-foreground">
							Available capacity: <span className="font-bold">{currentBalance.toFixed(2)}</span>
						</div>
					) : null}
					{totalSpent ? <div className="text-foreground">Consumed: {totalSpent.toFixed(2)}</div> : null}
					{totalPromotions ? (
						<div className="text-foreground">Included capacity: {totalPromotions.toFixed(2)}</div>
					) : null}
				</div>
			</div>

			<VSCodeButtonLink className="w-full mb-2" href={fullBuyCreditsUrl}>
				<span className="codicon codicon-dashboard mr-[6px] text-[14px]" />
				Manage Access
			</VSCodeButtonLink>

			<VSCodeButton
				appearance="secondary"
				className="w-full"
				onClick={async () => {
					try {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					} catch (error) {
						console.error("Error invoking action:", error)
					}
				}}>
				<span className="codicon codicon-refresh mr-1.5" />
				Retry Request
			</VSCodeButton>
		</div>
	)
}

export default CreditLimitError
