## Superpowers workflow

Use Superpowers for all non-trivial development work.
- Brainstorm before creating or modifying features.
- Write a plan for multi-file changes, migrations, and refactors.
- Use an isolated git worktree before implementation.
- Use TDD for feature work and bug fixes.
- Use systematic-debugging for bugs that aren't obvious at first glance.
- Request a code review before finishing a branch.

### When to skip Superpowers
Work directly, without brainstorming, planning, or worktrees, when the task is:
- A one-line or few-line fix (typos, config values, small query tweaks)
- Renaming, formatting, or other mechanical edits
- A throwaway script or a quick prototype I'll delete
- Exploratory work where I'm just trying something out
- Answering a question about the code with no changes needed

If you're unsure whether a task is small enough to skip, ask me.
Even when skipping, still run existing tests after changes.