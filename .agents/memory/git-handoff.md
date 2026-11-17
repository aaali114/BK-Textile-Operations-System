---
name: Required Git handoff
description: The user's required commit, push, and concurrent-main conflict procedure.
---

After finishing any task, always commit and run `git push origin HEAD:main`. If the push is rejected because main has new commits, run `git pull --no-rebase origin main` first, keep the backend (non-`artifacts/bk-textile`) versions of any conflicting files, then push. Never leave work only in Replit.

**Why:** The user asked.

**How to apply:** Use this handoff procedure when completing work in this project. Do not overwrite unrelated local changes or force push.
