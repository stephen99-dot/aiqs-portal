# Hostinger uploads for theaiqs.co.uk

The marketing site is hosted on Hostinger, not served by this repo's Express
app. The files in this folder belong in the site root (`public_html/`) on
Hostinger, alongside the static pages the homepage links to.

## The homepage: index.php + fx-rates.php

`index.php` is the live homepage. It is PHP rather than HTML for two reasons:

- the visitor's country from the hosting layer (Cloudflare's `CF-IPCountry`
  and friends) is read at the top and handed to the country script in `<head>`;
- the pricing section converts the GBP prices into the visitor's currency at a
  **live exchange rate**, which `fx-rates.php` fetches once a day and prints
  into the page.

How the live rates behave:

- `fx-rates.php` asks a free rate feed (Exchange Rate API, with the ECB's
  Frankfurter feed as a fallback) for GBP rates at most once a day and caches
  the answer in `cache/fx-rates.json`.
- A page view never waits on the feed: a cached table is served as-is, a stale
  one is refreshed at most once every five minutes with a three-second
  timeout, and if there is no cache and the feed is down the static table
  inside `fx-rates.php` stands.
- Every live rate is sanity-checked against that static table (more than 3x
  away is treated as a feed fault and ignored), and a feed that only carries
  some currencies is fine: the rest stay static.
- In the page, non-GBP prices are the GBP price converted at the rate and
  rounded by `charmPrice()` to a figure that looks set by a person (`$199`,
  `$1,299`, `R3,499`). The note under the prices says which day's rate was
  used. Checkout is still the GBP Stripe link; the note says so.
- To hold a currency at a fixed figure whatever the rate does, add it to
  `PINNED_PRICES` in `index.php`.

To deploy: upload `index.php`, `fx-rates.php` and the `cache/` folder (with
its `.htaccess`) to `public_html/`. The cache folder must be writable by PHP;
if it is not, the rates are cached in the system temp directory instead.

Check it is working: `https://theaiqs.co.uk/?country=US` should show dollar
prices and a note ending "Rates by Exchange Rate API". Over SSH,
`php fx-rates.php` prints whether the rates are live, the date they are good
for, and the table the page is given.

`homepage-default.php` at the repo root is an older copy of the homepage from
before the country and currency work and is superseded by `index.php` here.

## robots.txt and sitemap.xml

Hostinger hPanel → Files → File Manager → `public_html/` → upload `robots.txt`
and `sitemap.xml`. Then confirm both load in a browser:

- https://theaiqs.co.uk/robots.txt
- https://theaiqs.co.uk/sitemap.xml

Then submit `sitemap.xml` in Google Search Console (Indexing → Sitemaps).

The sitemap lists the pages linked from the homepage: `/`,
`send-drawings.html`, `officeinabox.html`, `privacy.html`, `terms.html`.
If a listed page doesn't exist on the live site, delete its line before
uploading; when new pages are added to the site, add a line here too.
(`officeinabox.html` is linked from one version of the homepage — check it
loads before keeping it.)
