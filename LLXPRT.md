# LLXPRT.md

## Project Overview

This project is a sophisticated framework for managing the development of a "Pharma Date Manager" application. It utilizes an AI agent to automate and streamline the software development lifecycle, from specification to implementation. The framework is defined by a set of configuration files, shell scripts, and documentation templates.

The core of this project resides in the `.gemini` and `.specify` directories, which contain the logic and configuration for the AI agent's workflows.

**Key Technologies:**

*   **Shell Scripts:** The primary mechanism for automating tasks, located in `.specify/scripts/bash/`.
*   **TOML:** Used for configuring the AI agent's commands, found in `.gemini/commands/`.
*   **Markdown:** Used for storing specifications, plans, and the project's constitution.

## Building and Running

This project doesn't have a traditional build process. Instead, it's a collection of scripts and configurations that are executed by an AI agent. The main entry points for the development workflow are the shell scripts in `.specify/scripts/bash/`:

*   `check-implementation-prerequisites.sh`: Verifies that all necessary files and configurations are in place before implementation.
*   `check-task-prerequisites.sh`: Checks for the required design artifacts before generating tasks.
*   `common.sh`: Contains common utility functions used by other scripts.
*   `create-new-feature.sh`: Sets up the necessary files and directory structure for a new feature.
*   `get-feature-paths.sh`: Retrieves the relevant paths for a given feature.
*   `setup-plan.sh`: Initializes the planning phase for a new feature.
*   `update-agent-context.sh`: Updates the AI agent's context with the latest project information.

## Development Conventions

The development process is highly structured and driven by the AI agent. The workflow is defined by the commands in the `.gemini/commands/` directory and guided by the principles in `.specify/memory/constitution.md`. These commands are part of the Github spec-kit.

The typical development cycle is as follows:

1.  **`/specify`**: A new feature is initiated by providing a natural language description. This triggers the `create-new-feature.sh` script, which sets up the feature branch and specification file.
2.  **`/plan`**: The AI agent, guided by `plan.toml`, generates a detailed implementation plan based on the feature specification. This includes creating design artifacts like `data-model.md`, `contracts/`, and `research.md`.
3.  **`/tasks`**: Based on the design artifacts, the agent generates a list of actionable tasks in `tasks.md`.
4.  **`/implement`**: The agent executes the tasks in `tasks.md` to implement the feature.

The entire process is governed by the **Pharma Date Manager Constitution**, which enforces principles like mobile-first design, data integrity, and automated testing.
