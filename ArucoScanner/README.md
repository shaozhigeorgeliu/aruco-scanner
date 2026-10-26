# ArUco Scanner (iPhone)

Point the iPhone camera at an ArUco tag and the app shows the tag's number (ID) in big type.
It works out the dictionary on its own, so you don't have to say whether the tag is 4×4, 5×5, 6×6, 7×7, ArUco Original or AprilTag.

It is a Progressive Web App: you host these files once, open the address in Safari, and use
**Share → Add to Home Screen**. After that it launches full-screen like a normal app and works offline.
(No Xcode, no Apple developer account, no App Store.)

## Why it has to be hosted

iOS only lets web pages use the camera on **https** addresses. Opening the files straight from the Mac or
over plain `http://192.168…` will not give camera access. Any free static host does the job:

### Option A: GitHub Pages
1. Create a new GitHub repository and upload the *contents* of this `ArucoScanner` folder (so `index.html` is at the top level).
2. Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. After a minute the site is live at `https://<your-user>.github.io/<repo>/`.

### Option B: Netlify Drop or Cloudflare Pages
Drag the `ArucoScanner` folder onto <https://app.netlify.com/drop> (or create a Cloudflare Pages project with direct upload). You get an https address immediately.

## Install on the iPhone
1. Open the https address in **Safari** (not Chrome).
2. Tap **Share → Add to Home Screen → Add**.
3. Open "ArUco Scan" from the Home Screen, tap **Start camera**, and allow camera access.

## Using it
* The big green number is the tag ID. Underneath: the library found and its OpenCV name,
  e.g. `ArUco 4×4 · DICT_4X4_50`.
  (OpenCV's 50/100/250/1000 versions of a family share the same code table, so a tag that reads `17` fits all of
  `DICT_4X4_50/100/250/1000`; the smallest one that contains the ID is shown.)
* Several tags in view: the largest is shown big, the others appear as chips below. Every newly seen tag is added to **History**.
* **Pause / Copy ID / Export** (CSV via the iOS share sheet) / **Clear**.
* **Photo** scans a picture from your camera roll or takes one with the system camera (also works without https).
* ⚙︎ lets you lock to one dictionary (faster, fewer false hits) and choose detection detail (Fast 640 / Normal 800 / High 1280).

## Tips for good reads
* Keep the whole tag, including its black border *and* a white margin, in view and reasonably flat.
* Light the tag evenly, avoid glare. A tag needs to be roughly 40+ pixels wide in the camera image; use *High* detail or move closer for small tags.
* A tag has to be seen on 3–4 consecutive frames before it is reported. This stops 4×4 tags from "appearing" in random texture.

## Supported libraries (Auto mode)
ArUco 4×4 · 5×5 · 6×6 · 7×7 (OpenCV `DICT_nXn_*`), ArUco Original (`DICT_ARUCO_ORIGINAL`), ArUco MIP 36h12,
AprilTag 16h5 · 25h9 · 36h10 · 36h11. Less common ones (ARTag, ARToolKitPlus, MIP 16h3/25h7, AprilTag 25h7/36h9, js-aruco default)
can be chosen manually in settings.

## Files
`index.html`, `app.js` (UI, camera, tracking), `detector.js` (multi-dictionary detection),
`lib/` (js-aruco2, MIT licence, with all dictionaries), `sw.js` + `manifest.webmanifest` (offline / install).
