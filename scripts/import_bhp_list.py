#!/usr/bin/env python3
"""Impor 'List BHP untuk RDL.xlsx' ke data/treatment_bom.json (basis data Standar BHP per Treatment).

Sheet 'Treatment ' : Code | Nama Item | Harga | Komisi Perawat | % Komisi Dokter
Sheet 'List BHP'   : Nama Item (Treatment) | Kode Sistem | Nama di Sistem | Qty | UoM

Aturan:
- BHP dipetakan ke treatment lewat NAMA item (kode treatment diambil dari sheet Treatment).
  Bila satu nama dipakai beberapa kode, daftar BHP yang sama dipasang di semua kode itu.
- Treatment tanpa kode di xlsx: kode dicari di data/neosoft_db/products.json lewat nama;
  bila belum ada di Neosoft diberi kode sementara 'BARU-<NAMA>' (ganti saat kode resminya terbit).
- Treatment yang ada di xlsx menggantikan standar lamanya; treatment lain tidak disentuh.
- File lama dicadangkan dulu ke data/treatment_bom.json.bak-<waktu>.
- Setelah itu standar bisa dikelola lewat Farmasi & Stok -> Standar BHP per Treatment.

Pakai:  python3 scripts/import_bhp_list.py <file.xlsx> [--dry-run] [--bom data/treatment_bom.json]
"""
import argparse, collections, datetime, json, os, re, shutil, sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UOM_MAP = {'mililiter': 'ml', 'pieces': 'pcs'}


def read_sheet(wb, name):
    ws = next((s for s in wb.worksheets if s.title.strip().lower() == name.strip().lower()), None)
    if ws is None:
        sys.exit(f"Sheet '{name}' tidak ditemukan. Sheet yang ada: {[s.title for s in wb.worksheets]}")
    return [r for r in ws.iter_rows(min_row=2, values_only=True) if any(c not in (None, '') for c in r)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--bom', default=os.path.join(ROOT, 'data', 'treatment_bom.json'))
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.xlsx, data_only=True, read_only=True)
    treatments = read_sheet(wb, 'Treatment')
    bhp_rows = read_sheet(wb, 'List BHP')

    neosoft_codes = {}
    try:
        for p in json.load(open(os.path.join(ROOT, 'data', 'neosoft_db', 'products.json'), encoding='utf-8')):
            if p.get('product_treatment_code') and p.get('product_treatment_name'):
                neosoft_codes.setdefault(p['product_treatment_name'].strip().lower(), p['product_treatment_code'])
    except (OSError, ValueError):
        pass

    codes_by_name = collections.defaultdict(list)
    provisional = []
    for r in treatments:
        if not r[1]:
            continue
        name = str(r[1]).strip()
        code = str(r[0]).strip() if r[0] else neosoft_codes.get(name.lower())
        if not code:
            code = 'BARU-' + re.sub(r'[^A-Z0-9]+', '-', name.upper()).strip('-')[:40]
            provisional.append((code, name))
        if code not in codes_by_name[name]:
            codes_by_name[name].append(code)

    lines_by_name = collections.OrderedDict()
    problems = []
    for i, r in enumerate(bhp_rows, start=2):
        name, code, pname, qty, uom = (r + (None,) * 5)[:5]
        name = str(name or '').strip()
        if not name or not code:
            problems.append(f"baris {i}: nama treatment/kode kosong")
            continue
        if name not in codes_by_name:
            problems.append(f"baris {i}: treatment '{name}' tidak ada di sheet Treatment")
            continue
        try:
            q = float(qty)
        except (TypeError, ValueError):
            problems.append(f"baris {i}: qty tidak valid ({qty!r}) untuk {name} / {code}")
            continue
        uom = str(uom or '').strip().lower()
        lines_by_name.setdefault(name, []).append({
            'item_code': str(code).strip(),
            'name': str(pname or '').strip(),
            'standard_qty': int(q) if q == int(q) else q,
            'uom': UOM_MAP.get(uom, uom or 'pcs'),
        })

    try:
        bom = json.load(open(a.bom, encoding='utf-8')) or []
    except FileNotFoundError:
        bom = []
    by_code = {b.get('treatment_code'): b for b in bom}
    next_n = 1 + max([int(b['id'][4:]) for b in bom if str(b.get('id', '')).startswith('BOM-') and b['id'][4:].isdigit()] or [0])
    now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')

    added = replaced = 0
    for name, lines in lines_by_name.items():
        for code in codes_by_name[name]:
            old = by_code.get(code)
            entry = {
                'id': old['id'] if old else f'BOM-{next_n:03d}',
                'treatment_code': code,
                'treatment_name': name,
                'version': 'Daftar BHP RDL',
                'is_promo_version': bool(old.get('is_promo_version')) if old else False,
                'materials': [dict(m) for m in lines],
                'standard_duration_minutes': (old or {}).get('standard_duration_minutes') or 60,
                'updated_at': now,
                'updated_by': 'Import List BHP RDL',
            }
            if old:
                bom[bom.index(old)] = entry
                replaced += 1
            else:
                bom.append(entry)
                next_n += 1
                added += 1
            by_code[code] = entry

    no_bhp = sorted(n for n in codes_by_name if n not in lines_by_name)
    print(f"Treatment di xlsx: {sum(len(v) for v in codes_by_name.values())} kode / {len(codes_by_name)} nama")
    print(f"Baris BHP dibaca : {len(bhp_rows)} (dilewati {len(problems)})")
    print(f"Standar baru     : {added} | menggantikan yang lama: {replaced} | total di file: {len(bom)}")
    print(f"Treatment tanpa BHP di xlsx: {len(no_bhp)}")
    if provisional:
        print(f"Kode sementara (belum ada di Neosoft): {len(provisional)}")
        for c, n in provisional:
            print(f"  ~ {c}  <- {n}")
    for p in problems:
        print('  ! ' + p)

    if a.dry_run:
        print('(dry-run: tidak ada file yang diubah)')
        return
    if os.path.exists(a.bom):
        bak = f"{a.bom}.bak-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(a.bom, bak)
        print('Cadangan:', bak)
    with open(a.bom, 'w', encoding='utf-8') as f:
        json.dump(bom, f, ensure_ascii=False, indent=2)
    print('Tersimpan:', a.bom)


if __name__ == '__main__':
    main()
