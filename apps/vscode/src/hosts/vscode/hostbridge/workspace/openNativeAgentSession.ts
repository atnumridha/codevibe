import { OpenNativeAgentSessionResponse } from "@shared/proto/host/workspace"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"

export async function openNativeAgentSession(): Promise<OpenNativeAgentSessionResponse> {
	await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.NewNativeAgentSession)
	return OpenNativeAgentSessionResponse.create({})
}
