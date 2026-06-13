import { NewTaskRequest } from "@shared/proto/cline/task";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskServiceClient } from "@/services/grpc-client";
import { SuggestedTasks } from "./SuggestedTasks";
import { quickWinTasks } from "./quickWinTasks";

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		newTask: vi.fn(),
	},
}));

describe("SuggestedTasks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the Codie command deck outside starter workflow mode", () => {
		render(<SuggestedTasks shouldShowStarterWorkflows={false} />);

		expect(screen.getByText("Quick commands")).toBeInTheDocument();
		expect(screen.getByText("Open focus lanes")).toBeInTheDocument();
		expect(screen.getByText("Check terminal safety")).toBeInTheDocument();
		expect(screen.getByText("Load skills")).toBeInTheDocument();
		expect(screen.getByText("Check Codie sign-in")).toBeInTheDocument();
		expect(screen.queryByText("Suggested commands")).not.toBeInTheDocument();
	});

	it("starts a task from a command deck action", async () => {
		vi.mocked(TaskServiceClient.newTask).mockResolvedValue({});
		const user = userEvent.setup();
		render(<SuggestedTasks shouldShowStarterWorkflows={false} />);

		await user.click(
			screen.getByRole("button", { name: /Review diff/ }),
		);

		expect(TaskServiceClient.newTask).toHaveBeenCalledTimes(1);
		expect(TaskServiceClient.newTask).toHaveBeenCalledWith(
			NewTaskRequest.create({ text: quickWinTasks[0].prompt, images: [] }),
		);
	});
});
