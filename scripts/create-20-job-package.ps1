# Creates the "20 BOQ Job Package" (£980, one-off) in Stripe:
#   product -> price (£980 GBP) -> payment link (buy.stripe.com URL).
#
# Run it in PowerShell (pwsh) with the live Stripe secret key set:
#   $env:STRIPE_SECRET_KEY = "sk_live_..."   # same key Render uses
#   ./scripts/create-20-job-package.ps1
#
# The webhook already grants 20 credits for any £980 (98000p) one-off payment
# (see PACKS in server/stripe-webhook.js), so the link is live for credit
# granting the moment Stripe creates it. Paste the printed URL into the buy
# buttons and/or set it as STRIPE_LINK_BOQ_20 in Render so the low-balance
# emails offer it too.

$ErrorActionPreference = 'Stop'

$key = $env:STRIPE_SECRET_KEY
if (-not $key) {
    Write-Error 'STRIPE_SECRET_KEY is not set. Run: $env:STRIPE_SECRET_KEY = "sk_live_..."'
    exit 1
}

$headers = @{ Authorization = "Bearer $key" }
$api = 'https://api.stripe.com/v1'

Write-Host 'Creating product...'
$product = Invoke-RestMethod -Method Post -Uri "$api/products" -Headers $headers -Body @{
    name        = 'BOQ Credit Pack (20 credits)'
    description = '20 BOQ job credits for the AI QS portal - best value bundle.'
}
Write-Host "  product: $($product.id)"

Write-Host 'Creating price (GBP 980.00 one-off)...'
$price = Invoke-RestMethod -Method Post -Uri "$api/prices" -Headers $headers -Body @{
    product     = $product.id
    unit_amount = 98000
    currency    = 'gbp'
}
Write-Host "  price: $($price.id)"

Write-Host 'Creating payment link...'
$link = Invoke-RestMethod -Method Post -Uri "$api/payment_links" -Headers $headers -Body @{
    'line_items[0][price]'    = $price.id
    'line_items[0][quantity]' = 1
}

Write-Host ''
Write-Host '============================================================'
Write-Host " 20-job package payment link:"
Write-Host "   $($link.url)"
Write-Host '============================================================'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Set STRIPE_LINK_BOQ_20 to this URL in Render (Environment tab)'
Write-Host '     so low-balance emails include the 20-pack.'
Write-Host '  2. Add the URL to the buy buttons in src/pages/DashboardPage.js,'
Write-Host '     NewProjectPage.js and SubmitDrawingsPage.js if you want it shown'
Write-Host '     in the portal UI.'
Write-Host '  3. No webhook change needed - GBP 980 already maps to 20 credits.'
