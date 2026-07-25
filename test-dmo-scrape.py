#!/usr/bin/env python3
"""
DMO scrape diagnostic — run on the SAME machine as app.py (needs net access to dmo.gov.tr).

    python3 test_dmo_scrape.py [dmo_code]      # default 106776

Answers one question: are the DMO search + detail pages server-rendered (scrapeable
with requests + BeautifulSoup) or JS-rendered (empty shell → needs a headless browser
or DMO's underlying JSON endpoint)? It also dumps the raw HTML to disk so you can look
at the real markup instead of guessing.
"""
import sys
import re
import time

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as e:
    print("Missing dependency:", e, "\nInstall with: pip install requests beautifulsoup4 lxml")
    sys.exit(1)

DMO_CODE         = sys.argv[1] if len(sys.argv) > 1 else "106776"
# A known-good detail URL (from the product you shared) to test the detail parser directly:
KNOWN_DETAIL_URL = "https://www.dmo.gov.tr/Katalog/Urun/Detay/4598750_1105829"

UA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Referer": "https://www.dmo.gov.tr/",
}


def hr(title):
    print("\n" + "=" * 72 + f"\n{title}\n" + "=" * 72)


def markers(html, keys):
    for k in keys:
        print(f"   [{'FOUND  ' if k in html else 'MISSING'}]  {k!r}")


def save(name, html):
    with open(name, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"   -> raw HTML saved to {name}  ({len(html):,} bytes)")


def soup_of(html):
    # match app.py (lxml); fall back to stdlib parser if lxml isn't present
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


def test_detail(session, url, savename):
    url = url.rstrip("#")
    try:
        r = session.get(url, headers=UA_HEADERS, timeout=15)
    except Exception as e:
        print("   FETCH FAILED:", e)
        return
    print(f"   HTTP {r.status_code}, {len(r.text):,} bytes")
    markers(r.text, ["Orijinal Ürün Kodu", "Marka", "Model", "price-current", "DMO Ürün Kodu"])
    save(savename, r.text)

    text = soup_of(r.text).get_text("\n", strip=True)

    def field(label):
        m = re.search(rf"{label}\s*[:\-]\s*([^\n]+)", text)
        return m.group(1).strip() if m else None

    mpn = field("Orijinal Ürün Kodu")
    if mpn:
        mpn = mpn.split()[0].strip()
    print("   extracted ->")
    print("      MPN   :", mpn)
    print("      Marka :", field("Marka"))
    print("      Model :", field("Model"))


def main():
    session = requests.Session()

    hr("0) Prime session (homepage)")
    try:
        r0 = session.get("https://www.dmo.gov.tr", headers=UA_HEADERS, timeout=10)
        print(f"   homepage: HTTP {r0.status_code}, {len(r0.text):,} bytes")
    except Exception as e:
        print("   homepage fetch FAILED:", e)
        return
    time.sleep(1)

    # ── 1) SEARCH PAGE ────────────────────────────────────────────────────
    search_url = f"https://www.dmo.gov.tr/Arama?s={DMO_CODE}"
    hr(f"1) SEARCH PAGE   {search_url}")
    try:
        r = session.get(search_url, headers=UA_HEADERS, timeout=15)
    except Exception as e:
        print("   FETCH FAILED:", e)
        return
    print(f"   HTTP {r.status_code}, {len(r.text):,} bytes")
    markers(r.text, ["product-item", "Detay", "price-current", 'class="brand"', 'class="title"'])
    save(f"arama_{DMO_CODE}.html", r.text)

    soup = soup_of(r.text)
    cards = soup.find_all("div", class_="product-item")
    print(f"\n   div.product-item cards found: {len(cards)}")

    detail_url = None
    for i, item in enumerate(cards[:10]):
        brand_div = item.find("div", class_="brand")
        code_span = brand_div.find("span") if brand_div else None
        code = code_span.get_text(strip=True) if code_span else "(no code)"
        title_div = item.find("div", class_="title")
        link = title_div.find("a", href=True) if title_div else None
        href = link["href"] if link else "(no link)"
        flag = "   <<< MATCHES TARGET CODE" if code == DMO_CODE else ""
        print(f"      [{i}] code={code!r}  href={href!r}{flag}")
        if code == DMO_CODE and link:
            detail_url = "https://www.dmo.gov.tr" + href

    if not cards:
        print("\n   !! No 'product-item' cards in the raw HTML.")
        print("      The search list is probably JS-rendered — requests+BS4 will never see it.")
        print("      Next step: a headless browser (Playwright/Selenium) OR find the JSON")
        print("      endpoint the page calls (check the Network tab on dmo.gov.tr).")

    # ── 2) DETAIL PAGE (found via search) ─────────────────────────────────
    hr("2) DETAIL PAGE  (URL discovered via search)")
    if detail_url:
        print("   discovered URL:", detail_url)
        test_detail(session, detail_url, "detay_found.html")
    else:
        print("   No detail URL discovered via search (see section 1). Skipping.")

    # ── 3) DETAIL PAGE (known URL, direct) ────────────────────────────────
    hr("3) DETAIL PAGE  (known URL, direct)")
    print("   url:", KNOWN_DETAIL_URL)
    test_detail(session, KNOWN_DETAIL_URL, "detay_known.html")

    # ── VERDICT ───────────────────────────────────────────────────────────
    hr("HOW TO READ THIS")
    print("   • Section 1 shows cards  AND  section 3 finds 'Orijinal Ürün Kodu'")
    print("       -> scraper approach works; may just need selector/regex tuning.")
    print("   • Section 1 shows 0 cards")
    print("       -> search page is JS-rendered -> headless browser or JSON API needed.")
    print("   • Section 3 has no 'Orijinal Ürün Kodu' (MPN = None)")
    print("       -> detail page is JS-rendered too.")
    print("   • Open the saved .html files (arama_*.html, detay_*.html) to confirm by eye.")
    print("   • A 403 / tiny body / 'challenge' page = DMO is blocking non-browser requests.")


if __name__ == "__main__":
    main()