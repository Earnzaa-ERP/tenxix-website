# Tenxix Reset — Pelvic Floor Trainer

Landing page for **Tenxix Reset**, the pelvic floor trainer in the Tenxix Wellness product line. Modeled on the gruns.co flow — hero with buy box, benefit blocks, stats, video testimonials, how-it-works, us-vs-them table, written testimonials, FAQ, and embedded order form. Dusty pink + cream palette, modern sans-serif typography.

## Project structure

```
tenxix-wellness/
├── index.html              ← page structure + content
├── css/
│   ├── tokens.css          ← colors, fonts, buttons, base styles ← EDIT TO RECOLOR
│   ├── layout.css          ← promo bar, nav, footer
│   ├── sections.css        ← hero+buy box, benefits, stats, compare, etc.
│   └── responsive.css      ← all media queries (mobile/tablet)
├── svg/                    ← illustrations used in hero gallery
│   ├── hero.svg
│   ├── arms.svg
│   ├── tightening.svg
│   ├── postpartum.svg
│   ├── bladder.svg
│   └── menopause.svg
├── images/                 ← drop GIFs / real product photos here
└── README.md               ← you are here
```

## How to preview locally

Double-click `index.html` to open in your browser. Or use VS Code's **Live Server** extension for auto-refresh on save.

## Common edits

### Brand colors

Open `css/tokens.css`. The `:root` block has every color as a CSS variable:

```css
:root{
  --bone:#FAF5EE;        /* warm cream */
  --pink:#D88B96;        /* dusty rose — brand color */
  --pink-deep:#B86577;   /* deep pink — buttons, accents */
  --pink-soft:#F5DCE0;   /* soft pink — backgrounds, badges */
  --ink:#2A1F25;         /* warm near-black */
  ...
}
```

Change a hex value — every place that variable is used updates everywhere.

### Price

Search the project (`Ctrl/Cmd + Shift + F`) for `45,000` and `45000`. Appears in: hero buy box pricing tiers (with multi-unit prices `80000` and `110000`), final CTA, sticky mobile CTA, comparison table, and the pricing JS at the bottom of `index.html` (where `var unit = 45000`).

### Pricing tiers

In `index.html`, search for `<!-- Pricing -->`. Each `.price-tier` has a `data-price` attribute. The "Save X%" labels and the multi-quantity logic live in the `<script>` block at the bottom.

### WhatsApp / order link

The order form is an embedded earnzaa iframe in the `#order` section. Replace the iframe `src` to swap in a different order endpoint. The Order Now buttons all use `href="#order"` so they scroll to the embedded form.

### Add a testimonial

In `index.html`, find `<!-- ============ TESTIMONIALS ============ -->`. Copy any `<div class="test-card fade-up">…</div>` block, paste below it, edit text + avatar letter + location.

### Add video testimonials

The `#watch` section has 4 portrait (9:16) video cards. To wire up a real video:

1. Drop the MP4 into `images/` (e.g. `images/test-folake.mp4`)
2. Optionally drop a poster frame (`.jpg`) at `images/test-folake-poster.jpg` so the first frame doesn't flash black before play
3. In `index.html`, find the matching `.video-card` and update its `<video>` tag:

```html
<video preload="none" playsinline poster="images/test-folake-poster.jpg">
  <source src="images/test-folake.mp4" type="video/mp4">
</video>
```

4. Optional: remove the `<div class="video-placeholder">…</div>` line so the placeholder text disappears.

Click-to-play behavior is automatic — the script at the bottom of `index.html` handles it.

### Add GIFs to the "See it in action" strip

Three slots in the `.gifs` section. Drop GIFs into `/images/`, then replace each empty `<img src="">` with `<img src="images/your-gif.gif" alt="…">`. Cards without a GIF show the elegant placeholder text automatically.

### Replace hero gallery images

The hero gallery loads `svg/hero.svg` by default. The thumbnails swap between the 5 angle SVGs. To use real product photos:
1. Drop photos into `images/` (e.g. `product-1.jpg`, `product-2.jpg`)
2. In `index.html`, find `.hero-thumb` and replace the `data-img` attribute + inline `<object>` data with `<img src="images/product-1.jpg" alt="">`
3. Update the gallery swap script if needed

### Comparison table — Tenxix vs alternatives

Find `<!-- ============ US VS THEM ============ -->` in `index.html`. Each row is `<div class="compare-row">`. Edit cells freely — the table auto-collapses to mobile cards on phones (per `responsive.css`).

## How to deploy

This is a vanilla HTML/CSS site — no build step, no npm, no Node. Three easy paths:

1. **Netlify drag & drop** — drag the whole folder onto [app.netlify.com/drop](https://app.netlify.com/drop). Free, instant, SSL included.
2. **Namecheap cPanel** (recommended for tenxix subdomain) — upload via File Manager or FTP to `public_html/wellness/` (subdomain `wellness.tenxix.com`).
3. **Cloudflare Pages / Vercel** — both support drag-and-drop of static folders, free, unlimited bandwidth.

## Fonts

- **Bricolage Grotesque** — display / headlines (variable, modern, has character)
- **Inter** — body / UI text (workhorse sans)

Both loaded from Google Fonts via the `<link>` in `index.html` `<head>` — no install needed.

## Responsive design

Three breakpoints in `css/responsive.css`:
- **≥ 980px** — desktop (default styles)
- **≤ 980px** — tablet / small laptop
- **≤ 640px** — phones (sticky CTA appears at the bottom)

Tested layouts at: iPhone SE (320px), iPhone 13 (390px), Pixel 5 (393px), Samsung S20 (360px), iPad Mini (768px). All tap targets ≥ 44px.

## To-do before launch

- [ ] Wire WhatsApp number / order phone number into CTAs if not using the embedded form
- [ ] Replace SVG hero illustrations with real product photos (recommended for paid traffic)
- [ ] Add real GIFs to the "See it in action" strip
- [ ] Update footer social / WhatsApp link
- [ ] Add Meta Pixel + Google Analytics tracking IDs
- [ ] Verify testimonial names — currently placeholders; swap with real customer quotes
- [ ] Test "Order Now" CTA flow end-to-end (the embedded earnzaa form → confirmation → delivery)
- [ ] Add favicon + open-graph image for link previews
