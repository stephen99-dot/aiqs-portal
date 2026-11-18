import { authedFetch } from './api';
import { saveBlob } from '../native/saveFile';

// Fetch an authenticated file from the API and hand it over: a browser
// download on the web, the share sheet inside the app (saveBlob handles both).
export default async function downloadFile(path, filename) {
  const r = await authedFetch(path);
  if (!r.ok) {
    let msg = 'Could not make that file.';
    try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep the default */ }
    throw new Error(msg);
  }
  await saveBlob(await r.blob(), filename);
}
