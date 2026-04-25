import random
import traceback
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import io
import re
import pdfplumber
from bs4 import BeautifulSoup
import time
import requests
import xml.etree.ElementTree as ET

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
db = create_client(SUPABASE_URL, SUPABASE_KEY)

app = Flask(__name__)
CORS(app)

# ── HELPERS ─────────────────────────────────────────────────────────────────

def fix_doubled_text(text):
    return "".join(c for i, c in enumerate(text) if i % 2 == 0)

def clean_cell(cell):
    if cell is None:
        return None
    return cell.replace("\n", " ").strip()

# ── PARSER ──────────────────────────────────────────────────────────────────

def extract_data(pdf_file):
    results = {}

    with pdfplumber.open(pdf_file) as pdf:
        if len(pdf.pages) < 2:
            raise ValueError("PDF formatı beklenen DMO şablonunda değil (en az 2 sayfa gerekli).")

        # ── PAGE 1 ──────────────────────────────────────────────────────────
        page1_text = pdf.pages[0].extract_text_simple() or ""

        # Date
        first_lines = page1_text.split("\n")[:6]
        results["tarih"] = None
        for line in first_lines:
            cleaned = re.sub(r'(.)\1', r'\1', line)
            m = re.search(r"\b(\d{2}\.\d{2}\.\d{4})\b", cleaned)
            if m:
                results["tarih"] = m.group(1)
                break

        # 1. Karar ve Sipariş Damga Vergisi
        m = re.search(r"([\d.,]+)\s*TL\s*Karar ve Sipariş Damga Vergisi", page1_text)
        results["karar_siparis_damga_vergisi"] = m.group(1) if m else None

        # 2. Satış Sipariş No
        m = re.search(r"Satış Sipariş No\s*[:\-]?\s*(\S+)", page1_text)
        results["satis_siparis_no"] = m.group(1) if m else None

        # 3. Satınalma Sipariş No
        m = re.search(r"Satınalma Sipariş No\s*[:\-]?\s*(\S+)", page1_text)
        results["satinalma_siparis_no"] = m.group(1) if m else None

        # ── PAGE 2 ──────────────────────────────────────────────────────────
        tables = pdf.pages[1].extract_tables()

        # ── TABLE 0: Müşteri block ───────────────────────────────────────────
        results["musteri_no"] = None
        results["musteri_adi"] = None

        if tables and len(tables) > 0:
            musteri_table = tables[0]
            for row in musteri_table:
                label = clean_cell(row[0]) or ""
                value = clean_cell(row[1]) if len(row) > 1 else None
                if label.startswith("No"):
                    results["musteri_no"] = value
                elif label.startswith("Adı"):
                    results["musteri_adi"] = value

        # ── TABLE 1: Malzeme listesi ─────────────────────────────────────────
        results["malzeme_tablosu"] = []

        if tables and len(tables) > 1:
            malzeme_table = [[clean_cell(cell) for cell in row] for row in tables[1]]

            header_rows = []
            data_rows = []
            for row in malzeme_table:
                first_cell = (row[0] or "").strip()
                if re.match(r"^\d+$", first_cell):
                    data_rows.append(row)
                else:
                    header_rows.append(row)

            if header_rows:
                col_count = max(len(r) for r in header_rows)
                merged_header = []
                for col_idx in range(col_count):
                    parts = []
                    for hr in header_rows:
                        cell = hr[col_idx] if col_idx < len(hr) else None
                        if cell and cell.strip():
                            parts.append(cell.strip())
                    merged_header.append(" ".join(parts))
            else:
                merged_header = [f"col_{i}" for i in range(len(data_rows[0]))] if data_rows else []

            product_col = "MALZEMENIN CINSI(VARSA MARKA VE MODELI)"
            for data_row in data_rows:
                row_dict = dict(zip(merged_header, data_row))
                val = row_dict.get(product_col) or ""
                m = re.search(r"EPSON\s+(\S+)", val)
                row_dict["MALZEME_KODU"] = m.group(1) if m else None
                results["malzeme_tablosu"].append(row_dict)

    return results


