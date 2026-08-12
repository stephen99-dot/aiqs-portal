# Hostinger uploads for theaiqs.co.uk

The marketing site (homepage-default.php and the static pages it links) is
hosted on Hostinger, not served by this repo's Express app. The files in
this folder belong in the site root on Hostinger, alongside the homepage.

To deploy: Hostinger hPanel → Files → File Manager → `public_html/` →
upload `robots.txt` and `sitemap.xml`. Then confirm both load in a browser:

- https://theaiqs.co.uk/robots.txt
- https://theaiqs.co.uk/sitemap.xml

Then submit `sitemap.xml` in Google Search Console (Indexing → Sitemaps).

The sitemap lists the pages linked from the homepage: `/`,
`send-drawings.html`, `officeinabox.html`, `privacy.html`, `terms.html`.
If a listed page doesn't exist on the live site, delete its line before
uploading; when new pages are added to the site, add a line here too.
(`officeinabox.html` is linked from one version of the homepage — check it
loads before keeping it.)
