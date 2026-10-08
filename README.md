# PerfectFlashcards

A single-page app for creating and studying Markdown flashcards, with Google Sign-In, offline-first Firestore, CSV import, and Cloudinary images. The PWA is designed for GitHub Pages, Ubuntu desktops, and mobile devices.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env` and configure Firebase and Cloudinary using [SETUP_SERVICES.md](SETUP_SERVICES.md).
3. Install dependencies and run `npm run dev`.
4. To verify a production build, run `npm run build`.

`VITE_*` credentials are included in the public bundle: the Firebase API key and unsigned Cloudinary preset are not secrets. Enforce security with Firebase Security Rules rather than trying to hide client configuration.

## Usage

- Create decks and chapters, then add flashcards. Questions and answers support Markdown and preview.
- Import CSV: column A is the question and column B is the answer. Use CSV quotes for fields containing commas. Do not include a header row.
- Upload images from the Answer column: the Cloudinary HTTPS Markdown link is inserted automatically.
- Study an entire deck or select multiple chapters. Each batch contains 10 cards; if fewer than 10 are available, cards repeat in the batch. Cards with lower ratings are prioritized, with ties shuffled randomly.
- Changes are queued offline in IndexedDB and synced by Firestore when connectivity returns. Sign in online at least once to authenticate.

## Deploy to GitHub Pages

1. Push the project to GitHub on the `main` branch.
2. Under **Settings → Pages**, select **GitHub Actions** as the source.
3. Add the Firebase and Cloudinary values listed in `.env.example` as repository secrets under **Settings → Secrets and variables → Actions**.
4. The workflow in `.github/workflows/deploy.yml` builds with the repository name as the base path and publishes `dist` on every push to `main`.
5. Add the GitHub Pages hostname to Firebase Authentication's Authorized domains.

For a custom domain or a different deployment subdirectory, update `VITE_BASE_PATH` in the workflow and configure the domain in GitHub Pages.

## Data model

Firestore collections are `users`, `decks`, `chapters`, and `flashcards`. Each content document includes `userId`; images are stored as HTTPS URLs, never binary files. Access rules are in [firestore.rules](firestore.rules), while creation and cascading deletion are handled by the client.

> Publish `firestore.rules` in the Firebase console before using the app. Firebase and Cloudinary services and project rules must be configured by the project owner.
