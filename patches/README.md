# Patches for sibling repositories

This directory holds changes this project needs in OTHER codebases, kept here
so the full body of work lives in one repo.

- nanda-index-v2-personal-email-activation.patch: for projnanda/nanda-index-v2.
  Personal registrations must have an agent URN whose email matches
  contact_email, and they activate on email verification (domain paths still
  require DNS verification). Apply with: git am <patch> in a nanda-index-v2
  checkout. Includes 7 integration tests.
