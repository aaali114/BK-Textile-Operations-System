---
name: Order intake requirements
description: The requested mailbox-based intake workflow for B.K. Textile buyer orders.
---

Buyer orders should be extracted from email through POP mail rather than IMAP, then shown under their respective orders in the register. The user is unsure whether cPanel filtering will still work.

Use the existing shared mailbox, not a dedicated order-import mailbox.

**Why:** The user explicitly changed the intended mail protocol from IMAP to POP and chose the existing shared mailbox.

**How to apply:** Scope email intake around POP and the existing shared mailbox. Confirm mailbox settings and obtain representative redacted order emails before defining extraction rules. Do not assume IMAP folders, a different mail provider, or approval to create a dedicated mailbox.
