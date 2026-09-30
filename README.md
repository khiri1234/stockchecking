# stockchecking

Stock check app: upload a product list (Excel/CSV), scan barcodes on phones
or a computer, and every device sees the counts live. Staff sign in with a
username and password; admins get a desktop dashboard with progress charts,
staff management and an activity log.

- `index.html`: the phone app (also the iOS and Android apps). Computers are sent to the
  dashboard automatically; add `?mobile` to the URL to stay on the phone view.
- `dashboard.html`: desktop dashboard: Overview, Count, Items, Recounts,
  Areas & tasks, Activity log, Staff and Stock check.
- `common.js`: shared Firebase setup, sign-in, staff accounts and activity log.

## Roles

| | Staff | Admin |
|---|---|---|
| Count items, add extra items | yes | yes |
| See progress and item list | yes | yes |
| Start a stock check, reset counts, export | | yes |
| Add staff, reset passwords, switch accounts off/on, change roles | | yes |
| Read the activity log | | yes |
| Add areas, assign tasks | | yes |

The first person to open the app after setup creates the admin account.

## Data

| Firestore path | Holds |
|---|---|
| `catalog/{listId}_{n}` | The product list: `lines`, one `barcode<TAB>description` line per item, split into documents of up to ~700 KB (50,000 items is about 4 documents) |
| `counts/{barcode}` | Only items someone has counted: `barcode`, `description`, `qty` (the total), `by`, `byUid`, `at`, and `parts/{partId}` = `{ qty, by, byUid, at, area, areaName }`, one per addition (12 + 6 = 18). Counts saved before parts existed have no `parts` and count as one part |
| `extras/{barcode}` | Scanned items not on the list: `barcode`, `description`, `qty`, `addedBy`, `addedByUid`, `addedAt` |
| `meta/session` | Current stock check: `name`, `sourceFileName`, `totalProducts`, `startedAt`, `startedBy`, `listId`, `listChunks` |
| `recounts/{barcode}` | Blind recount requests: `status` (`open`/`done`), `firstQty`/`firstBy`/`firstByUid` (the count when asked), `recountQty`/`recountBy`/`recountByUid`/`recountAt`, `requestedBy`. Admins ask and decide; the first counter can't recount their own count |
| `areas/{id}` | Places counted separately: `name`, `order`, `createdAt`, `createdBy`. Kept between stock checks |
| `tasks/{id}` | Work assigned to one person: `uid`, `name`, `areaId`/`areaName`, `items` (barcode IDs, up to 20,000), `itemCount`, `note`, `done`, `doneAt`, `createdAt`, `createdBy`. Staff read only their own and may only mark them done. Removed when a new list is imported or the stock check is deleted |
| `meta/stats` | `counted`: running total for the progress bars (staff may only add 1; an admin's dashboard corrects it from `counts/`) |
| `products/{barcode}` | Lists saved by earlier versions. An admin's app converts them to `catalog/` + `counts/` automatically, keeping the counts |
| `meta/setup` | Marks that the first admin exists |
| `users/{uid}` | `username`, `name`, `role` (`admin`/`staff`), `active`, `createdAt`, `createdBy`, `replacedBy` |
| `usernames/{username}` | `uid`, `email`: sign-in lookup |
| `activity/{id}` | Append-only log: `at` (server time), `uid`, `username`, `name`, `action`, plus `barcode`, `description`, `qty`, `prevQty`, `target`, `detail` where relevant |

**Big lists (up to 100,000 items).** Each device downloads the product list
once per stock check (a handful of reads) and looks barcodes up on the device,
so lookups are instant and work offline. Phones read one count per scan and
the running total from `meta/stats`; they never download every count. The
dashboard follows all of `counts/` live (for its tables and charts), which is
one read per counted item each time it's opened. With 50,000 items that goes
past Firestore's free 50,000 reads a day, so switch the project to the
pay-as-you-go **Blaze** plan for large stock checks (reads cost about $0.06
per 100,000).

Every open copy listens with `onSnapshot`, so a count saved on one phone
shows up everywhere straight away. Firestore's offline cache is on, so counts
saved without signal are sent when the connection returns.

**Sign-in.** Accounts use Firebase Authentication (Email/Password) behind the
scenes. Each username maps to a generated address that nobody receives mail
at, so people only ever see their username. Because a browser can't change
someone else's Firebase password, an admin's "Reset password" creates a new
sign-in under the same username and switches the old one off
(`replacedBy`); history and counts stay attached to the username.

`firestore.rules` only gives access to signed-in, active accounts, lets staff
change nothing but counts saved under their own ID, and keeps the activity
log append-only. Tests: `cd tests && npm install && npm test` (needs Java).

## Adding to a count and Quick count

Scanning an item that is already counted shows each part of its count
(12 · Sam, + 6 · Priya) and adds to it by default: the same item on another
shelf. **Replace total** corrects the count instead. Additions are saved as
increments, so two people adding to one item at once can't overwrite each
other.

**Quick count** (a switch on the phone's Scan tab and the dashboard's Count
page) makes every scan add 1, with a beep and a vibration (the iPhone app uses
the Capacitor Haptics plugin), and shows the item's running total with
**Undo +1**. The phone camera stays open: a barcode held in view counts once
and counts again after it has been out of view for 1.2 s. In the iPhone app,
if the in-page camera isn't available the system scanner reopens after every
scan instead. Items not on the list and items waiting for a blind recount are
refused with a low double beep. Each item gets one part per session and one
activity-log entry a few seconds after its last scan.

## Areas and tasks

An admin adds areas ("Aisle 3", "Warehouse") under **Areas & tasks** on the
dashboard. Once there are areas, the phone asks **Where are you counting?**
before the first scan (the dashboard has a **Counting in** box on the Count
page); the choice stays on that device until changed, and every count part
records it. **Areas & tasks** and the Overview's **By area** card show the
items counted, units and people in each area, and the export has an
**Areas** column. Counts saved without an area (before areas were set up, or with
**No specific area**) show as **No area**; its **Merge into…** button records
them all as counted in the area you pick, without changing the numbers.

Tasks give work to one person: an area (**New task**, or **Assign** on an
area), a list of items (on **Items**, filter and search, then **Assign these
to…**), or both, with an optional note. The person sees **Your task** with its
progress above the scanner and a **Mark done** button; a task's area is picked
for them. Staff with an item task see only those items in their item list
(**My task** on the phone), and counting something else shows "Not in your
task — counted anyway". Admins follow every task's progress and can reopen or
delete it.

## No signal

Counts saved without signal are kept on the device and sent when the
connection returns. The phone shows a red **Offline — 3 counts waiting to
upload** badge under the progress bar (and "All counts uploaded ✓" once
they're sent); the dashboard's Live badge does the same. Scanning an item
the phone hasn't seen before while offline adds to its count instead of
replacing it, since the current total can't be checked. New parts are saved
as plain numbers, so if a save ever reaches the server twice (signal lost
before the answer came back) an admin's dashboard notices the total no
longer matches its parts and corrects it.

## Recounts

An admin can ask for a second, blind count of any counted item: on its count
card (**Ask for a recount**), or for many at once from **Items > Counted >
Ask for recount of these** (search first to narrow the list). Staff see the
items under **Recounts** on the dashboard and as a banner and **To recount**
list on the phone. The first number is hidden from them, and whoever made
the first count can't do the recount. The admin's **Recounts** page then shows
the first count, the recount and the difference: **Use recount** makes the
recount the item's count, **Keep first count** leaves it as it was.

Admins can do the same on the phone: **Ask for a recount** on a counted
item's scan card, **Spot check 10 random counted items** (picked from the
latest 100 counts) and the results with the same two buttons, all under
**Manage > Recounts**; the Manage tab shows how many results are waiting.

## Firebase setup

1. Project `stockchek-1dbe4`; its web config is at the top of `common.js`.
2. **Authentication > Sign-in method > Email/Password > Enable.**
3. **Firestore Database > Rules:** paste `firestore.rules` and **Publish**
   (or `firebase deploy --only firestore:rules`).
4. Open the site and create the admin account on the first-time setup screen.

The site is hosted on GitHub Pages; `firebase deploy` also works (see
`firebase.json`).

## iPhone app (App Store)

The `ios/` folder is a Capacitor Xcode project that wraps `index.html`. In the
app, the libraries are bundled (no CDN), the camera button opens the native
iOS barcode scanner, and Export opens the iOS share sheet.

Needs a Mac with Xcode 16+ and Node.js 20+.

```sh
npm install
npm run ios        # builds www/, syncs it into ios/, opens Xcode
```

In Xcode: select the **App** target > **Signing & Capabilities**, choose your
team, then **Product > Archive** and **Distribute App > App Store Connect**.

After any change to `index.html`, run `npm run ios` again before archiving.

- Bundle ID: `com.khiri1234.stockcheck` (in `capacitor.config.json` and Xcode)
- App icon: see **App icon** below
- Privacy policy for the App Store listing: `privacy.html`
- App Review needs a sign-in: create a staff account for Apple on the dashboard
  and put its username and password in App Store Connect > App Review Information

## Android app

The `android/` folder is the same Capacitor app for Android phones (Android
8 or later): the camera button opens the native barcode scanner, Export opens
the Android share sheet, Quick count vibrates, and the phone's Back button
closes whatever is open, then returns to Scan, then leaves the app.

Every change to the app runs the **Android app** workflow (Actions tab). Open
the latest run and download **The-H-Stock-Management-Android** from
*Artifacts*: it contains `The-H-Stock-Management-1.<run>.apk`.

- **Install on a phone:** send the `.apk` to the phone (email, WhatsApp,
  Google Drive...) and open it. Android asks to allow installing from that
  app once (**Settings > Allow from this source**). A newer APK installs over
  the old one and keeps the sign-in.
- **The APK's signing key** is `android/app/sideload.keystore`, kept in the
  repository on purpose so every build can update the last one. It isn't
  secret, so it's only for installing directly; Google Play uses its own key.
- **Google Play:** create an upload key once on a computer with Java:
  `keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`,
  then add repository secrets `ANDROID_KEYSTORE` (`base64 -i upload.jks`),
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`) and
  `ANDROID_KEY_PASSWORD`. Each run then also produces
  **The-H-Stock-Management-Android-Play** with the `.aab` to upload in the
  Play Console. Keep `upload.jks` and its password safe.
- **Build on a computer** with Android Studio: `npm install`, then
  `npm run android` (builds `www/`, syncs it into `android/`, opens Android
  Studio).
- Package name: `com.khiri1234.stockcheck`. The version is `1.<run number>`.

## App icon

`resources/icon-source.jpg` is the artwork. `scripts/make-icons.js` builds
every icon from it: the iPhone and Android app icons, the Windows and Mac
app icons, and `app-icon.png` (browser tab, home screen and the logo at the
top of the apps). After changing the artwork:
`NODE_PATH=$(npm root -g) node scripts/make-icons.js`.

## Desktop apps (Windows and macOS)

`desktop/` is an Electron app that opens the dashboard in its own window
(`app://stockcheck/dashboard.html`, served from the bundled files; Firebase
still syncs online). Web links open in the normal browser.

