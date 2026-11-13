#!/usr/bin/env python3
"""
Google Sheets Data Connector for Kefir Derma Clinic Dashboard
Syncs and parses:
1. Sheet 1: Operational & Asset Management (14-RwCXSCYlnQ6WF6WXXWi4DDxXIjDf18Q2fKEHkQ9M4)
2. Sheet 2: Cabang Depok (KDC) - Treatment, Skincare & Deposits (1As6Uc0w79OEBqFMsoDIvoJOlqGGbKmTe)
3. Sheet 3: Cabang Pondok Kopi (PDK) - Kasir, Transaksi & Medis (1Lk1IceSWWhhAwBy9CY3c7asP-NEqeaW4)
4. List BHP (Standar BHP per treatment, kategori treatment, isi kemasan) — ID dari env BHP_SHEET_ID.
   Uji / isi awal dari file lokal:  python3 scripts/sync_google_sheets.py --bhp-xlsx <file.xlsx>
"""

import os
import sys
import json
import datetime
import urllib.request
import tempfile
import re
import collections
import openpyxl

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data', 'google_sheets_db')
os.makedirs(DATA_DIR, exist_ok=True)

SHEET_CONFIGS = {
    'sheet1_ops': {
        'id': '14-RwCXSCYlnQ6WF6WXXWi4DDxXIjDf18Q2fKEHkQ9M4',
        'title': 'Operational & Asset Management',
        'description': 'Preventive Maintenance, Asset Inventaris, Daily Findings & Action Plans'
    },
    'sheet2_depok': {
        'id': '1As6Uc0w79OEBqFMsoDIvoJOlqGGbKmTe',
        'title': 'Cabang Depok (KDC) - Transaksi & Paket Deposit',
        'description': 'Treatment Breakdown, Paket Belum Digunakan, DP 50%, & Kasir Depok'
    },
    'sheet3_pondokkopi': {
        'id': '1Lk1IceSWWhhAwBy9CY3c7asP-NEqeaW4',
        'title': 'Cabang Pondok Kopi (PDK) - Kasir & Transaksi Medis',
        'description': 'Kasir Harian, Pasien WA, Metode Pembayaran EDC/QRIS/BCA/BRI, & Tim Medis'
    }
}

def is_note_name(v):
    """Isi kolom Nama Pasien yang sebenarnya catatan, bukan nama pasien baru — mis. "(BARU DP 50%)"
    di bawah invoice Margareth Tiroi (DP 50% Rp964.500 untuk invoice yang sama)."""
    s = str(v or '').strip()
    return s.startswith('(') or bool(re.search(r'\b(dp|baru|lunas|pelunasan|free|promo|sisa|keep)\b', s, re.I))


def clean_val(v):
    if v is None:
        return None
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, float):
        if v.is_integer():
            return int(v)
        return round(v, 2)
    s = str(v).strip()
    return s if s else None

def clean_num(v):
    """Pasangan numerik dari clean_val. Sudah dipakai di parse_depok_tx sejak
    lama tapi TIDAK PERNAH didefinisikan — bug laten yang baru meledak ketika
    sheet melebar sehingga baris mencapai kolom ke-8. Karena itu seluruh
    kolom nominal & metode pembayaran di sana selama ini tidak pernah terisi."""
    if v is None or v == '':
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r'[^\d,.\-]', '', str(v))
    if not s:
        return 0.0
    # Format Indonesia: titik = pemisah ribuan, koma = desimal
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return 0.0


def download_sheet(sheet_id, out_path):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (KefirClinicDashboard/1.0)'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        content = resp.read()
        with open(out_path, 'wb') as f:
            f.write(content)
    return len(content)

# ───────────── List BHP (sumber standar BHP, kategori treatment, isi kemasan) ─────────────
# Dashboard HANYA membaca spreadsheet ini; perubahan dilakukan di spreadsheet.
# Sheet "Treatment" : Code | Nama Item (Katalog) | ... | Kategori
# Sheet "List BHP"  : Nama Item (Treatment) | Kode Sistem | Nama di Sistem (Neosoft) | Qty | UoM
# Sheet "Isi Kemasan" (opsional): Kode Sistem | Nama | Satuan Stok | Isi per Kemasan | Satuan Pemakaian
BHP_UOM_MAP = {'mililiter': 'ml', 'milliliter': 'ml', 'pieces': 'pcs', 'piece': 'pcs', 'gr': 'gram'}


def _bhp_ws(wb, name):
    return next((ws for ws in wb.worksheets if ws.title.strip().lower() == name.lower()), None)


def _bhp_cols(ws, rules):
    """Cari baris judul (5 baris pertama) & kolom per kunci lewat regex judul."""
    for ri, row in enumerate(ws.iter_rows(min_row=1, max_row=5, values_only=True), start=1):
        heads = [str(c or '').strip().lower() for c in row]
        found = {}
        for key, pat in rules.items():
            idx = next((i for i, h in enumerate(heads) if h and re.search(pat, h)), None)
            if idx is not None:
                found[key] = idx
        if 'name' in found or 'item_code' in found:
            return ri, found
    return None, {}


