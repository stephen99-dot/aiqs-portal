// Saving a generated file (BOQ .xlsx, findings .docx, invoice .pdf …).
//
// In a browser the portal creates an object URL and clicks a hidden <a download>.
// Inside the iOS app that does nothing: WKWebView has no download manager, so
// the tap is silently swallowed — which is the single biggest "the app is
// broken" moment for a wrapped web app. Here the blob is written to the app's
// cache directory and handed to the iOS share sheet, which offers Save to
// Files, AirDrop, Mail, WhatsApp, Open in Excel/Numbers, and so on.
//
// Every download in the portal goes through saveBlob so the behaviour is the
// same on every page.
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './platform';

const SUBDIR = 'AI QS';

function safeName(name) {
  const trimmed = String(name || 'download').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-');
  return trimmed || 'download';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function browserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick — Safari needs the URL alive while it starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save a Blob under `filename`.
 * @returns {Promise<{method: 'download'|'share'|'cancelled', uri?: string}>}
 */
export async function saveBlob(blob, filename) {
  const name = safeName(filename);
  if (!isNative()) {
    browserDownload(blob, name);
    return { method: 'download' };
  }
  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: `${SUBDIR}/${name}`,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({
      title: name,
      url: written.uri,
      dialogTitle: `Save or share ${name}`,
    });
    return { method: 'share', uri: written.uri };
  } catch (err) {
    // Dismissing the share sheet rejects with "Share canceled" — that is not an error.
    if (/cancel/i.test(String(err && err.message))) return { method: 'cancelled', uri: written.uri };
    throw err;
  }
}

/** Save a string as a text file (code snippets, JSON exports). */
export function saveText(text, filename, mime = 'text/plain;charset=utf-8') {
  return saveBlob(new Blob([text], { type: mime }), filename);
}

/** Read a filename out of a Content-Disposition header, else the fallback. */
export function filenameFromResponse(resp, fallback) {
  const disp = (resp && resp.headers && resp.headers.get('content-disposition')) || '';
  const star = disp.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].replace(/^"|"$/g, '')); } catch (e) { /* fall through */ } }
  const m = disp.match(/filename="?([^";]+)"?/i);
  return m ? m[1] : fallback;
}