Every change to the app runs the **Desktop apps** workflow (Actions tab). Open
the latest run and download from *Artifacts*. It can also be run by hand
(Actions > Desktop apps > Run workflow).

- **Windows:** **The-H-Stock-Management-Windows** contains
  `The-H-Stock-Management-Setup-x.y.z.exe`. It isn't code-signed yet, so
  Windows may show "Windows protected your PC": click **More info > Run anyway**.
- **macOS:** **The-H-Stock-Management-Mac** contains
  `The-H-Stock-Management-x.y.z-mac.dmg` (one app for Apple Silicon and Intel,
  macOS 12 or later). Open it and drag the app into Applications.
  - Unsigned build (no secrets set): the first open is blocked. Open System
    Settings > Privacy & Security, scroll down and click **Open Anyway**.
  - Signed build: add these repository secrets (Settings > Secrets and
    variables > Actions) and the next run signs and notarizes the app, so it
    opens without warnings:
    - `MAC_CERTIFICATE`: a *Developer ID Application* certificate exported
      from Keychain Access as .p12, base64 encoded (`base64 -i cert.p12 | pbcopy`)
    - `MAC_CERTIFICATE_PASSWORD`: the password chosen when exporting
    - `APPLE_ID`: the Apple Account email of the developer account
    - `APPLE_APP_SPECIFIC_PASSWORD`: made at account.apple.com > Sign-In and
      Security > App-Specific Passwords
    - `APPLE_TEAM_ID`: the 10-character Team ID (developer.apple.com > Account)
  - Build on a Mac instead: `cd desktop && npm install && npm run dist:mac`
    (uses the Developer ID certificate in the keychain if there is one).
- **Run locally:** `npm install`, then `cd desktop && npm install && npm start`.
- **Version:** `version` in `desktop/package.json`.
