# stockchecking

Stock check web app: upload a product list (Excel/CSV), scan barcodes on
phones, and every device sees the counts live.

## Data

| Firestore path | Holds |
|---|---|
| `products/{barcode}` | `barcode`, `description`, `countedQty` (null until counted), `updatedBy`, `updatedAt` |
| `extras/{barcode}` | Scanned items not on the list: `barcode`, `description`, `qty`, `addedBy`, `addedAt` |
| `meta/session` | Current stock check: `name`, `sourceFileName`, `totalProducts`, `startedAt`, `startedBy` |

Every open copy of the page listens with `onSnapshot`, so a count saved on
one phone shows up on the others straight away. Firestore's offline cache is
on, so counts saved without signal are sent when the connection returns.

When the page runs as a claude.ai artifact it uses the artifact's shared
database instead, and Firebase isn't touched.

## Firebase setup

1. Create a project at <https://console.firebase.google.com> and add a
   **Web app**.
2. **Build > Firestore Database > Create database.**
3. The web app config lives in `window.FIREBASE_CONFIG` near the top of
   `index.html` (project `stockchek-1dbe4`). With placeholder values the page
   shows "Live sync unavailable".
4. Deploy the security rules and host the page:
   ```sh
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy             # rules + hosting
   ```
   Any static host (e.g. GitHub Pages) also works for `index.html`. If you
   host it elsewhere, deploy the rules with `firebase deploy --only firestore:rules`.

The app has no sign-in, so anyone with the page URL can read and change the
stock data. `firestore.rules` restricts writes to the three paths above with
the expected fields. Add Firebase Auth if the data needs protecting.
