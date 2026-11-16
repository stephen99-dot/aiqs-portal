// Glue between the React app and the native shell. Renders nothing.
//
// Mounted once, inside the router, by App.js. On the web every effect is a
// no-op. Inside the iOS app it:
//
//   • marks <html> with .native-app / .native-ios so CSS can tell
//   • routes universal links (https://portal/…) and cold-start URLs into the
//     React router — magic links, team invites, quote/invoice/variation pages
//   • keeps the status bar text readable in both themes
//   • hides the launch splash once the session check has finished, so the
//     user never sees a white flash or a half-rendered login page
//   • refreshes the account when the app returns to the foreground (credits
//     bought on the website, admin changes)
//   • scrolls the focused field into view when the keyboard opens
//   • opens outside links in an in-app Safari sheet instead of leaving the app
//   • keeps the app's screens in step with the website (liveUpdate.js)
//   • registers for push notifications once signed in, and opens the project
//     a tapped notification is about (push.js)
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Keyboard } from '@capacitor/keyboard';
import { isNative, isIOS, platform } from './platform';
import { openExternal, isExternalHref, opensAnotherApp } from './openExternal';
import { confirmReady, checkForNewBundle } from './liveUpdate';
import { listenForPush, enablePushForUser } from './push';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

// Turn an incoming URL into a router path. Universal links carry the portal's
// own path (https://host/magic?token=…); a custom scheme (aiqs://magic?token=…)
// carries it as host + path. Anything we can't read is ignored.
export function routeForIncomingUrl(raw) {
  try {
    const u = new URL(raw);
    let path;
    if (/^https?:$/.test(u.protocol)) path = u.pathname;
    else path = '/' + (u.host || '') + (u.pathname === '/' ? '' : u.pathname);
    path = path.replace(/\/{2,}/g, '/');
    if (!path || path === '/' || path.startsWith('/api')) return null;
    return path + u.search + u.hash;
  } catch (e) {
    return null;
  }
}

export default function NativeBridge() {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { loading, user, refreshUser } = useAuth();
  const latest = useRef({ user, refreshUser });
  latest.current = { user, refreshUser };

  // Mark the document so CSS can behave like an app.
  useEffect(() => {
    if (!isNative()) return undefined;
    const root = document.documentElement;
    const classes = ['native-app', 'native-' + platform()];
    root.classList.add(...classes);
    return () => root.classList.remove(...classes);
  }, []);

  // This bundle started. Said first, before anything that could fail: a
  // freshly applied web bundle is rolled back if the shell never hears it.
  useEffect(() => { confirmReady(); }, []);

  // Deep links — while running, and the one the app was launched with.
  useEffect(() => {
    if (!isNative()) return undefined;
    let handle;
    const go = (url, replace) => {
      const to = routeForIncomingUrl(url);
      if (to) navigate(to, { replace });
    };
    CapApp.addListener('appUrlOpen', ({ url }) => go(url, false)).then((h) => { handle = h; });
    CapApp.getLaunchUrl().then((r) => { if (r && r.url) go(r.url, true); }).catch(() => {});
    return () => { if (handle) handle.remove(); };
  }, [navigate]);

  // Status bar text colour follows the theme (the bar itself is transparent
  // over our own header, see capacitor.config.json).
  useEffect(() => {
    if (!isIOS()) return;
    StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
  }, [isDark]);

  // Splash stays up until we know whether there is a session.
  useEffect(() => {
    if (!isNative() || loading) return;
    SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {});
    // Once the app is up, see whether the portal has newer screens. Fetched
    // in the background and used from the next reopen.
    const t = setTimeout(() => { checkForNewBundle({ force: true }); }, 4000);
    return () => clearTimeout(t);
  }, [loading]);

  // Push: listen for the device token and for taps, for the app's lifetime.
  useEffect(() => listenForPush({ onOpen: (path) => navigate(path) }), [navigate]);

  // Ask for notification permission once someone is signed in — not on the
  // login screen, where the prompt would mean nothing yet.
  const userId = user && user.id;
  useEffect(() => {
    if (!isNative() || !userId) return undefined;
    const t = setTimeout(() => { enablePushForUser(); }, 1500);
    return () => clearTimeout(t);
  }, [userId]);

  // Foreground → refresh the account.
  useEffect(() => {
    if (!isNative()) return undefined;
    let handle;
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && latest.current.user) latest.current.refreshUser();
      if (isActive) checkForNewBundle();
    }).then((h) => { handle = h; });
    return () => { if (handle) handle.remove(); };
  }, []);

  // Keyboard: the webview resizes natively (Keyboard.resize = native), so the
  // layout already fits; this just makes sure the field being typed in is on
  // screen rather than under the keyboard's top edge.
  useEffect(() => {
    if (!isNative()) return undefined;
    let handle;
    Keyboard.addListener('keyboardDidShow', () => {
      const el = document.activeElement;
      if (el && typeof el.scrollIntoView === 'function' && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
      }
    }).then((h) => { handle = h; });
    return () => { if (handle) handle.remove(); };
  }, []);

  // Outside links open in an in-app browser sheet. Links meant for another
  // app (WhatsApp, Mail, Phone) keep their default so iOS hands them over.
  useEffect(() => {
    if (!isNative()) return undefined;
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || a.hasAttribute('download')) return;
      if (opensAnotherApp(a.href)) return;
      if (!isExternalHref(a.href)) return;
      e.preventDefault();
      openExternal(a.href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
