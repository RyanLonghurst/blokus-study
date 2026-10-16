# Setting up the leaderboard (about 10 minutes)

The leaderboard is a Google Sheet with a small script attached. The study page sends each finished
puzzle's score to it and gets back the participant's rank. Nothing personal is stored: only the
random participant code, the random leaderboard name (such as "Swift Otter"), the puzzle and the score.

1. Go to sheets.google.com and create a blank spreadsheet. Name it "Blokus leaderboard".
2. In the sheet, click **Extensions > Apps Script**. A code editor opens in a new tab.
3. Delete everything in the editor, then paste in the whole of `Code.gs` from this folder.
   Click the save icon.
4. Click **Deploy > New deployment**. Click the gear icon next to "Select type" and choose **Web app**.
   - Description: `Blokus leaderboard`
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy**.
5. Google asks you to authorise access. Click **Authorize access**, choose your account, then
   **Advanced > Go to Blokus leaderboard (unsafe) > Allow**. (The warning appears because the
   script is yours and not reviewed by Google; it only touches this one sheet.)
6. Copy the **Web app URL** (it ends in `/exec`).
7. Open `experiment.js` and paste it between the quotes on this line near the top:
   `const LEADERBOARD_URL = "";`
   Then commit and push from GitHub Desktop. (Or send the URL to Claude to do it.)

## Checking it works

Open the study with `?dev=1`, play a puzzle, and a leaderboard should appear under your score.
Rows from testing sessions are marked `TRUE` in the `test` column and are never mixed with real
players. You can delete test rows from the sheet at any time.

## If you change Code.gs later

Use **Deploy > Manage deployments**, click the pencil icon, choose **Version: New version** and
**Deploy**. This keeps the same URL.