def scrape_dmo_product(url, session):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Referer": "https://www.dmo.gov.tr/",
    }

    try:
        res = session.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(res.text, "lxml")

        # ── Price — first price-current div ──────────────────────────────────
        price = None
        price_tag = soup.find("div", class_="price-current")
        if price_tag:
            raw = price_tag.get_text(strip=True)
            raw = raw.replace("₺", "").replace("+ Vergiler", "").strip()
            raw = raw.replace(".", "").replace(",", ".")
            try:
                price = float(raw)
            except:
                pass

        # ── Specs — update debug endpoint to find correct selector ───────────
        specs = {}

        # Try multiple selector patterns DMO might use
        # Pattern 1: dl/dt/dd
        for dt in soup.find_all("dt"):
            dd = dt.find_next_sibling("dd")
            if dd:
                specs[dt.get_text(strip=True)] = dd.get_text(strip=True)

        # Pattern 2: table rows with th/td
        if not specs:
            for row in soup.find_all("tr"):
                cells = row.find_all(["th", "td"])
                if len(cells) == 2:
                    key = cells[0].get_text(strip=True)
                    val = cells[1].get_text(strip=True)
                    if key and val:
                        specs[key] = val

        # Pattern 3: li elements inside spec section
        if not specs:
            spec_section = soup.find("div", class_=lambda c: c and "spec" in c.lower())
            if spec_section:
                for li in spec_section.find_all("li"):
                    text = li.get_text(strip=True)
                    if ":" in text:
                        parts = text.split(":", 1)
                        specs[parts[0].strip()] = parts[1].strip()

        return {"price": price, "specs": specs}

    except Exception as e:
        return {"price": None, "specs": {}, "error": str(e)}


@app.route("/parse-pdf", methods=["POST"])
def parse_pdf():
    if "pdf" not in request.files:
        return jsonify({"error": "No PDF file uploaded"}), 400

    pdf_file = request.files["pdf"]
    pdf_bytes = io.BytesIO(pdf_file.read())

    try:
        data = extract_data(pdf_bytes)
        return jsonify(data)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500



@app.route("/usd-eur-rate", methods=["GET"])
def get_tcmb_kur():
    url      = "https://www.tcmb.gov.tr/kurlar/today.xml"
    response = requests.get(url)

    if response.status_code != 200:
        return jsonify({"error": "TCMB verisi çekilemedi"}), 500

    root    = ET.fromstring(response.content)
    results = {}

    for code in ["USD", "EUR"]:
        node = root.find(f".//Currency[@Kod='{code}']")
        if node is not None:
            results[code] = node.find("ForexBuying").text

    usd = float(results.get("USD", 0))
    eur = float(results.get("EUR", 0))

    # ── Only insert if rates changed ──────────────────────────────────────────
    try:
        last = db.table("rate_history") \
            .select("usd_try, eur_try") \
            .order("recorded_at") \
            .limit(1) \
            .execute()

        last_data = last.data

        if not last_data or \
           round(float(last_data["usd_try"] or 0), 2) != round(usd, 2) or \
           round(float(last_data["eur_try"] or 0), 2) != round(eur, 2):
            db.table("rate_history").insert({
                "usd_try": usd,
                "eur_try": eur,
            }).execute()

    except Exception as e:
        print("Rate history kaydedilemedi:", e)

    return jsonify(results)


