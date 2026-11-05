---
name: Order intake requirements
description: The requested mailbox-based intake workflow for B.K. Textile buyer orders.
---

Buyer orders should be extracted from email through POP mail rather than IMAP, then shown under their respective orders in the register. The user is unsure whether cPanel filtering will still work.

**Why:** The user explicitly changed the intended mail protocol from IMAP to POP.

**How to apply:** Scope email intake around POP. Confirm mailbox settings and obtain representative redacted order emails before defining extraction rules. Do not assume IMAP folders or a different mail provider. No dedicated-mailbox or forwarding arrangement has been approved yet.
