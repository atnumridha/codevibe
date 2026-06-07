import * as path from "node:path"
import * as vscode from "vscode"
import { getWorkspaceSearchItems, type WorkspaceSearchItem } from "@/services/workspace/file-indexer"
import {
	SearchWorkspaceItemsRequest,
	SearchWorkspaceItemsRequest_SearchItemType,
	SearchWorkspaceItemsResponse,
} from "@/shared/proto/host/workspace"

const DEFAULT_SEARCH_LIMIT = 5000

function resolveWorkspacePath(request: SearchWorkspaceItemsRequest): string | undefined {
	if (request.workspacePath) {
		return request.workspacePath
	}
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function matchesSelectedType(
	item: WorkspaceSearchItem,
	selectedType: SearchWorkspaceItemsRequest_SearchItemType | undefined,
): boolean {
	if (selectedType === SearchWorkspaceItemsRequest_SearchItemType.FILE) {
		return item.type === "file"
	}
	if (selectedType === SearchWorkspaceItemsRequest_SearchItemType.FOLDER) {
		return item.type === "folder"
	}
	return true
}

async function rankItems(query: string, items: WorkspaceSearchItem[], limit: number): Promise<WorkspaceSearchItem[]> {
	if (!query.trim()) {
		return items.slice(0, limit)
	}

	const fzfModule = await import("fzf")
	const fzf = new fzfModule.Fzf(items, {
		selector: (item: WorkspaceSearchItem) => `${item.label || ""} ${item.label || ""} ${item.path}`,
		limit,
	})
	return fzf.find(query).map((result) => result.item)
}

export async function searchWorkspaceItems(request: SearchWorkspaceItemsRequest): Promise<SearchWorkspaceItemsResponse> {
	const workspacePath = resolveWorkspacePath(request)
	if (!workspacePath) {
		return SearchWorkspaceItemsResponse.create({ items: [] })
	}

	const limit = request.limit && request.limit > 0 ? request.limit : DEFAULT_SEARCH_LIMIT
	const selectedType = request.selectedType
	const items = (await getWorkspaceSearchItems(workspacePath, { includeIgnored: request.includeIgnored === true }))
		.filter((item) => matchesSelectedType(item, selectedType))
		.sort((a, b) => a.path.localeCompare(b.path))
	const rankedItems = await rankItems(request.query ?? "", items, limit)

	return SearchWorkspaceItemsResponse.create({
		items: rankedItems.map((item) => ({
			path: item.path.split(path.sep).join("/"),
			type:
				item.type === "folder"
					? SearchWorkspaceItemsRequest_SearchItemType.FOLDER
					: SearchWorkspaceItemsRequest_SearchItemType.FILE,
			label: item.label || path.basename(item.path),
		})),
	})
}
