# stockchecking

Stock check app: upload a product list (Excel/CSV), scan barcodes on phones
or a computer, and every device sees the counts live. Staff sign in with a
username and password; admins get a desktop dashboard with progress charts,
staff management and an activity log.

- `index.html`: the phone app (also the iOS app). Computers are sent to the
  dashboard automatically; add `?mobile` to the URL to stay on the phone view.
- `dashboard.html`: desktop dashboard: Overview, Count, Items, Activity log,
  Staff and Stock check.
- `common.js`: shared Firebase setup, sign-in, staff accounts and activity log.

## Roles

| | Staff | Admin |
|---|---|---|
| Count items, add extra items | yes | yes |
| See progress and item list | yes | yes |
| Start a stock check, reset counts, export | | yes |
| Add staff, reset passwords, switch accounts off/on, change roles | | yes |
| Read the activity log | | yes |

The first person to open the app after setup creates the admin account.

## Data

| Firestore path | Holds |
|---|---|
| `products/{barcode}` | `barcode`, `description`, `countedQty` (null until counted), `updatedBy`, `updatedByUid`, `updatedAt` |
| `extras/{barcode}` | Scanned items not on the list: `barcode`, `description`, `qty`, `addedBy`, `addedByUid`, `addedAt` |
| `meta/session` | Current stock check: `name`, `sourceFileName`, `totalProducts`, `startedAt`, `startedBy` |
| `meta/setup` | Marks that the first admin exists |
| `users/{uid}` | `username`, `name`, `role` (`admin`/`staff`), `active`, `createdAt`, `createdBy`, `replacedBy` |
| `usernames/{username}` | `uid`, `email`: sign-in lookup |
| `activity/{id}` | Append-only log: `at` (server time), `uid`, `username`, `name`, `action`, plus `barcode`, `description`, `qty`, `prevQty`, `target`, `detail` where relevant |

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
- App icon: `resources/icon.png`, regenerated with `scripts/make-icon.js`
- Privacy policy for the App Store listing: `privacy.html`
- App Review needs a sign-in: create a staff account for Apple on the dashboard
  and put its username and password in App Store Connect > App Review Information
