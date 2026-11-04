# Paper Work v2.0 readiness

The project implements the store-first workflow and Google Drive monthly workbook integration. Before production, configure HTTPS, MongoDB Atlas, a persistent private upload volume/object store, JWT_SECRET, and Google OAuth credentials. Verify backup/restore, file access controls, and Google Drive permissions with a test admin and test store manager.

Daily report uniqueness is enforced by checking the store/date before insert. For high concurrency, add a database-level unique compound index or transaction-safe idempotency mechanism.


## Changes in mobile/workbook update
- Added the missing sidebar element ID used by the mobile hamburger control.
- Monthly workbook API now returns calendar-day rows for every date in the selected month, including months with zero uploads.
- Manual slip entries without an uploaded file are persisted using report date plus empty file name as their lookup key.
- Mobile preview opens a tab synchronously before requesting the protected file.
- Persistent private file storage is still required before production use; this update does not migrate uploaded binaries off local disk.
