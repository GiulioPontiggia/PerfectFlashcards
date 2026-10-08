# Firebase and Cloudinary setup

## 1. Firebase

### Create the web project

1. In the Firebase console, create a project and add a web app.
2. Copy the SDK settings shown by the console into `.env` (create it by copying `.env.example`). Put `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId` in their corresponding `VITE_FIREBASE_*` variables.
3. Under **Authentication → Sign-in method**, enable **Google** and select a support email.
4. Under **Authentication → Settings → Authorized domains**, verify that `localhost` is present and add your GitHub Pages host, for example `username.github.io` (without a protocol or path).
5. Create a database under **Firestore Database**.
6. Publish the contents of [firestore.rules](firestore.rules) under **Firestore Database → Rules**. Alternatively, with the Firebase CLI installed and the project selected, deploy the rules from `firestore.rules`.

The rules allow operations only for the authenticated owner (`userId` must match their UID). Verify the rules in a test environment before publishing. Client queries are always filtered by `userId`.

### Offline persistence

The app initializes Firestore with persistent, multi-tab IndexedDB caching. Firestore stores documents read on the device and queues writes; synchronization resumes automatically when the device is online. Initial Google sign-in requires a connection. The device cache is not encrypted by the app: on a shared device, sign out and secure the operating-system account.

## 2. Cloudinary

1. Create a Cloudinary account and find your **Cloud name** on the dashboard.
2. Open **Settings → Upload → Upload presets** and create a preset with **Signing Mode: Unsigned**.
3. Apply sensible file-format and size restrictions to the unsigned preset. Avoid exposing transformation or destination settings that are more permissive than necessary.
4. Set `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` in `.env`.
5. The app uploads images directly and stores only the HTTPS `secure_url` in the Markdown answer.

An unsigned preset is public by definition: anyone can attempt uploads to it. Apply limits in Cloudinary and monitor usage and quotas; never put an API secret in the frontend.

## 3. Environment variables and deployment

Copy `.env.example` to `.env` for local development. Do not commit `.env`. Vite embeds `VITE_*` variables in the static files, so they are visible to anyone who downloads the SPA. Do not put passwords, private tokens, or API secrets in them. Firebase client keys identify the app; they do not replace Firestore Security Rules.

Add the following repository secrets for GitHub Actions, using these exact names:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET`

The workflow automatically sets `VITE_BASE_PATH=/<repository-name>/`. After enabling GitHub Pages with **GitHub Actions** as the source, deployments run on every push to `main`. Add the published hostname to Firebase Authorized domains.

## 4. Quick verification

- Sign in with Google and create a deck, chapter, and flashcard.
- Reload the page and verify that the data persists.
- Import a CSV containing quoted fields with embedded commas.
- Rate some cards in Study mode and verify `rating` and `lastReviewedAt` in Firestore.
- After opening the app online at least once, try reopening it offline. Firestore operations use available cache and synchronize when the device reconnects.