@app.route("/scrape-dmo-prices", methods=["POST"])
def scrape_dmo_prices():
    results = { "updated": [], "failed": [] }

    # ── Create session and visit homepage first to get cookies ───────────────
    session = requests.Session()
    session.get("https://www.dmo.gov.tr", headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }, timeout=10)
    time.sleep(2)  # wait after homepage visit

    # ── Fetch products with URLs ──────────────────────────────────────────────
    res      = db.table("products").select("id, dmo_code, dmo_url, sozlesme_fiyat_eur").not_.is_("dmo_url", "null").execute()
    products = res.data
    ref_price = None

    for product in products:
        url = product["dmo_url"]
        if not url:
            continue

        print(f"Scraping: {url}")
        scraped = scrape_dmo_product(url, session)

        # Random delay between 2-4 seconds to avoid detection
        time.sleep(random.uniform(2, 4))

        if not scraped.get("price"):
            print(f"FAILED: {url} — {scraped.get('error')}")
            results["failed"].append(product["dmo_code"])
            continue

        core_keys = [
            "Ürün Tipi", "Orijinal Ürün Kodu", "Marka", "Model",
            "Baskı Kapasitesi", "Renk", "Kullanıldığı Yazıcı Modelleri", "Ürün Türü"
        ]
        dmo_specs = {k: v for k, v in scraped["specs"].items() if k in core_keys}
        dmo_notes = {k: v for k, v in scraped["specs"].items() if k not in core_keys}

        db.table("products").update({
            "dmo_fiyat_try":     scraped["price"],
            "dmo_specs":         dmo_specs,
            "dmo_notes":         dmo_notes,
            "dmo_fiyat_updated": "now()",
            "updated_at":        "now()",
        }).eq("id", product["id"]).execute()

        db.table("product_price_history").insert({
            "product_id":         product["id"],
            "dmo_fiyat_try":      scraped["price"],
            "sozlesme_fiyat_eur": product["sozlesme_fiyat_eur"],
        }).execute()

        if str(product["dmo_code"]) == "106776":
            ref_price = scraped["price"]

        results["updated"].append(product["dmo_code"])
        print(f"OK: {product['dmo_code']} → {scraped['price']} ₺")

    # ── Rate history ──────────────────────────────────────────────────────────────
    if ref_price:
        # Get sozlesme_fiyat_eur for reference product 106776
        ref_product = db.table("products") \
            .select("sozlesme_fiyat_eur") \
            .eq("dmo_code", "106776") \
            .maybeSingle() \
            .execute()

        ref_eur = float(ref_product.data["sozlesme_fiyat_eur"] or 355)
        real_price = ref_price / 1.08  # remove %8 DMO markup
        dmo_eur_try = round(real_price / ref_eur, 4)

        # Get latest USD and EUR rates to store together
        last_rates = db.table("rate_history") \
            .select("usd_try, eur_try") \
            .order("recorded_at", ascending=False) \
            .limit(1) \
            .maybeSingle() \
            .execute()

        usd_try = float(last_rates.data["usd_try"] or 0) if last_rates.data else 0
        eur_try = float(last_rates.data["eur_try"] or 0) if last_rates.data else 0

        # Update latest row with dmo_eur_try instead of inserting new row
        db.table("rate_history") \
            .update({"dmo_eur_try": dmo_eur_try}) \
            .order("recorded_at", ascending=False) \
            .limit(1) \
            .execute()

        results["dmo_eur_try"] = dmo_eur_try
        results["ref_price"] = ref_price
        results["real_price"] = real_price

    results["total_updated"] = len(results["updated"])
    results["total_failed"]  = len(results["failed"])

    return jsonify(results)


@app.route("/debug-dmo", methods=["GET"])
def debug_dmo():
    session = requests.Session()
    session.get("https://www.dmo.gov.tr", headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }, timeout=10)
    time.sleep(2)

    res  = session.get(
        "https://www.dmo.gov.tr/Katalog/Urun/Detay/4350033_1105829?show=1",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.dmo.gov.tr/",
        },
        timeout=15
    )
    soup = BeautifulSoup(res.text, "lxml")

    # Find the specs section specifically
    spec_divs = soup.find_all("div", class_=lambda c: c and any(
        x in c.lower() for x in ["spec", "ozellik", "özellik", "detail", "feature"]
    ))

    # Find all ul/li structures
    lists = []
    for ul in soup.find_all(["ul", "ol"]):
        items = [li.get_text(strip=True) for li in ul.find_all("li")]
        if items:
            lists.append(items[:5])

    # Find section with "Ürün Özellikleri" heading
    spec_heading = soup.find(string=lambda t: t and "Ürün Özellikleri" in t)
    spec_content = None
    if spec_heading:
        parent = spec_heading.find_parent()
        if parent:
            spec_content = str(parent.find_next_sibling())[:2000]

    return jsonify({
        "spec_divs":     [str(d)[:300] for d in spec_divs[:5]],
        "lists_sample":  lists[:5],
        "spec_content":  spec_content,
    })



# ── RUN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # host='0.0.0.0' ensures it listens on all available network interfaces within the container
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)