def _bhp_txt(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''


def parse_bhp_list(wb):
    out = {'treatments': [], 'materials': [], 'pack_sizes': [], 'missing_sheets': []}
    ws = _bhp_ws(wb, 'Treatment')
    if ws is None:
        out['missing_sheets'].append('Treatment')
    else:
        hr, c = _bhp_cols(ws, {'code': r'^(code|kode)', 'name': r'^nama', 'category': r'kategori'})
        for ri, r in enumerate(ws.iter_rows(min_row=(hr or 1) + 1, values_only=True), start=(hr or 1) + 1):
            name = _bhp_txt(r[c['name']]) if 'name' in c and c['name'] < len(r) else ''
            if not name:
                continue
            out['treatments'].append({
                'row': ri, 'code': _bhp_txt(r[c['code']]).upper() if 'code' in c and c['code'] < len(r) else '',
                'name': name, 'category': _bhp_txt(r[c['category']]) if 'category' in c and c['category'] < len(r) else ''})
    ws = _bhp_ws(wb, 'List BHP')
    if ws is None:
        out['missing_sheets'].append('List BHP')
    else:
        hr, c = _bhp_cols(ws, {'name': r'treatment|^nama item', 'item_code': r'^kode', 'item_name': r'nama di sistem|^nama bahan',
                               'qty': r'^qty|^jumlah', 'uom': r'^uom|^satuan'})
        for ri, r in enumerate(ws.iter_rows(min_row=(hr or 1) + 1, values_only=True), start=(hr or 1) + 1):
            g = lambda k: r[c[k]] if k in c and c[k] < len(r) else None
            name, code = _bhp_txt(g('name')), _bhp_txt(g('item_code')).upper()
            if not name and not code:
                continue
            uom = _bhp_txt(g('uom')).lower()
            out['materials'].append({'row': ri, 'treatment_name': name, 'item_code': code, 'item_name': _bhp_txt(g('item_name')),
                                     'qty': clean_num(g('qty')), 'uom': BHP_UOM_MAP.get(uom, uom) or 'pcs'})
    ws = _bhp_ws(wb, 'Isi Kemasan')
    if ws is not None:
        hr, c = _bhp_cols(ws, {'item_code': r'^kode', 'item_name': r'^nama', 'per_pack': r'^isi', 'usage_uom': r'satuan pemakaian'})
        for ri, r in enumerate(ws.iter_rows(min_row=(hr or 1) + 1, values_only=True), start=(hr or 1) + 1):
            g = lambda k: r[c[k]] if k in c and c[k] < len(r) else None
            code, per = _bhp_txt(g('item_code')).upper(), clean_num(g('per_pack'))
            if not code or not (per > 0):
                continue      # baris tanpa isi = belum diisi Farmasi
            uom = _bhp_txt(g('usage_uom')).lower()
            out['pack_sizes'].append({'row': ri, 'item_code': code, 'item_name': _bhp_txt(g('item_name')),
                                      'per_pack': per, 'usage_uom': BHP_UOM_MAP.get(uom, uom) or 'unit'})
    out['synced_at'] = datetime.datetime.now().isoformat(timespec='seconds')
    return out


def write_bhp_list(wb, source):
    data = parse_bhp_list(wb)
    if data['missing_sheets'] and not data['treatments'] and not data['materials']:
        raise ValueError('sheet tidak ditemukan: ' + ', '.join(data['missing_sheets']))
    data['source'] = source
    _atomic_json(os.path.join(DATA_DIR, 'bhp_list.json'), data)
    return data


def parse_sheet1_ops(wb):
    res = {
        'action_plans': [],
        'to_do_list': [],
        'daily_findings': [],
        'preventive_maintenance': [],
        'assets_inventory': []
    }
    
    # 1. Action Plan
    if 'Action plan' in wb.sheetnames:
        ws = wb['Action plan']
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            for r in rows[1:]:
                if any(x is not None for x in r) and r[0]:
                    res['action_plans'].append({
                        'project': clean_val(r[0]),
                        'status': clean_val(r[1]) or 'Dalam proses',
                        'progress': clean_val(r[2]),
                        'deadline': clean_val(r[3]),
                        'notes': clean_val(r[4])
                    })

    # 2. To Do List
    if 'To do list' in wb.sheetnames:
        ws = wb['To do list']
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            for r in rows[1:]:
                if any(x is not None for x in r) and (r[1] or r[2]):
                    res['to_do_list'].append({
                        'week': clean_val(r[0]),
                        'task': clean_val(r[1]),
                        'item': clean_val(r[2]),
                        'status': clean_val(r[3]) or 'Pending'
                    })

    # 3. Daily Finding
    if 'Daily Finding' in wb.sheetnames:
        ws = wb['Daily Finding']
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            for r in rows[1:]:
                if any(x is not None for x in r) and (r[2] or r[0]):
                    if str(r[0]).strip().lower() in ['july', 'august', 'september', 'branch']:
                        continue
                    res['daily_findings'].append({
                        'branch': clean_val(r[0]) or 'Both',
                        'date_reported': clean_val(r[1]),
                        'finding_project': clean_val(r[2]),
                        'resolution': clean_val(r[3]),
                        'priority': clean_val(r[4]) or 'MEDIUM',
                        'status': clean_val(r[5]) or 'Pending',
                        'date_completed': clean_val(r[6])
                    })

    # 4. Preventive Maintenance
    # Kolom "Status" (idx 8) & "Notes" (idx 9) SUDAH ADA di sheet asli tapi
    # sebelumnya tidak pernah dibaca — "Notes" adalah tempat staf mencatat
    # kondisi terakhir alat (contoh isinya: "-", "DONE", catatan bebas).
    if 'Preventive maintenance' in wb.sheetnames:
        ws = wb['Preventive maintenance']
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            for r in rows[1:]:
                if any(x is not None for x in r) and r[0]:
                    res['preventive_maintenance'].append({
                        'asset_name': clean_val(r[0]),
                        'branch': clean_val(r[1]) or 'Depok',
                        'activity': clean_val(r[2]),
                        'last_maintenance': clean_val(r[3]),
                        'next_due': clean_val(r[4]),
                        'frequency': clean_val(r[5]),
                        'pic': clean_val(r[6]) or 'Operational',
                        'vendor': clean_val(r[7]) or 'Internal',
                        'status': clean_val(r[8]) if len(r) > 8 else None,
                        'condition_notes': clean_val(r[9]) if len(r) > 9 else None
                    })

    # 5. Asset Inventory
    # Kolom "Tanggal Beli"/"Purchase Date" BELUM ADA di sheet "Asset" saat ini
    # (dicek langsung: header row cuma No/Nama/Tipe-Merek/Qty/Jenis/Foto/Lokasi).
    # Dicari lewat NAMA header (bukan index tetap) supaya begitu tim
    # operasional menambahkan kolom itu di sheet manapun urutannya, langsung
    # kebaca otomatis tanpa perlu ubah kode lagi.
    if 'Asset' in wb.sheetnames:
        ws = wb['Asset']
        rows = list(ws.iter_rows(values_only=True))
        header_idx = -1
        for idx, r in enumerate(rows[:10]):
            if r and any('No' == str(x).strip() or 'Nama' in str(x) for x in r if x is not None):
                header_idx = idx
                break
        if header_idx != -1:
            header_row = rows[header_idx]
            purchase_date_col = None
            usage_col = None
            for cidx, h in enumerate(header_row):
                hname = str(h or '').strip().lower()
                if purchase_date_col is None and any(k in hname for k in ['tanggal beli', 'purchase date', 'tgl beli', 'tanggal pembelian']):
                    purchase_date_col = cidx
                if usage_col is None and any(k in hname for k in ['cara pakai', 'cara penggunaan', 'petunjuk pemakaian', 'usage']):
                    usage_col = cidx
            for r in rows[header_idx+1:]:
                if any(x is not None for x in r) and (r[1] or r[2]):
                    res['assets_inventory'].append({
                        'no': clean_val(r[0]),
                        'name': clean_val(r[1]),
                        'brand_type': clean_val(r[2]),
                        'qty': clean_val(r[3]) or 1,
                        'category': clean_val(r[4]) or 'Peralatan',
                        'location': clean_val(r[6]) or 'Klinik Depok',
                        'purchase_date': clean_val(r[purchase_date_col]) if purchase_date_col is not None and len(r) > purchase_date_col else None,
                        'usage_instructions': clean_val(r[usage_col]) if usage_col is not None and len(r) > usage_col else None
                    })

    return res


# Tab transaksi bulanan bernama "<BULAN> <TAHUN>" (mis. "OKTOBER 2026") diparse otomatis
# ke kunci recent_transactions_<abbr><yy> (aug26, sep26, oct26, ...) mulai Agustus 2026,
# supaya breakdown channel pembayaran tidak perlu diubah tiap bulan.
_MONTH_ABBR = {1: 'jan', 2: 'feb', 3: 'mar', 4: 'apr', 5: 'may', 6: 'jun', 7: 'jul', 8: 'aug',
               9: 'sep', 10: 'oct', 11: 'nov', 12: 'dec'}

def monthly_tx_tabs(sheetnames, min_period='2026-08'):
    """[(nama_tab, kunci_json)] untuk tab bulanan >= min_period, urut kronologis."""
    out = []
    for name in sheetnames:
        if not re.fullmatch(r'\s*[A-Za-z]+\s+20\d\d\s*', name):
            continue
        period = _period_from_tabname(name)
        if not period or period < min_period:
            continue
        y, m = period.split('-')
        out.append((period, name, f"recent_transactions_{_MONTH_ABBR[int(m)]}{y[2:]}"))
    return [(n, k) for _, n, k in sorted(out)]

def parse_sheet2_depok(wb):
    res = {
        'unused_packages_deposits': [],
        'treatment_categories': {},
        'recent_transactions_aug26': [],
        'recent_transactions_sep26': []
    }
    
    # 1. Parse Treatment Categories & Unused Packages (Facial, Microdermabrasi, Neocell, etc.)
    cat_sheets = ['Facial', 'Microdermabrasi', 'Neocell', 'Skin Rejuve', 'Body Peel Off', 'IPL', 'Inject Acne', 'Inject Keloid', 'Electrocauter', 'Laser Spectra', 'Dark Circle Eye', 'PDT']
    
    current_patient = None
    for sname in cat_sheets:
        if sname in wb.sheetnames:
            ws = wb[sname]
            rows = list(ws.iter_rows(values_only=True))
            category_items = []
            for r in rows:
                if not r or not any(x is not None for x in r):
                    continue
                val = str(r[0]).strip() if r[0] is not None else ''
                if not val or val == 'Row Labels' or val.startswith('Grand Total'):
                    continue
                
                # Check if this row is a patient or a treatment item
                is_treatment = any(kw in val.lower() for kw in ['dp 50%', 'facial', 'neocell', 'ipl', 'inject', 'laser', 'peel', 'belum digunakan', 'paket ke-', 'disc', 'flash sale', 'microdermabrasi', 'brightening'])
                
                if not is_treatment:
                    current_patient = val
                else:
                    item_desc = val
                    is_unused = 'belum digunakan' in val.lower() or 'sisa' in val.lower() or 'paket ke-' in val.lower() or 'dp 50%' in val.lower()
                    
                    record = {
                        'category': sname,
                        'patient_name': current_patient or 'Unknown',
                        'treatment': item_desc,
                        'is_unused_deposit': is_unused
                    }
                    category_items.append(record)
                    if is_unused and current_patient:
                        res['unused_packages_deposits'].append(record)
            
            res['treatment_categories'][sname] = {
                'total_records': len(category_items),
                'sample': category_items[:5]
            }

    # PENTING: satu invoice bisa punya banyak baris (satu per tindakan).
    # Hanya baris PERTAMA grup yang punya kode invoice terisi; baris
    # lanjutan mengosongkan kolom invoice. Kolom finansial (Nett/EDC/QRIS/
    # Transfer) sering tercatat di baris LANJUTAN, bukan baris pertama —
    # versi lama fungsi ini men-skip baris berkode invoice kosong lewat
    # "if not r[1]: continue", sehingga nilai itu tidak pernah terbaca
    # (diverifikasi: 2 dari 3 baris tiap invoice hilang, termasuk baris
    # yang membawa nilai Nett/QRIS). Diperbaiki dgn carry-forward kode
    # invoice ke baris lanjutan, lalu MENJUMLAHKAN kolom finansial per
    # grup invoice (bukan hanya mengambil satu baris).
    NUM_FIELDS_DPK = ['gross_amount', 'discount', 'net_price', 'nett',
                       'edc_bri', 'edc_bni', 'qris', 'transfer_bni', 'transfer_bri', 'transfer_bca']

    def parse_depok_tx(ws):
        groups = {}
        order = []
        current_inv = None
        current_name = None
        for r in ws.iter_rows(values_only=True):
            if not r or len(r) < 5: continue
            inv = clean_val(r[1])
            name = clean_val(r[4])
            if inv and 'KDC' in str(inv):
                current_inv = inv
                current_name = name
            elif name and current_inv and not is_note_name(name) and str(name).strip().lower() != str(current_name or '').strip().lower():
                # Pasien lain tanpa kode invoice (mis. pemakaian paket) BUKAN bagian invoice di atasnya.
                # Contoh: KDC-I-202609-0014 Abdul Rahman Rp265.000 dulu ikut menelan baris aquarita
                # murba & Isabella Riandani (pemakaian, tanpa kode). Pembayarannya (bila ada) tetap
                # dihitung sebagai uang masuk, tetapi di grup sendiri "TANPA KODE: <nama>".
                current_inv = f'TANPA KODE: {name}'
                current_name = name
            if not current_inv:
                continue
            treatment = clean_val(r[5]) if len(r) > 5 else None
            # Sel angka di kolom Tindakan = sel ringkasan/pivot, bukan tindakan: lewati
            if isinstance(treatment, (int, float)):
                continue
            # Hanya baris dengan kolom Tindakan terisi yang dianggap baris
            # transaksi asli. Tanpa penjaga ini, area pivot/ringkasan lain
            # di sheet yang sama (mis. tabel rekap bulanan yg ditaruh di
            # baris jauh di bawah, tanpa kode invoice baru utk mereset
            # current_inv) ikut tersedot ke invoice terakhir yang aktif —
            # ditemukan langsung: 1 invoice sempat menyerap Rp78 juta dari
            # sel-sel pivot table yang sama sekali tidak terkait.
            if not treatment:
                continue

            g = groups.get(current_inv)
            if g is None:
                g = {
                    'date': clean_val(r[0]), 'invoice': current_inv,
                    'rm_status': clean_val(r[2]), 'has_photo': clean_val(r[3]),
                    'patient_name': clean_val(r[4]),
                    'status_patient': clean_val(r[6]) if len(r) > 6 else None,
                    'category': clean_val(r[10]) if len(r) > 10 else None,
                    'doctor': clean_val(r[27]) if len(r) > 27 else None,
                    'nurse': clean_val(r[28]) if len(r) > 28 else None,
                    'therapist': clean_val(r[29]) if len(r) > 29 else None,
                    'fo': clean_val(r[30]) if len(r) > 30 else None,
                    'treatments': [],
                }
                for f in NUM_FIELDS_DPK:
                    g[f] = 0.0
                groups[current_inv] = g
                order.append(current_inv)

            if treatment:
                g['treatments'].append(treatment)
            g['gross_amount'] += clean_num(r[7]) if len(r) > 7 else 0.0
            g['discount'] += clean_num(r[8]) if len(r) > 8 else 0.0
            g['net_price'] += clean_num(r[9]) if len(r) > 9 else 0.0
            g['nett'] += clean_num(r[14]) if len(r) > 14 else 0.0
            g['edc_bri'] += clean_num(r[16]) if len(r) > 16 else 0.0
            g['edc_bni'] += clean_num(r[17]) if len(r) > 17 else 0.0
            g['qris'] += clean_num(r[18]) if len(r) > 18 else 0.0
            g['transfer_bni'] += clean_num(r[19]) if len(r) > 19 else 0.0
            g['transfer_bri'] += clean_num(r[20]) if len(r) > 20 else 0.0
            g['transfer_bca'] += clean_num(r[21]) if len(r) > 21 else 0.0
            # Field tunggal: isi hanya jika baris ini membawanya & grup belum punya
            for key, idx in (('doctor', 27), ('nurse', 28), ('therapist', 29), ('fo', 30)):
                if not g.get(key) and len(r) > idx:
                    v = clean_val(r[idx])
                    if v: g[key] = v

        items = []
        for inv in order:
            g = groups[inv]
            treatments = g.pop('treatments')
            g['treatment'] = ', '.join(str(t) for t in treatments) if treatments else None
            items.append(g)
        return items

    # 2. Parse transaksi bulanan (Agustus 2026 dst., otomatis tab bulan baru)
    for tab, key in monthly_tx_tabs(wb.sheetnames):
        res[key] = parse_depok_tx(wb[tab])

    return res

def parse_sheet3_pondokkopi(wb):
    res = {
        'recent_transactions_aug26': [],
        'recent_transactions_sep26': []
    }

    # Sama seperti parse_depok_tx: satu invoice = banyak baris, kolom
    # finansial sering tercatat di baris lanjutan yang kode invoice-nya
    # kosong. Carry-forward + jumlahkan per grup invoice.
    NUM_FIELDS_PDK = ['gross_amount', 'discount', 'net_price', 'nett', 'edc_bni', 'qris',
                       'transfer_bri', 'transfer_bni', 'cash', 'voucher', 'fasilitas_karyawan']

    def parse_tx_sheet(sname):
        if sname not in wb.sheetnames:
            return []
        ws = wb[sname]
        groups = {}
        order = []
        current_inv = None
        current_name = None
        for r in ws.iter_rows(values_only=True):
            if not r or len(r) < 5: continue
            inv = clean_val(r[1])
            name = clean_val(r[2])
            if inv and ('PDK' in str(inv) or 'faktur' in str(inv).lower() or str(inv).isdigit()):
                current_inv = inv
                current_name = name
            elif name and current_inv and not is_note_name(name) and str(name).strip().lower() != str(current_name or '').strip().lower():
                current_inv = f'TANPA KODE: {name}'   # pasien lain tanpa kode invoice: grup sendiri
                current_name = name
            if not current_inv or not any(x is not None for x in r):
                continue

            treatment = clean_val(r[4]) if len(r) > 4 else None
            if isinstance(treatment, (int, float)):
                continue
            # Sama seperti versi Depok: hanya baris berkolom Tindakan
            # terisi yang dianggap baris transaksi asli — mencegah area
            # pivot/ringkasan lain di sheet yang sama tersedot ke invoice
            # terakhir yang masih aktif.
            if not treatment:
                continue
            g = groups.get(current_inv)
            if g is None:
                phone = clean_val(r[3])
                if phone: phone = str(phone).replace('.0', '')
                g = {
                    'date': clean_val(r[0]), 'invoice': current_inv,
                    'patient_name': clean_val(r[2]), 'phone': phone,
                    'status_patient': clean_val(r[6]) if len(r) > 6 else None,
                    'purchase_status': clean_val(r[7]) if len(r) > 7 else None,
                    'category': clean_val(r[11]) if len(r) > 11 else None,
                    'doctor': clean_val(r[30]) if len(r) > 30 else None,
                    'nurse': clean_val(r[31]) if len(r) > 31 else None,
                    'therapist': clean_val(r[32]) if len(r) > 32 else None,
                    'qty': 0.0, 'treatments': [],
                }
                for f in NUM_FIELDS_PDK:
                    g[f] = 0.0
                groups[current_inv] = g
                order.append(current_inv)

            if treatment:
                g['treatments'].append(treatment)
            g['qty'] += clean_num(r[5]) if len(r) > 5 else 0.0
            g['gross_amount'] += clean_num(r[8]) if len(r) > 8 else 0.0
            g['discount'] += clean_num(r[9]) if len(r) > 9 else 0.0
            g['net_price'] += clean_num(r[10]) if len(r) > 10 else 0.0
            g['nett'] += clean_num(r[15]) if len(r) > 15 else 0.0
            g['edc_bni'] += clean_num(r[22]) if len(r) > 22 else 0.0
            g['qris'] += clean_num(r[23]) if len(r) > 23 else 0.0
            g['transfer_bri'] += clean_num(r[24]) if len(r) > 24 else 0.0
            g['transfer_bni'] += clean_num(r[25]) if len(r) > 25 else 0.0
            g['cash'] += clean_num(r[26]) if len(r) > 26 else 0.0
            g['voucher'] += clean_num(r[27]) if len(r) > 27 else 0.0
            g['fasilitas_karyawan'] += clean_num(r[29]) if len(r) > 29 else 0.0
            for key, idx in (('doctor', 30), ('nurse', 31), ('therapist', 32)):
                if not g.get(key) and len(r) > idx:
                    v = clean_val(r[idx])
                    if v: g[key] = v

        tx_list = []
        for inv in order:
            g = groups[inv]
            treatments = g.pop('treatments')
            g['treatment'] = ', '.join(str(t) for t in treatments) if treatments else None
            tx_list.append(g)
        return tx_list

    for tab, key in monthly_tx_tabs(wb.sheetnames):
        res[key] = parse_tx_sheet(tab)

    return res



# ═══════════════════════════════════════════════════════════════════════
# PARSER RIWAYAT PENUH (semua tab bulanan, November 2024 -> sekarang)
#
# Versi sebelumnya hanya membaca dua tab yang di-hardcode ('AGUSTUS 2026'
# dan 'SEPTEMBER 2026'), sehingga ~96% isi spreadsheet tidak pernah masuk
# sistem. Padahal data lokal Neosoft sendiri baru mulai Mei 2026, jadi
# tab-tab lama ini satu-satunya catatan ~18 bulan riwayat klinik.
#
# Ada 10 variasi tata letak header lintas periode (posisi baris header
# berbeda, urutan & penamaan kolom berbeda). Karena itu kolom dipetakan
# lewat NAMA header, bukan posisi — supaya tahan terhadap perubahan
# tata letak berikutnya.
# ═══════════════════════════════════════════════════════════════════════

CATEGORY_TABS = {'Facial', 'Microdermabrasi', 'Neocell', 'Skin Rejuve', 'Body Peel Off',
                 'IPL', 'Inject Acne', 'Inject Keloid', 'Electrocauter', 'Laser Spectra',
                 'Dark Circle Eye', 'PDT'}

COLUMN_ALIASES = {
    'date':            ['tanggal', 'tgl'],
    'invoice':         ['no kwitansi', 'no.invoice', 'no invoice', 'no.kwitansi'],
    'rm':              ['status rm'],
    'has_photo':       ['foto'],
    'patient_name':    ['nama pasien'],
    'phone':           ['no.tlpn', 'no tlpn', 'no.telp', 'no telp'],
    'treatment':       ['tindakan'],
    'qty':             ['qty'],
    'patient_status':  ['status pasien'],
    'purchase_status': ['status pembelian'],
    'price_before':    ['harga sebelum diskon'],
    'discount':        ['disc'],
    'price_after':     ['harga setelah diskon'],
    'category':        ['kategori'],
    # Nilai transaksi sebenarnya ada di TIGA kolom bucket ini, bukan di
    # 'Harga Setelah Diskon' (yang cuma terisi 0-2% di semua periode).
    'amt_aesthetic':   ['aesthetic'],
    'amt_hair':        ['hair'],
    'amt_produk':      ['produk'],
    'nett':            ['nett'],
    'paket':           ['paket'],
}

BULAN = {'januari': 1, 'februari': 2, 'maret': 3, 'april': 4, 'mei': 5, 'juni': 6,
         'juli': 7, 'agustus': 8, 'september': 9, 'oktober': 10, 'november': 11,
         'desember': 12, 'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7,
         'agu': 8, 'ags': 8, 'sep': 9, 'okt': 10, 'nov': 11, 'des': 12}


def _period_from_tabname(name):
    """Nama tab bisa berupa rentang ('26 Des 2024-25 Jan 2025') atau singkat
    ('Oktober 25'). Ambil bulan & tahun TERAKHIR yang disebut."""
    low = name.lower()
    years = [int(y) for y in re.findall(r'20(\d{2})\b', low)]
    if not years:
        years = [int(y) for y in re.findall(r'\b(\d{2})\b', low) if 20 <= int(y) <= 30]
    year = 2000 + years[-1] if years else None
    months = [BULAN[m] for m in re.findall(r'[a-z]+', low) if m in BULAN]
    month = months[-1] if months else None
    return f'{year:04d}-{month:02d}' if year and month else None


def _find_header(ws, max_scan=15):
    keys = ('nama pasien', 'tindakan', 'kwitansi', 'invoice')
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=max_scan, max_col=40, values_only=True), 1):
        cells = [str(c).strip().lower() if c is not None else '' for c in row]
        if sum(any(k in c for k in keys) for c in cells) >= 2:
            return i, cells
    return None, None


