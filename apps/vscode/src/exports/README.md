# CodeVibe API

The CodeVibe extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/exports/codevibe.d.ts` to your extension's source directory.
2. Include `codevibe.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    import type { CodeVibeAPI } from "./codevibe"

    const codeVibeExtension = vscode.extensions.getExtension<CodeVibeAPI>("atnumridha.codevibe")

    if (!codeVibeExtension?.isActive) {
        throw new Error("CodeVibe extension is not activated")
    }

    const codevibe = codeVibeExtension.exports

    if (codevibe) {
        // Now you can use the API

        // Start a new task with an initial message
        await codevibe.startNewTask("Hello, CodeVibe! Let's make a new project...")

        // Start a new task with an initial message and images
        await codevibe.startNewTask("Use this design language", ["data:image/webp;base64,..."])

        // Send a message to the current task
        await codevibe.sendMessage("Can you fix the @problems?")

        // Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
        await codevibe.pressPrimaryButton()

        // Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
        await codevibe.pressSecondaryButton()
    } else {
        console.error("CodeVibe API is not available")
    }
    ```

    **Note:** To ensure that the `atnumridha.codevibe` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "atnumridha.codevibe"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `codevibe.d.ts` file.
The legacy `cline.d.ts` alias remains for integrations that need upstream compatibility.
