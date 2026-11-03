PAPER WORK — UPDATED STORE-FIRST PROJECT

WHAT CHANGED
1. Admin sees clickable store-name cards. Selecting a store opens monthly workbook tiles and the store upload archive.
2. Store creation asks only for the store name. Internal generated IDs remain hidden; city and manager columns are removed from the store interface.
3. Store Manager sees only the assigned store workflow: upload one Daily Shift Report image per day, optionally upload Other Files, and view their uploaded files with dates.
4. Old category selector and approval/rejection workflow are removed from the new upload UI.
5. Uploads are renamed StoreName_YYYY-MM-DD.ext. Other Files get a unique suffix to avoid collisions.
6. Daily Shift Report duplicates for the same store/date are rejected.
7. Admin monthly workbook now opens with one editable row for every calendar day, even when no files have been uploaded. Uploaded file names are associated with their report dates; manual entries are saved in MongoDB.
8. Google Drive OAuth integration saves/updates each monthly workbook in the connected admin's Drive.
9. Supplied Paper Work logo remains in the web app and Android app launcher assets.

IMPORTANT SETUP
- Open backend/.env.example and copy the variables into your private .env. Keep DATABASE_URL, JWT_SECRET and ADMIN_PASSWORD from your existing working setup.
- Run npm install, npm run prisma:generate, npm run prisma:push, then npm run start. The existing MongoDB schema is reused; no destructive reset is needed.
- Existing stores are retained. New stores require only a name; old store code/city fields remain in the database for backward compatibility but are not shown.
- To enable Google Drive: in Google Cloud Console create an OAuth client (Web application), enable Google Drive API, add the exact redirect URI https://YOUR_BACKEND_DOMAIN/api/drive/callback, and set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI. Optionally set GOOGLE_DRIVE_FOLDER_ID to a folder in your My Drive. Sign in as Super Admin and press Connect Google Drive. Grant Drive file access.
- If Google Drive is not connected/configured, monthly workbook creation reports the setup error instead of pretending it saved.
- Store manager accounts still need to be created by the Super Admin using the existing user API/admin setup. Assign each manager to their store. The manager interface does not expose other stores, managers or Excel.

SECURITY / STORAGE NOTE
Uploaded image binaries currently use the configured UPLOAD_DIR on the backend. For production hosting, mount persistent disk or migrate UPLOAD_DIR to private object storage; do not use ephemeral server filesystem for long-term retention. Google Drive stores the monthly Excel workbooks, not the original report images.

MOBILE FIXES IN THIS UPDATE
- The mobile menu toggle is connected to the actual sidebar element (the previous markup was missing its id).
- Bottom navigation is available on small screens for Home, Stores (Super Admin), and Uploads.
- File preview opens a browser tab before fetching the protected file, avoiding mobile popup-blocking after an asynchronous request.
- Monthly workbook editor shows all dates in the selected month and saves manual rows even when no upload exists for that date.