def _map_columns(header_cells):
    idx = {}
    for pos, cell in enumerate(header_cells):
        c = cell.strip().lower()
        if not c:
            continue
        for field, aliases in COLUMN_ALIASES.items():
            if field in idx:
                continue
            # "Tgl pemakaian / pembelian" (Pondok Kopi) berisi catatan bebas, BUKAN tanggal transaksi
            if field == 'date' and ('pemakaian' in c or 'pembelian' in c):
                continue
            if any(c == a or c.startswith(a) for a in aliases):
                idx[field] = pos
                break
    return idx


def _clean_code(v):
    """Sel numerik Excel terbaca sebagai float ('6959.0'). Rapikan jadi teks."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return re.sub(r'\.0$', '', s) or None


_NEO_CODE = re.compile(r'([A-Za-z]{3})-([A-Za-z])-(\d{6})-(\d{3,4})')
_OLD_CODE = re.compile(r'\b([AC]\d{9})\b')


def _clean_invoice(v):
    """Rapikan kode invoice tanpa mengubah sumbernya (spreadsheet tidak disentuh):
    - buang tanda tambahan: ': A250601006', 'C250605001 (B)', 'C250620003 -'
    - kode Neosoft 3 digit ('KDC-I-202606-005') -> 4 digit ('KDC-I-202606-0005'), huruf besar
    - beberapa kode dalam satu sel dipertahankan, dipisah spasi
    Selain pola di atas (angka kwitansi lama, 'Faktur 13617', dll.) dikembalikan seperti _clean_code."""
    s = _clean_code(v)
    if not s:
        return None
    neo = _NEO_CODE.findall(s)
    if neo:
        return ' '.join(f'{a.upper()}-{b.upper()}-{d}-{n.zfill(4)}' for a, b, d, n in neo)
    old = _OLD_CODE.findall(s.upper())
    if old:
        return ' '.join(old)
    return s


def _looks_like_invoice(v):
    s = str(v or '')
    return bool(_NEO_CODE.search(s) or _OLD_CODE.search(s.upper()))


def _num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r'[^\d,.\-]', '', str(v)).replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def _norm_date(v, period):
    """Sel tanggal bisa berupa datetime, angka hari telanjang, atau kosong.
    Angka hari digabungkan dengan bulan/tahun dari nama tab."""
    if isinstance(v, datetime.datetime):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date):
        return v.strftime('%Y-%m-%d')
    n = _num(v)
    if n is not None and period and 1 <= n <= 31:
        return f'{period}-{int(n):02d}'
    if isinstance(v, str):
        m = re.match(r'(\d{4})-(\d{2})-(\d{2})', v.strip())
        if m:
            return m.group(0)
    return None



def _date_in_tab(date_str, period):
    """Tanggal dianggap wajar bila jatuh di bulan tab atau bulan sebelumnya
    (tab lama Pondok Kopi memakai periode tgl 26 s/d 25 bulan berikutnya)."""
    if not period:
        return True
    y, m = int(period[:4]), int(period[5:7])
    prev = f'{y - 1:04d}-12' if m == 1 else f'{y:04d}-{m - 1:02d}'
    return date_str[:7] in (period, prev)

def parse_all_transaction_tabs(wb, branch, outlet_id):
    """Baca SEMUA tab bulanan jadi satu daftar baris item transaksi."""
    records, per_tab, skipped = [], {}, []
    column_fixes = []
    for name in wb.sheetnames:
        if name in CATEGORY_TABS:
            continue
        ws = wb[name]
        if (ws.max_row or 0) < 2:
            skipped.append({'tab': name, 'alasan': 'kosong'})
            continue
        hrow, hcells = _find_header(ws)
        if not hrow:
            skipped.append({'tab': name, 'alasan': 'header tidak dikenali'})
            continue
        idx = _map_columns(hcells)
        if 'treatment' not in idx:
            skipped.append({'tab': name, 'alasan': 'kolom Tindakan tidak ada'})
            continue
        # Judul kolom di beberapa tab tidak sesuai isinya (spreadsheet TIDAK diubah; pembaca yang
        # menyesuaikan): Pondok Kopi MEI & JUNI 2026 menaruh kode invoice di kolom berjudul "Status RM",
        # dan kolom tanggal MEI & JULI 2026 tidak berjudul. Kolom dikenali dari ISINYA.
        sample = list(ws.iter_rows(min_row=hrow + 1, max_row=hrow + 80, max_col=40, values_only=True))
        if 'invoice' not in idx:
            hits = collections.Counter()
            for row in sample:
                for ci, val in enumerate(row):
                    if ci != idx.get('treatment') and _looks_like_invoice(val):
                        hits[ci] += 1
            if hits:
                ci, n = hits.most_common(1)[0]
                if n >= 5:
                    for f in [f for f, pos in idx.items() if pos == ci]:
                        del idx[f]          # mis. "Status RM" yang ternyata berisi kode invoice
                    idx['invoice'] = ci
                    column_fixes.append({'tab': name, 'kolom': ci, 'judul': (hcells[ci] if hcells and ci < len(hcells) else ''), 'dibaca_sebagai': 'kode invoice'})
        if 'date' not in idx:
            for ci in range(40):
                if hcells and ci < len(hcells) and hcells[ci]:
                    continue                # hanya kolom TANPA judul
                n = sum(1 for row in sample if ci < len(row) and isinstance(row[ci], (datetime.date, datetime.datetime)))
                if n >= 3:
                    idx['date'] = ci
                    column_fixes.append({'tab': name, 'kolom': ci, 'judul': '', 'dibaca_sebagai': 'tanggal'})
                    break

        period = _period_from_tabname(name)
        get = lambda row, f: (row[idx[f]] if f in idx and idx[f] < len(row) else None)
        # Baris lanjutan (tindakan kedua, ketiga dst) mengosongkan kolom
        # invoice/nama/tanggal — nilainya diwarisi dari baris di atasnya.
        #
        # PENTING: warisan HARUS berhenti di batas transaksi. Tanpa reset,
        # nomor RM milik pasien berikutnya bocor ke baris pasien sebelumnya
        # (nomor RM satu pasien sempat menempel ke baris transaksi
        # pasien sebelumnya) — yang membuat pemetaan RM->pasien salah orang.
        CARRY_FIELDS = ('date', 'invoice', 'rm', 'patient_name', 'phone', 'patient_status')
        carry = {f: None for f in CARRY_FIELDS}
        # Kasir Pondok Kopi menulis tanggal SEKALI per hari (transaksi pertama hari itu); transaksi
        # berikutnya kosong. Dulu tanggal ikut direset di tiap transaksi baru sehingga hanya 66 dari 484
        # baris September punya tanggal. Sekarang tanggal diteruskan sampai muncul tanggal baru.
        new_carry = lambda c: {f: (c.get('date') if f == 'date' else None) for f in CARRY_FIELDS}
        group_key = 'invoice' if 'invoice' in idx else 'patient_name'
        count = 0
        norm_name = lambda v: re.sub(r'[^a-z0-9]', '', str(v).lower()) if v not in (None, '', ' ') else ''
        # Kolom pembayaran (EDC/QRIS/Transfer/Cash/Deposit/CareNow/Voucher/...) — dipakai untuk
        # baris PEMAKAIAN yang membawa pembayaran sungguhan (pelunasan invoice lalu, bayar pakai deposit).
        pay_idx = [i for i, h in enumerate(hcells or []) if re.search(r'edc|qris|transfer|cash|deposit|carenow|\bkol\b|vouc|fasilitas|glow card|appoi', h or '')]
        tab_start = len(records)
        for row in ws.iter_rows(min_row=hrow + 1, max_col=40, values_only=True):
            marker = get(row, group_key)
            if marker not in (None, '', ' '):
                marker_val = _clean_invoice(marker) if group_key == 'invoice' else str(marker).strip()
                if marker_val and marker_val != carry[group_key]:
                    carry = new_carry(carry)   # transaksi baru (tanggal tetap diteruskan)
            # Nama pasien BERBEDA tanpa kode invoice baru = transaksi lain yang
            # tidak punya kode (mis. pemakaian paket). Dulu baris itu mewarisi
            # kode invoice pasien SEBELUMNYA, sehingga nilainya ikut menempel
            # (contoh nyata: KDC-I-202609-0014 Abdul Rahman Rp265.000 ikut
            # menelan 2 pasien lain -> terbaca Rp2.755.000, 12 grup di Depok).
            new_name = norm_name(get(row, 'patient_name'))
            if new_name and not is_note_name(get(row, 'patient_name')) and carry['patient_name'] is not None and new_name != norm_name(carry['patient_name']):
                carry = new_carry(carry)
            for f in CARRY_FIELDS:
                v = get(row, f)
                if v not in (None, '', ' '):
                    if f == 'date':
                        # Tanggal yang tidak terbaca (#VALUE!) atau di luar periode tab (salah ketik
                        # bulan, mis. 26-10-2026 di tab September) = tanggal tidak diketahui.
                        nd = _norm_date(v, period)
                        if not nd or not _date_in_tab(nd, period):
                            carry['date'] = None
                            continue
                    carry[f] = v
            treatment = get(row, 'treatment')
            if treatment in (None, '', ' '):
                continue
            treatment = str(treatment).strip()
            if not treatment or treatment.lower() in ('tindakan', 'total'):
                continue
            price_after = _num(get(row, 'price_after'))
            price_before = _num(get(row, 'price_before'))
            aes = _num(get(row, 'amt_aesthetic')) or 0
            hair = _num(get(row, 'amt_hair')) or 0
            produk = _num(get(row, 'amt_produk')) or 0
            bucket_total = aes + hair + produk
            # Urutan sumber nilai: bucket pendapatan -> harga setelah diskon
            # -> harga sebelum diskon.
            amount = bucket_total or price_after or price_before or None
            # "(PEMAKAIAN)" = pemakaian paket yang sudah dibayar sebelumnya, bukan penjualan baru
            # (kolom Nett di sheet-nya juga "-"); nilainya tidak boleh dihitung sebagai omset.
            # Kolom "Status Pembelian" bernilai PEMAKAIAN juga menandai pemakaian paket (35 baris
            # September 2026), walau tulisan tindakannya tidak memuat kata itu — contoh: Exosome Skin
            # Booster Eka Karlina 3 Sep, baris KEEP (beli Rp1,2jt) + baris PEMAKAIAN (Rp1,2jt) tadinya
            # terhitung Rp2,4jt padahal Neosoft hanya satu invoice Rp1,2jt.
            purchase_status_raw = str(get(row, 'purchase_status') or '')
            is_pemakaian = bool(re.search(r'pemakaian', treatment, re.I) or re.search(r'pemakaian', purchase_status_raw, re.I))
            if is_pemakaian:
                amount = None
            row_pay = sum((v for v in (_num(row[i]) if i < len(row) else None for i in pay_idx) if v), 0.0)
            revenue_type = ('Aesthetic' if aes else ('Produk' if produk else
                            ('Hair' if hair else ('Harga' if amount else None))))
            records.append({
                'branch': branch,
                'outlet_id': outlet_id,
                'source_tab': name,
                'period': period,
                'date': _norm_date(carry['date'], period),
                'invoice': _clean_invoice(carry['invoice']),
                'rm': _clean_code(carry['rm']),
                'patient_name': str(carry['patient_name']).strip() if carry['patient_name'] else None,
                'phone': re.sub(r'\D', '', str(carry['phone'])) if carry['phone'] else None,
                'treatment': treatment,
                'qty': _num(get(row, 'qty')) or 1,
                'patient_status': str(get(row, 'patient_status')).strip() if get(row, 'patient_status') else None,
                'purchase_status': str(get(row, 'purchase_status')).strip() if get(row, 'purchase_status') else None,
                'price_before': price_before,
                'price_after': price_after if price_after is not None else price_before,
                'discount': _num(get(row, 'discount')),
                'category': str(get(row, 'category')).strip() if get(row, 'category') else None,
                'amount': amount,
                'revenue_type': revenue_type,
                'amt_aesthetic': aes or None,
                'amt_hair': hair or None,
                'amt_produk': produk or None,
                'nett': _num(get(row, 'nett')),
                'paket': str(get(row, 'paket')).strip() if get(row, 'paket') else None,
                '_pem': is_pemakaian, '_pay': row_pay,
            })
            count += 1
        # Invoice yang SEMUA barisnya pemakaian: harga daftar tidak dihitung, tetapi pembayaran yang
        # benar-benar tercatat di baris itu dihitung (mis. Yenni Noviyanti PDK-I-202609-0164: Deposit
        # Rp1.655.000 + QRIS Rp45.000; Dhea Anindita PDK-I-202608-0163: Transfer Rp1.128.000).
        # Invoice campuran (ada baris pembelian) TIDAK disentuh: pembayaran di baris pemakaian di sana
        # biasanya total seluruh invoice, yang sudah terwakili oleh nilai baris pembelian.
        groups = {}
        for rec in records[tab_start:]:
            if rec['invoice']:
                groups.setdefault(rec['invoice'], []).append(rec)
        for recs_g in groups.values():
            if all(r['_pem'] for r in recs_g) and any(r['_pay'] for r in recs_g):
                for r in recs_g:
                    r['amount'] = r['_pay'] or None
                    r['revenue_type'] = 'Pembayaran (pemakaian)' if r['_pay'] else None
        for rec in records[tab_start:]:
            rec.pop('_pem', None); rec.pop('_pay', None)
        per_tab[name] = {'period': period, 'rows': count, 'header_row': hrow}
    if column_fixes:
        skipped.extend({'tab': c['tab'], 'catatan': f"tab tetap dibaca; kolom {c['kolom']} ('{c['judul']}') dikenali dari isinya sebagai {c['dibaca_sebagai']}"} for c in column_fixes)
    return records, per_tab, skipped


def _atomic_json(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp_', suffix='.json')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)


def _run_sheet(summary, key, label, filename, parser, step, history=None):
    """Jalankan satu sheet; kegagalan dicatat, tidak menjatuhkan sheet lain.
    `history` = (branch, outlet_id) untuk ikut menarik SELURUH tab bulanan."""
    print(f"\n[{step}/3] Fetching {label}...")
    try:
        path = os.path.join(DATA_DIR, f'{key}.xlsx')
        size = download_sheet(SHEET_CONFIGS[key]['id'], path)
        print(f"      Downloaded {size:,} bytes. Parsing sheets...")
        wb = openpyxl.load_workbook(path, data_only=True)
        data = parser(wb)
        out = os.path.join(DATA_DIR, filename)
        # Tulis atomik: tmp -> replace, supaya tidak pernah ada JSON terpotong
        fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix='.tmp_', suffix='.json')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, out)

        counts = {k: len(v) for k, v in data.items() if isinstance(v, list)}
        hist_info = {}
        if history:
            branch, outlet_id = history
            recs, per_tab, skipped = parse_all_transaction_tabs(wb, branch, outlet_id)
            summary.setdefault('_history', []).extend(recs)
            hist_info = {
                'history_rows': len(recs),
                'history_tabs': len(per_tab),
                'history_periods': sorted({v['period'] for v in per_tab.values() if v['period']}),
                'history_skipped': skipped
            }
            print(f"      Riwayat penuh: {len(recs):,} baris dari {len(per_tab)} tab bulanan")

        summary['sheets'][key] = dict(
            {'title': SHEET_CONFIGS[key]['title'], 'size_bytes': size, 'status': 'SUCCESS'},
            **{f'{k}_count': v for k, v in counts.items()}, **hist_info)
        print(f"      OK: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
        return True
    except Exception as e:
        msg = f"{e.__class__.__name__}: {e}"
        summary['sheets'][key] = {
            'title': SHEET_CONFIGS[key]['title'], 'status': 'FAILED', 'error': msg}
        summary['errors'].append(f"{key}: {msg}")
        print(f"      GAGAL: {msg}")
        return False


def main():
    print("=" * 60)
    print("  KEFIR DERMA CLINIC - GOOGLE SHEETS SYNC")
    print("=" * 60)

    timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # Status TIDAK lagi ditulis 'SUCCESS' di muka. Versi lama menetapkannya
    # sebagai konstanta, sehingga sync gagal tetap tampak sehat di dashboard.
    summary = {'last_synced_at': timestamp, 'status': 'PENDING',
               'sheets': {}, 'errors': []}

    jobs = [
        ('sheet1_ops', 'Sheet 1: Operational & Asset Management',
         'operational_assets.json', parse_sheet1_ops, None),
        ('sheet2_depok', 'Sheet 2: Cabang Depok (KDC)',
         'depok_transactions.json', parse_sheet2_depok, ('Depok', 1)),
        ('sheet3_pondokkopi', 'Sheet 3: Cabang Pondok Kopi (PDK)',
         'pondokkopi_transactions.json', parse_sheet3_pondokkopi, ('Pondok Kopi', 2)),
    ]
    results = [_run_sheet(summary, k, lbl, fn, pr, i + 1, hist)
               for i, (k, lbl, fn, pr, hist) in enumerate(jobs)]

    # Riwayat gabungan kedua cabang -> satu berkas
    history = summary.pop('_history', [])
    # Riwayat gabungan HANYA ditulis bila KEDUA cabang sukses; kalau satu gagal, file lama
    # dipertahankan (dulu satu cabang gagal membuat riwayat cabang itu hilang dari berkas).
    hist_ok = all(summary['sheets'].get(k, {}).get('status') == 'SUCCESS' for k in ('sheet2_depok', 'sheet3_pondokkopi'))
    if history and not hist_ok:
        print("\n  Riwayat gabungan TIDAK ditulis: ada cabang yang gagal, berkas lama dipertahankan.")
        summary['errors'].append('transactions_history: tidak ditulis karena ada cabang gagal (berkas lama dipertahankan)')
        history = []
    if history:
        history.sort(key=lambda r: (r.get('period') or '', r.get('date') or ''))
        _atomic_json(os.path.join(DATA_DIR, 'transactions_history.json'), history)
        periods = sorted({r['period'] for r in history if r.get('period')})
        summary['history'] = {
            'rows': len(history),
            'periods': len(periods),
            'from': periods[0] if periods else None,
            'to': periods[-1] if periods else None,
            'rows_with_amount': sum(1 for r in history if r.get('amount')),
            'total_amount': round(sum(r.get('amount') or 0 for r in history))
        }
        print(f"\n  Riwayat gabungan: {len(history):,} baris, "
              f"{summary['history']['periods']} bulan "
              f"({summary['history']['from']} s/d {summary['history']['to']})")

    # List BHP — terpisah dari status 3 sheet utama; belum dikonfigurasi bukan kegagalan.
    bhp_id = os.environ.get('BHP_SHEET_ID', '').strip()
    _m = re.search(r'/spreadsheets/d/([A-Za-z0-9_-]{20,})', bhp_id)   # boleh URL lengkap
    if _m:
        bhp_id = _m.group(1)
    if not bhp_id:
        summary['sheets']['sheet4_bhp'] = {'title': 'List BHP (Standar BHP)', 'status': 'NOT_CONFIGURED'}
        print("\n[BHP] List BHP: BHP_SHEET_ID belum diisi — dilewati (data lama dipertahankan).")
    else:
        try:
            path = os.path.join(DATA_DIR, 'sheet4_bhp.xlsx')
            size = download_sheet(bhp_id, path)
            d = write_bhp_list(openpyxl.load_workbook(path, data_only=True), 'google_sheets')
            summary['sheets']['sheet4_bhp'] = {'title': 'List BHP (Standar BHP)', 'size_bytes': size, 'status': 'SUCCESS',
                                               'treatments_count': len(d['treatments']), 'materials_count': len(d['materials']),
                                               'pack_sizes_count': len(d['pack_sizes'])}
            print(f"\n[BHP] List BHP OK: {len(d['treatments'])} treatment, {len(d['materials'])} baris BHP, {len(d['pack_sizes'])} isi kemasan")
        except Exception as e:
            msg = f"{e.__class__.__name__}: {e}"
            summary['sheets']['sheet4_bhp'] = {'title': 'List BHP (Standar BHP)', 'status': 'FAILED', 'error': msg}
            summary['errors'].append(f"sheet4_bhp: {msg}")
            print(f"\n[BHP] List BHP GAGAL (data lama dipertahankan): {msg}")

    ok = sum(results)
    summary['status'] = 'SUCCESS' if ok == len(jobs) else ('FAILED' if ok == 0 else 'PARTIAL')
    summary['sheets_ok'] = ok
    summary['sheets_total'] = len(jobs)

    with open(os.path.join(DATA_DIR, 'sync_summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 60)
    print(f"  STATUS: {summary['status']} ({ok}/{len(jobs)} sheet berhasil)")
    for e in summary['errors']:
        print(f"    ! {e}")
    print("=" * 60)
    return summary['status']


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--bhp-xlsx':
        d = write_bhp_list(openpyxl.load_workbook(sys.argv[2], data_only=True), 'local_xlsx:' + os.path.basename(sys.argv[2]))
        print(f"List BHP -> bhp_list.json: {len(d['treatments'])} treatment, {len(d['materials'])} baris BHP, {len(d['pack_sizes'])} isi kemasan")
        sys.exit(0)
    sys.exit(0 if main() == 'SUCCESS' else 1)
