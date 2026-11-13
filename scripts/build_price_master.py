#!/usr/bin/env python3
"""
Pengisi awal data/price_master.json — satu tempat untuk harga normal, bottom,
paket, dan promo per campaign.

Sumber:
  1. "Harga Katalog Kefir.xlsx" (sheet Tim Sales) — kolom Terendah (= bottom),
     Jual (= harga normal), 3x/6x satuan & paket. Angka di sheet dalam RIBU rupiah.
  2. Memo promo marketing di Google Drive (folder "Promo"):
       - 09.002/MKT/IX/2026  September Glow Up        1–30 Sep 2026
       - 09.003/MKT/IX/2026  Festival Glow Up Sept.  23–30 Sep 2026
     Tabel memo berupa gambar di Google Doc, jadi angkanya disalin manual ke
     CAMPAIGNS di bawah. Kolom BV (modal) dan profit di memo sengaja TIDAK disalin.

Pemakaian:
  python3 scripts/build_price_master.py "/path/Harga Katalog Kefir.xlsx"

Skrip ini hanya untuk pengisian awal katalog dasar. Halaman "Harga Promo & Bottom"
sekarang hanya baca: harga normal, bottom, dan promo bulan berjalan dibaca dari
spreadsheet Planning marketing (price_sheet_sync.js, daftar sumber di
data/price_sheet_sources.json). Skrip menolak jalan kalau file sudah ada,
kecuali diberi --force.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'price_master.json')
PRODUCTS = os.path.join(ROOT, 'data', 'neosoft_db', 'products.json')
DRIVE_FOLDER = 'https://drive.google.com/drive/folders/1k4X_PntOcmvD3VBaUNPh1q-0JRB955sT?usp=sharing'
SEPT_DOC = 'https://docs.google.com/document/d/1rho1X8BN-R66jBhYpakom6Ap0GbLD4D66vO9MoV3ENY'

# ── Pencocokan nama katalog -> produk Neosoft ───────────────────────────────
# Katalog memakai istilah Indonesia, Neosoft sebagian istilah Inggris.
SYNONYMS = [
    (r'\bketiak\b', 'underarm'), (r'\bbokong\b', 'buttock'), (r'\bpipi\b', 'cheek'),
    (r'\bui\b', 'unit'), (r'\bspot\b', 'spot'), (r'\bsubcission\b', 'subcision'),
    (r'\bapaptosis\b', 'apoptosis'), (r'\bdoube\b', 'double'),
]
STOP = {'kefir', 'facial', 'skin', 'booster', 'the', 'and', 'dan', 'x', 'syringe', 'cc', 'laser',
        'treatment', '1', '2', '1/2'}

# Pemetaan yang tidak bisa ditebak dari kemiripan nama. Kunci = nama katalog (lowercase),
# nilai = kode produk Neosoft, atau None bila memang tidak ada padanannya di Neosoft.
MANUAL = {
    'kefir skin analyzer pro': 'T-26050081',
    'kefir phyto derma': 'T-26050019',
    'kefir 14 in 1 crystal dew': 'T-26050017',
    'kefir 14 in 1 acne renewal': 'T-26050016',
    'acne injection / spot': 'T-26050084',
    'gua sha glow lift': 'T-26090007',
    'pico black doll': 'T-26050161',
    'dna salmon glowbooster (2cc)': 'T-26050112',
    'white mochi (2cc)': 'T-26050110',
    'exosome (2cc)': 'T-26050113',
    'hair growth booster (2cc)': 'T-26050057',
    'acne clarity booster (2cc)': 'T-26050111',
    'nctf full face (2cc)': 'T-26050102',
    'nctf - pink lips (1 cc)': 'T-26050104',
    'nctf - bright undereye (2cc)': 'T-26050103',
    'pluryal shine (2cc)': 'T-26050107',
    'pluryal radiance (2cc)': 'T-26050105',
    'pluryal acne (2cc)': 'T-26050106',
    'evehilo skin booster half face (1/2 syringe)': 'T-26050099',
    'evehilo skin booster full face (1 syringe)': 'T-26050093',
    'vitaran polybooster half face (1/2 syringe)': 'T-26050101',
    'vitaran polybooster full face (1 syringe)': 'T-26050095',
    'vitaran pn half face (1/2 syringe)': 'T-26050100',
    'vitaran pn full face (1 syringe)': 'T-26050094',
    'rejuran healer half face (1/2 syringe)': 'T-26050097',
    'rejuran healer full face (1 syringe)': 'T-26050089',
    'rejuran hb half face (1/2 syringe)': 'T-26050098',
    'rejuran hb full face (1 syringe)': 'T-26050092',
    'luwen collstim / cc': 'T-26050116',
    'juvelook / cc': 'T-26050117',
    'juvelook half face (3cc)': 'T-26050115',
    'juvelook full face (6cc)': 'T-26050114',
    'nucleofill half face (1/2 syringe)': 'T-26050096',
    'nucleofill full face (1 syringe)': 'T-26050090',
    'profhilo half face (1/2 syringe)': 'T-26050091',
    'profhilo full face (1 syringe)': 'T-26050088',
    'meso intralipo v-line (2cc)': 'T-26050128',
    'meso intralipo pipi (3cc)': 'T-26050127',
    'meso lipo perut/ bra line / pinggang (10 cc)': 'T-26050131',
    'meso lipo perut / paha (20cc)': 'T-26070004',
    'fat apaptosis v-line (5 cc)': 'T-26050124',
    'fat apaptosis pipi (10cc)': 'T-26050125',
    'fat apaptosis paha / perut (20 cc)': 'T-26050126',
    'korean botox / 50 ui': 'T-26050121',
    'korean botox / 100 ui': 'T-26050120',
    'allergan botox / 50 ui': 'T-26050119',
    'allergan botox/ 100 ui': 'T-26050118',
    'allergan botox / ui': 'T-26050157',
    'add on botox / ui': 'T-26050156',
    'miss v glow peel': 'T-26050078',
    'glow peel bokong': 'T-26050073',
    'pink secret miss v': 'T-26050136',
    'pink secret lips': 'T-26050137',
    'pink secret nipple': 'T-26050138',
    'bright secret lutut': 'T-26050135',
    'bright secret siku': 'T-26050134',
    'filler dagu / hidung': 'T-26070005',
    'threadlift hidung (6 benang)': 'T-26050140',
    'threadllift pipi (10 benang)': 'T-26050139',
    'threadlift v-line (4 benang)': 'T-26050141',
    'foxy eyes threadlift (4 benang)': 'T-26050142',
    'cat eyes threadlift (2 benang)': 'T-26050143',
    'and on cog threadlift / benang': 'T-26050145',
    'hifu v-line': 'T-26070003',
    'cool plus lite 1 handle': 'T-26050055',
    'cool plus complete 1 handle': 'T-26050054',
    'subcission': 'T-26050051',
    'prp face': 'T-26050049',
    'prp hair': 'T-26050056',
    'ipl hair removal bokong': 'T-26050045',
    'ipl hair removal ketiak': 'T-26050041',
    'ipl hair removal tangan / kaki': None,   # Neosoft memecah Upper/Lower
    'ipl bright and rejuve bokong': 'T-26050044',
    'ipl bright and rejuve ketiak': 'T-26050038',
    'ipl bright & rejuve brazilian': 'T-26050042',
    'ipl bright and rejuve tangan / kaki': None,
    'ipl anti jerawat punggung': 'T-26050034',
    'ipl anti acne wajah': 'T-26050036',
    'kefir melasma peel': 'T-26050076',
    'kefir acne clear peel': 'T-26050074',
    'body glow peel tangan': 'T-26050072',
    'glow peel ketiak': 'T-26050080',
    'glow peel leher': 'T-26050079',
    'glow peel kaki': 'T-26050070',
    'keloid injection / cc': 'T-26050066',
    'vit c injection': 'T-26050153',
    'rf v-line': 'T-26050029',
    'rf pipi': 'T-26050030',
    'rf perut / paha / lengan': 'T-26050031',
    'dna salmon cell activator': 'T-26050109',
}

# ── Campaign dari memo marketing (angka dalam rupiah penuh) ─────────────────
def _items(rows):
    return [{'name': n, 'normal': a, 'promo': b, 'benefit': c} for (n, a, b, c) in rows]

SEPT_SINGLE = [
    ('Kefir Glow Peel', 295000, 249000, ''), ('Kefir DNA Salmon Facial', 380000, 349000, ''),
    ('IPL Bright & Rejuve Wajah', 450000, 249000, ''), ('Pico Face Laser', 400000, 299000, ''),
    ('Pico Black Doll', 445000, 399000, ''), ('Instant Hollywood Glow', 550000, 449000, ''),
    ('Kefir 14 in 1 Crystal Dew', 300000, 249000, ''), ('Kefir Microdermabrasion', 165000, 119000, ''),
    ('RF Undereye', 199000, 129000, ''), ('RF Pipi', 245000, 149000, ''), ('RF V-Line', 245000, 149000, ''),
    ('Kefir 14 in 1 Acne Renewal', 325000, 289000, ''), ('Kefir Acne Clear Peel', 299000, 199000, ''),
    ('IPL Anti Acne Wajah', 450000, 249000, ''), ('PRP Face', 850000, 729000, ''),
    ('Subcission', 650000, 499000, ''), ('CO2 Laser', 550000, 429000, ''),
    ('HIFU V-Line', 649000, 499000, ''), ('HIFU Face', 699000, 579000, ''),
    ('Meso Intralipo V-Line (2cc)', 585000, 549000, ''),
    ('RF Perut / Paha / Lengan', 399000, 249000, ''),
    ('Meso Lipo Perut/ Bra Line / Pinggang (10 cc)', 755000, 599000, ''),
    ('Meso Lipo Perut / Paha (20cc)', 1340000, 999000, ''),
    ('Cool Plus Lite 1 Handle', 749000, 629000, ''), ('Cool Plus Complete 1 Handle', 1800000, 1499000, ''),
    ('Keloid Injection / cc', 299000, 199000, ''),
    ('IPL Hair Removal Ketiak', 400000, 199000, ''), ('IPL Bright and Rejuve Ketiak', 400000, 199000, ''),
    ('IPL Hair Removal Brazilian', 500000, 399000, ''), ('IPL Bright & Rejuve Brazilian', 500000, 399000, ''),
    ('IPL Hair Removal Bokong', 400000, 349000, ''), ('IPL Bright and Rejuve Bokong', 400000, 349000, ''),
    ('IPL Hair Removal Tangan / Kaki', 750000, 499000, ''),
    ('PRP Hair', 850000, 749000, ''), ('Hair Growth Booster (2cc)', 1035000, 799000, ''),
    ('DNA Salmon Cell Activator', 1870000, 1700000, 'Free Kefir Microdermabrasion'),
    ('DNA Salmon Glowbooster (2cc)', 1314500, 1195000, 'Free Kefir Microdermabrasion'),
    ('Exosome (2cc)', 1901900, 1729000, 'Free Kefir Microdermabrasion'),
    ('White Mochi (2cc)', 1901900, 1729000, 'Free Kefir Microdermabrasion'),
    ('Acne Clarity Booster (2cc)', 1417900, 1289000, 'Free Kefir Microdermabrasion'),
    ('Juvelook Full Face (6cc)', 8138900, 7399000, 'Free Pico Face Laser'),
    ('Nucleofill Full Face (1 syringe)', 6520800, 5928000, 'Free Pico Face Laser'),
    ('Rejuran Healer Full Face (1 syringe)', 6818900, 6199000, 'Free Pico Face Laser'),
    ('Rejuran HB Full Face (1 syringe)', 6048900, 5499000, 'Free Pico Face Laser'),
    ('Profhilo Full Face (1 syringe)', 9625000, 8750000, 'Free Pico Face Laser'),
    ('Vitaran PN Full Face (1 syringe)', 5498900, 4999000, 'Free Pico Face Laser'),
    ('Allergan Botox/ 100 ui', 7500000, 6999000, ''), ('Allergan Botox Ketiak', 7300000, 6999000, ''),
    ('Korean Botox / 50 ui', 2100000, 1699000, ''), ('Korean Botox / 100 ui', 3600000, 2999000, ''),
    ('Korean Botox Ketiak', 2655000, 2090000, ''),
]

# (nama paket, isi, normal, promo September, promo Festival)
BUNDLES = [
    ('Ultimate Glow', ['Kefir DNA Salmon Facial', 'IPL Bright & Rejuve Wajah', 'Kefir Glow Peel'], 1125000, 699000, 649000),
    ('Hollywood Glow', ['Instant Hollywood Glow', 'Pico Face Laser'], 950000, 749000, 699000),
    ('Instant Glow Booster', ['Kefir DNA Salmon Facial', 'Pico Face Laser', 'RF Undereye'], 979000, 799000, 749000),
    ('Glass Skin Glow', ['Kefir 14 in 1 Crystal Dew', 'Pico Black Doll'], 745000, 549000, 499000),
    ('Acne Clear Plus', ['Kefir 14 in 1 Acne Renewal', 'IPL Anti Acne Wajah', 'Acne Injection / Spot 2 titik'], 895000, 549000, 499000),
    ('Acne Recovery Glow', ['Kefir 14 in 1 Acne Renewal', 'Kefir Acne Clear Peel', 'IPL Anti Acne Wajah'], 1074000, 699000, 649000),
    ('Acne Clear Boost', ['Kefir 14 in 1 Acne Renewal', 'Peeling Acne Kefir', 'Acne Injection / Spot 2 titik'], 895000, 549000, 499000),
    ('Body Slim Starter', ['RF Perut / Paha / Lengan', 'Meso Lipo Perut/ Bra Line / Pinggang (10 cc)'], 1154000, 799000, 749000),
    ('Body Slim Advance', ['RF Perut / Paha / Lengan', 'Fat Apaptosis Paha / Perut (20 cc)'], 7579000, 6949000, 6849000),
    ('V-Line Contour Starter', ['HIFU V-Line', 'Meso Intralipo V-Line (2cc)', 'RF Perut / Paha / Lengan'], 1633000, 1049000, 999000),
    ('V-Line Contour Advance', ['HIFU V-Line', 'Fat Apaptosis V-Line (5 cc)', 'RF Perut / Paha / Lengan'], 3043000, 2099000, 1999000),
    ('Kefir Premium Hair Renewal', ['Hair Growth Booster (2cc)', 'PRP Hair', 'PDT Hair'], 1960000, 1399000, 1299000),
    ('Kefir Hair Renewal', ['PRP Hair', 'PDT Hair'], 925000, 649000, 599000),
    ('Underarm Perfect', ['IPL Hair Removal Ketiak', 'IPL Bright and Rejuve Ketiak'], 800000, 499000, 449000),
    ('Brazilian Perfect', ['IPL Hair Removal Brazilian', 'IPL Bright & Rejuve Brazilian'], 1000000, 649000, 599000),
    ('Ultimate Glowing Skin', ['DNA Salmon Cell Activator', 'Kefir Phyto Derma'], 1745000, 1700000, 1649000),
    ('Radiant Glow Booster', ['Exosome (2cc)', 'Kefir Phyto Derma'], 1770000, 1729000, 1699000),
    # Di memo, promo September (5.929.000) lebih MAHAL dari harga normal (5.928.000). Disalin
    # apa adanya dan ditandai supaya dicek marketing.
    ('Youthful Skin Booster', ['Nucleofill Full Face (1 syringe)', 'Kefir Phyto Derma'], 5928000, 5929000, 5890000),
    ('Dream Glass Skin', ['Juvelook Full Face (6cc)', 'Kefir Phyto Derma'], 7430000, 7399000, 7349000),
    ('Glowing Skin Renewal', ['NCTF Full Face (2cc)', 'Kefir Phyto Derma'], 2694000, 2649000, 2599000),
    ('Youthful Glow Booster', ['Rejuran Healer Full Face (1 syringe)', 'Kefir Phyto Derma'], 6206000, 6199000, 6099000),
    ('Premium Glass Skin', ['Vitaran PN Full Face (1 syringe)', 'Kefir Phyto Derma'], 5033000, 4999000, 4949000),
]
# Paket yang hanya ada di banner September (tidak ada di tabel memo)
SEPT_BANNER_BUNDLES = [
    ('Radiant Bright', ['IPL Bright & Rejuve Wajah', 'Kefir DNA Salmon Facial', 'Instant Hollywood Glow'], 1234000, 799000),
    ('Glow Booster', ['Pico Face Laser', 'Kefir DNA Salmon Facial', 'RF Undereye'], 1320000, 849000),
    ('Dewy Perfection', ['Kefir 14 in 1 Crystal Dew', 'Pico Black Doll', 'Kefir Glow Peel'], 1050000, 649000),
    ('Acne Reset', ['PRP Face', 'Kefir Acne Clear Peel', 'IPL Anti Acne Wajah'], 1177000, 749000),
]

FESTIVAL_SINGLE = [
    ('Kefir Glow Peel', 295000, 169000, ''), ('IPL Bright & Rejuve Wajah', 450000, 169000, ''),
    ('Pico Face Laser', 400000, 229000, ''), ('Pico Black Doll', 445000, 269000, ''),
    ('Kefir Microdermabrasion', 165000, 99000, ''), ('RF Undereye', 199000, 99000, ''),
    ('RF Pipi', 245000, 125000, ''), ('RF V-Line', 245000, 125000, ''),
    ('Kefir Acne Clear Peel', 299000, 169000, ''), ('IPL Anti Acne Wajah', 450000, 249000, ''),
    ('PRP Face', 850000, 469000, ''), ('HIFU V-Line', 649000, 369000, ''), ('HIFU Face', 699000, 399000, ''),
    ('RF Perut / Paha / Lengan', 399000, 229000, ''), ('Cool Plus Lite 1 Handle', 749000, 429000, ''),
    ('Cool Plus Complete 1 Handle', 1800000, 990000, ''), ('Keloid Injection / cc', 299000, 169000, ''),
    ('IPL Hair Removal Ketiak', 400000, 149000, ''), ('IPL Bright and Rejuve Ketiak', 400000, 149000, ''),
    ('IPL Hair Removal Brazilian', 500000, 199000, ''), ('IPL Bright & Rejuve Brazilian', 500000, 199000, ''),
    ('IPL Hair Removal Bokong', 400000, 199000, ''), ('IPL Bright and Rejuve Bokong', 400000, 199000, ''),
    ('IPL Hair Removal Tangan / Kaki', 750000, 429000, ''),
    ('PRP Hair', 850000, 469000, ''), ('Hair Growth Booster (2cc)', 1035000, 599000, ''),
    ('Allergan Botox/ 100 ui', 7500000, 6999000, ''), ('Allergan Botox Ketiak', 7300000, 6999000, ''),
    ('Korean Botox / 50 ui', 2100000, 1699000, ''), ('Korean Botox / 100 ui', 3600000, 2999000, ''),
    ('Korean Botox Ketiak', 2655000, 2090000, ''),
    # Skinbooster di memo Festival diskonnya 0% (harga promo = harga normal), jadi tidak dicatat sebagai promo.
]


def norm(s):
    s = str(s or '').lower().strip()
    s = re.sub(r'\s+', ' ', s)
    return s


def tokens(s):
    t = norm(s)
    for pat, rep in SYNONYMS:
        t = re.sub(pat, rep, t)
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    return {w for w in t.split() if w and w not in STOP}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    if os.path.exists(OUT) and not force:
        print(f'{OUT} sudah ada (mungkin sudah diedit di dashboard). Pakai --force untuk menimpa.')
        sys.exit(1)

    import openpyxl
    wb = openpyxl.load_workbook(args[0], data_only=True)
    ws = wb.worksheets[0]

    products = json.load(open(PRODUCTS))
    treatments = [p for p in products if not str(p.get('product_treatment_code') or '').startswith('P-')
                  and float(p.get('price') or 0) > 0]
    by_code = {p['product_treatment_code']: p for p in treatments}

    def match(name):
        key = norm(name)
        if key in MANUAL:
            code = MANUAL[key]
            return (by_code.get(code), 'manual') if code else (None, 'tidak_ada_di_neosoft')
        want = tokens(name)
        best, score = None, 0.0
        for p in treatments:
            have = tokens(p['product_treatment_name'])
            if not want or not have:
                continue
            j = len(want & have) / len(want | have)
            if j > score:
                best, score = p, j
        if best and score >= 0.6:
            return best, f'otomatis {score:.2f}'
        return None, f'tidak_cocok {score:.2f}'

    def k(v):
        return None if v in (None, '-', '') or not isinstance(v, (int, float)) else int(round(float(v) * 1000))

    items, seen = [], set()
    for r in ws.iter_rows(min_row=2, values_only=True):
        cat, menu = r[4], r[5]
        if not menu or not isinstance(r[7], (int, float)):
            continue
        name = re.sub(r'\s{2,}.*$', '', str(menu)).strip()   # buang sisa ketikan di ujung sel
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        prod, how = match(name)
        items.append({
            'key': re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
            'name': name,
            'category': str(cat or '').strip(),
            'product_id': prod['id'] if prod else None,
            'product_code': prod['product_treatment_code'] if prod else None,
            'product_name': prod['product_treatment_name'] if prod else None,
            'match': how,
            'list_price': k(r[7]),
            'bottom_price': k(r[6]),
            'pkg3_per_session': k(r[8]),
            'pkg6_per_session': k(r[9]),
            'pkg3_total': k(r[10]),
            'pkg6_total': k(r[11]),
            'note': str(r[12]).strip() if r[12] else ''
        })

    item_key = {norm(i['name']): i['key'] for i in items}

    def link(rows):
        out = []
        for row in rows:
            key = item_key.get(norm(row['name']))
            out.append({**row, 'item_key': key})
        return out

    campaigns = [
        {
            'id': 'sept-glow-up-2026',
            'name': 'September Glow Up',
            'memo_no': '09.002/MKT/IX/2026',
            'start': '2026-09-01', 'end': '2026-09-30',
            'offer': 'Disc up to 40%',
            'terms': 'Berlaku untuk pasien baru dan lama non-member. Tidak dapat digabung promo lain.',
            'source_url': SEPT_DOC,
            'items': link(_items(SEPT_SINGLE)),
            'bundles': [{'name': n, 'contents': c, 'normal': a, 'promo': b,
                         'note': 'Promo di memo lebih mahal dari harga normal — perlu dicek marketing.' if b > a else ''}
                        for (n, c, a, b, _) in BUNDLES]
                       + [{'name': n, 'contents': c, 'normal': a, 'promo': b, 'note': 'Hanya ada di banner, tidak ada di tabel memo.'}
                          for (n, c, a, b) in SEPT_BANNER_BUNDLES]
        },
        {
            'id': 'festival-glow-up-sept-2026',
            'name': 'Festival Glow Up September',
            'memo_no': '09.003/MKT/IX/2026',
            'start': '2026-09-23', 'end': '2026-09-30',
            'offer': 'Disc up to 60%',
            'terms': '',
            'source_url': SEPT_DOC,
            'items': link(_items(FESTIVAL_SINGLE)),
            'bundles': [{'name': n, 'contents': c, 'normal': a, 'promo': f, 'note': ''} for (n, c, a, _, f) in BUNDLES]
        }
    ]

    missing = [(c['name'], it['name']) for c in campaigns for it in c['items'] if not it['item_key']]
    data = {
        'version': 1,
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'updated_by': 'import awal (scripts/build_price_master.py)',
        'drive_folder_url': DRIVE_FOLDER,
        'currency_note': 'Semua harga dalam rupiah penuh.',
        'items': items,
        'campaigns': campaigns
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    linked = sum(1 for i in items if i['product_id'])
    print(f'{len(items)} item katalog, {linked} terhubung ke produk Neosoft, {len(items) - linked} belum.')
    for i in items:
        if not i['product_id']:
            print('  belum terhubung:', i['name'], '|', i['match'])
    auto = [i for i in items if str(i['match']).startswith('otomatis')]
    for i in auto:
        print('  otomatis:', i['name'], '->', i['product_name'], '|', i['match'])
    for c, n in missing:
        print('  item campaign tanpa pasangan katalog:', c, '|', n)
    print('Ditulis ke', OUT)


if __name__ == '__main__':
    main()
