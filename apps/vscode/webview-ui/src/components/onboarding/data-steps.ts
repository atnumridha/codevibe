export enum NEW_USER_TYPE {
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: NEW_USER_TYPE
}

export const STEP_CONFIG = {
	0: {
		title: "How will you use Codie?",
		description: "Select an option below to get started.",
		buttons: [
			{ text: "Continue", action: "next", variant: "default" },
			{ text: "Sign in to Codie", action: "signin", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "Select a starter model",
		buttons: [
			{ text: "Sign in to Codie", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "Select your model",
		buttons: [
			{ text: "Sign in to Codie", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "Configure your model source",
		buttons: [
			{ text: "Continue", action: "done", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	2: {
		title: "Almost there!",
		description: "Complete Codie sign-in in your browser. Then come back here to finish up.",
		buttons: [{ text: "Back", action: "back", variant: "secondary" }],
	},
} as const

export const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "Starter", description: "Get started with Codie", type: NEW_USER_TYPE.FREE },
	{ title: "Recommended", description: "Use Codie's recommended model setup", type: NEW_USER_TYPE.POWER },
	{ title: "Use another model source", description: "Connect Codie to a model source you manage", type: NEW_USER_TYPE.BYOK },
]
