"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { EMPTY_DIFF_SUMMARY, type SessionFileDiff } from "@/lib/session-diff";
import { normalizeWorkspaceDiffResponse } from "@/lib/workspace-state";

type WorkspaceState = {
	fileDiffs: SessionFileDiff[];
	summary: typeof EMPTY_DIFF_SUMMARY;
	available: boolean;
	error: string | null;
	refresh: () => Promise<void>;
};

export function useWorkspaceState(options: {
	workspaceRoot: string;
	connected: boolean;
	active: boolean;
}): WorkspaceState {
	const [fileDiffs, setFileDiffs] = useState<SessionFileDiff[]>([]);
	const [summary, setSummary] = useState(EMPTY_DIFF_SUMMARY);
	const [available, setAvailable] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const workspaceRoot = options.workspaceRoot.trim();
		if (!options.connected || !workspaceRoot) {
			setFileDiffs([]);
			setSummary(EMPTY_DIFF_SUMMARY);
			setAvailable(false);
			return;
		}
		try {
			const response = await desktopClient.readWorkspaceDiff({
				workspaceRoot,
				maxBytes: 512 * 1024,
			});
			const normalized = normalizeWorkspaceDiffResponse(response);
			setFileDiffs(normalized.fileDiffs);
			setSummary(normalized.summary);
			setAvailable(true);
			setError(null);
		} catch (caught) {
			setFileDiffs([]);
			setSummary(EMPTY_DIFF_SUMMARY);
			setAvailable(false);
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [options.connected, options.workspaceRoot]);

	useEffect(() => {
		void refresh();
		if (!options.connected || !options.workspaceRoot.trim()) {
			return;
		}
		const intervalMs = options.active ? 2500 : 6000;
		const interval = window.setInterval(() => void refresh(), intervalMs);
		return () => window.clearInterval(interval);
	}, [options.active, options.connected, options.workspaceRoot, refresh]);

	return {
		fileDiffs,
		summary,
		available,
		error,
		refresh,
	};
}
