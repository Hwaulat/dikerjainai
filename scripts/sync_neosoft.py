#!/usr/bin/env python3
"""
Neosoft -> local JSON sync (READ-ONLY terhadap Neosoft).

Prinsip:
  1. Status yang dilaporkan HARUS mencerminkan kenyataan. Versi lama menulis
     "status": "success" sebagai konstanta, sehingga sync yang mati total
     terlihat persis sama dengan sync yang sehat.
  2. Record lama ikut diperbarui (upsert), bukan cuma ditambah. Tanpa ini,
     invoice yang di-void atau harga yang direvisi di Neosoft tidak pernah
     turun ke lokal.
  3. Tulis atomik: tmp -> os.replace. Proses yang mati di tengah tidak boleh
     meninggalkan file JSON terpotong.
"""
import os, sys, json, time, tempfile, traceback
import requests
from datetime import datetime, timezone, timedelta

LOCAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'neosoft_db')
PROFILE_DIR = os.path.expanduser('~/.hermes/profiles/hr/data/neosoft_db')
os.makedirs(LOCAL_DIR, exist_ok=True)
DB_DIR = LOCAL_DIR

def get_neosoft_token():
    candidates = [
        os.path.join(LOCAL_DIR, 'token.txt'),
        os.path.join(PROFILE_DIR, 'token.txt'),
        os.environ.get('NEOSOFT_TOKEN_FILE', '')
    ]
    for p in candidates:
        if p and os.path.exists(p):
            try:
                t = open(p).read().strip()
                if t: return t
            except Exception:
                pass
    return os.environ.get('NEOSOFT_TOKEN', '')

TOKEN = get_neosoft_token()
GATE = "L1V1GnoWuzBDrHadet3fgEbnftv3EL3nvY3qQcYdJk36SUG27ho="
BASE_URL = "https://api-registry-c1.cube.neosoft.id/api/v1"
LOCK_FILE = os.path.join(DB_DIR, '.sync.lock')
LOCK_STALE_SECONDS = 15 * 60

# Berapa halaman terakhir yang di-scan ulang tiap run untuk menangkap
# perubahan pada record yang sudah ada (void, revisi harga, koreksi data).
REFRESH_TAIL_PAGES = 3

WIB = timezone(timedelta(hours=7))

# Status reservasi berubah di Neosoft setelah dibuat (Booked -> Selesai). Versi lama hanya menarik
# ulang dari (tanggal terbaru - 2 hari), jadi reservasi yang statusnya diubah lebih dari 2 hari
# setelah tanggalnya tertinggal "Booked/Confirmed" selamanya di salinan lokal.
#   - tiap run  : tarik ulang APPT_TAIL_DAYS hari terakhir
#   - tiap APPT_DEEP_EVERY_HOURS jam : tarik ulang seluruh riwayat (maks. APPT_DEEP_DAYS hari)
APPT_TAIL_DAYS = 14
APPT_DEEP_DAYS = 180
APPT_DEEP_EVERY_HOURS = 6
APPT_STATE_FILE = 'appt_deep_refresh_state.json'   # *.json di folder ini sudah di-.gitignore

# Rem pengaman penyusutan hanya berlaku untuk file yang sudah cukup besar; feed kecil
# (mis. notifikasi appointment) wajar naik-turun dan tidak boleh memicu alarm palsu.
SHRINK_GUARD_MIN_ROWS = 50
REPORT = {"endpoints": {}, "errors": [], "pe_photos": None}


# ─────────────────────────── util ───────────────────────────

def atomic_write_json(path, data):
    """Tulis via file sementara lalu rename — tidak pernah menyisakan JSON rusak."""
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.tmp_', suffix='.json')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def acquire_lock():
    """Cegah dua run tumpang tindih menulis file yang sama."""
    if os.path.exists(LOCK_FILE):
        age = time.time() - os.path.getmtime(LOCK_FILE)
        if age < LOCK_STALE_SECONDS:
            print(f"Sync lain masih berjalan (lock umur {int(age)}s). Keluar.")
            return False
        print(f"Lock basi ({int(age)}s) — diambil alih.")
    with open(LOCK_FILE, 'w') as f:
        f.write(str(os.getpid()))
    return True


def release_lock():
    try:
        os.unlink(LOCK_FILE)
    except FileNotFoundError:
        pass


def headers():
    return {
        "Authorization": f"Bearer {TOKEN}",
        "x-clinic": GATE, "x-host": GATE,
        "x-origin": "https://kefirdermaclinic.neosoft.co.id",
        "x-path": "kefirdermaclinic",
        "x-time": str(int(time.time() * 1000)),
        "x-lang": "en", "x-tz": "+07:00",
        "Accept": "application/json",
    }


def api_get(path, params=None):
    """Kembalikan (ok, payload, error). Kegagalan TIDAK pernah disamarkan
    sebagai 'tidak ada data baru' seperti versi sebelumnya."""
    try:
        r = requests.get(f"{BASE_URL}{path}", params=params or {}, headers=headers(), timeout=30)
    except requests.RequestException as e:
        return False, None, f"jaringan: {e.__class__.__name__}: {e}"
    if r.status_code == 401:
        return False, None, "HTTP 401 — token ditolak Neosoft (session dicabut?)"
    if r.status_code == 404:
        return False, None, f"HTTP 404 — endpoint {path} tidak ada"
    if r.status_code >= 400:
        return False, None, f"HTTP {r.status_code}: {r.text[:200]}"
    try:
        return True, r.json(), None
    except ValueError:
        return False, None, f"balasan bukan JSON: {r.text[:200]}"


def api_post(path, payload=None, params=None):
    """Sama seperti api_get tapi POST — beberapa endpoint Neosoft (mis.
    /logistics/stock-card) menolak GET (405) dan mengharuskan filter
    (warehouse_id, start_date, end_date) dikirim lewat body JSON."""
    try:
        h = headers()
        h["Content-Type"] = "application/json"
        r = requests.post(f"{BASE_URL}{path}", json=payload or {}, params=params or {}, headers=h, timeout=30)
    except requests.RequestException as e:
        return False, None, f"jaringan: {e.__class__.__name__}: {e}"
    if r.status_code == 401:
        return False, None, "HTTP 401 — token ditolak Neosoft (session dicabut?)"
    if r.status_code == 404:
        return False, None, f"HTTP 404 — endpoint {path} tidak ada"
    if r.status_code >= 400:
        return False, None, f"HTTP {r.status_code}: {r.text[:200]}"
    try:
        return True, r.json(), None
    except ValueError:
        return False, None, f"balasan bukan JSON: {r.text[:200]}"


def load_local(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def record(name, ok, added=0, updated=0, error=None, skipped=False):
    REPORT["endpoints"][name] = {
        "ok": ok, "added": added, "updated": updated,
        "skipped": skipped, "error": error,
    }
    if error:
        REPORT["errors"].append(f"{name}: {error}")


# ───────────────────────── sync jobs ─────────────────────────

def sync_incremental_id(filename, endpoint, id_field='id'):
    """Ambil data paginated (urut ID ASC) lalu UPSERT.

    Beda dari versi lama: record yang sudah ada ikut diperbarui, dan beberapa
    halaman terakhir di-scan ulang supaya perubahan (mis. void_invoice)
    tertangkap. Sebelumnya `if id not in existing` membuat data lama membeku
    selamanya.
    """
    path = os.path.join(DB_DIR, filename)
    data = load_local(path)
    by_id = {it.get(id_field): it for it in data
             if isinstance(it, dict) and it.get(id_field) is not None}
    max_id = max(by_id.keys()) if by_id else 0

    start_page = max(1, (max_id // 100) - REFRESH_TAIL_PAGES) if max_id > 0 else 1
    print(f"Syncing {endpoint}... (max ID lokal: {max_id}, mulai halaman {start_page})")

    added = updated = 0
    page = start_page
    while True:
        ok, res, err = api_get(endpoint, {"limit": 100, "page": page})
        if not ok:
            record(filename, False, added, updated, err)
            print(f"  GAGAL: {err}")
            return
        page_data = (res or {}).get('data') or []
        if not isinstance(page_data, list) or not page_data:
            break
        for item in page_data:
            if not isinstance(item, dict):
                continue
            iid = item.get(id_field)
            if iid is None:
                continue
            if iid in by_id:
                if json.dumps(by_id[iid], sort_keys=True) != json.dumps(item, sort_keys=True):
                    by_id[iid] = item
                    updated += 1
            else:
                by_id[iid] = item
                added += 1
        if len(page_data) < 100:
            break
        page += 1
        time.sleep(0.2)

    if added or updated:
        ordered = [by_id[k] for k in sorted(by_id.keys(), key=lambda x: x if isinstance(x, int) else 0)]
        atomic_write_json(path, ordered)
        print(f"  + {added} baru, {updated} diperbarui -> {filename} (total {len(ordered)})")
    else:
        print(f"  Tidak ada perubahan untuk {filename}")
    record(filename, True, added, updated)


def sync_appointments():
    """Appointment pakai rentang tanggal, bukan ID berurutan."""
    path = os.path.join(DB_DIR, 'appointment_full.json')
    data = load_local(path)
    latest = max((a.get('come_date', '')[:10] for a in data if a.get('come_date')), default="2026-08-20")

    start_dt = datetime.strptime(latest, "%Y-%m-%d") - timedelta(days=2)
    # Segarkan status reservasi yang baru lewat: tarik ulang APPT_TAIL_DAYS hari terakhir.
    now_wib = datetime.now(WIB).replace(tzinfo=None)
    start_dt = min(start_dt, datetime.strptime(now_wib.strftime("%Y-%m-%d"), "%Y-%m-%d") - timedelta(days=APPT_TAIL_DAYS))
    # Penyegaran dalam berkala: seluruh riwayat, supaya status reservasi lama ikut turun.
    state_path = os.path.join(DB_DIR, APPT_STATE_FILE)
    deep = True
    try:
        with open(state_path) as f:
            deep = (time.time() - float(json.load(f).get('last_deep_at', 0))) > APPT_DEEP_EVERY_HOURS * 3600
    except Exception:
        deep = True
    if deep:
        first_local = min((a.get('come_date', '')[:10] for a in data if a.get('come_date')), default=None)
        deep_floor = (now_wib - timedelta(days=APPT_DEEP_DAYS)).strftime("%Y-%m-%d")
        deep_start = datetime.strptime(max(first_local, deep_floor) if first_local else deep_floor, "%Y-%m-%d")
        start_dt = min(start_dt, deep_start)
    # Backfill nama ruang (Lobby / Treatment Room …) untuk appointment lama yang
    # belum punya — maksimal 45 hari ke belakang.
    floor = (datetime.now(WIB) - timedelta(days=45)).strftime("%Y-%m-%d")
    no_room = [a.get('come_date', '')[:10] for a in data if a.get('come_date') and not a.get('room_name') and a.get('come_date', '')[:10] >= floor]
    if no_room:
        start_dt = min(start_dt, datetime.strptime(min(no_room), "%Y-%m-%d"))
    end_dt = (datetime.now(WIB) + timedelta(days=7)).replace(tzinfo=None)
    print(f"Syncing appointments {start_dt:%Y-%m-%d} .. {end_dt:%Y-%m-%d}{' (penyegaran dalam)' if deep else ''}...")

    new_appts = {}
    # Rentang dipotong 7 hari agar limit 500 per permintaan tidak memotong data
    cur = start_dt
    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=6), end_dt)
        for outlet in [1, 2]:
            ok, res, err = api_get("/appointment", {
                "start_date": cur.strftime("%Y-%m-%d"), "end_date": chunk_end.strftime("%Y-%m-%d"),
                "limit": 500, "outlet_id": outlet})
            if not ok:
                record('appointment_full.json', False, error=f"outlet {outlet}: {err}")
                print(f"  GAGAL outlet {outlet}: {err}")
                return
            for room in ((res or {}).get('data') or []):
                for a in (room.get('appointments') or []):
                    a['id_room'] = room.get('id_room')
                    a['room_name'] = room.get('room_name')
                    new_appts[a.get('id_appointment')] = a
            time.sleep(0.2)
        cur = chunk_end + timedelta(days=1)

    existing = {a.get('id_appointment'): a for a in data}
    added = updated = 0
    for aid, appt in new_appts.items():
        if aid in existing:
            if json.dumps(existing[aid], sort_keys=True) != json.dumps(appt, sort_keys=True):
                existing[aid] = appt
                updated += 1
        else:
            existing[aid] = appt
            added += 1

    if added or updated:
        atomic_write_json(path, list(existing.values()))
        print(f"  + {added} baru, {updated} diperbarui")
    else:
        print("  Tidak ada perubahan appointment")
    if deep:   # dicatat HANYA setelah seluruh rentang berhasil ditarik (kegagalan di tengah → return di atas)
        atomic_write_json(state_path, {"last_deep_at": time.time()})
    record('appointment_full.json', True, added, updated)


def sync_purchase_orders(filename='logistics_purchaseorder.json'):
    """Purchase order + rinciannya (item, harga beli, qty per supplier).

    Daftar `/logistics/purchaseorder` tidak memuat item; harga beli per item
    hanya ada di detail `/logistics/purchaseorder/{id}` (kolom `order_detail`).
    Supaya tidak menarik ulang semua detail tiap run, detail hanya diambil
    untuk PO baru atau PO yang `updated_at`/`status`-nya berubah di daftar.
    Satu record di file = objek detail (field daftar + `order_detail`).
    """
    endpoint = '/logistics/purchaseorder'
    path = os.path.join(DB_DIR, filename)
    data = load_local(path)
    by_id = {it.get('id'): it for it in data
             if isinstance(it, dict) and it.get('id') is not None}
    print(f"Syncing {endpoint} + detail... (lokal: {len(by_id)} PO)")

    listed, page = [], 1
    while True:
        ok, res, err = api_get(endpoint, {"limit": 100, "page": page})
        if not ok:
            fatal = '401' in (err or '')
            record(filename, False, error=err, skipped=not fatal)
            print(f"  {'GAGAL' if fatal else 'DILEWATI'}: {err}")
            return
        page_data = (res or {}).get('data') or []
        if not isinstance(page_data, list) or not page_data:
            break
        listed.extend(p for p in page_data if isinstance(p, dict) and p.get('id') is not None)
        if len(page_data) < 100:
            break
        page += 1
        time.sleep(0.2)

    added = updated = failed = 0
    for po in listed:
        pid = po['id']
        old = by_id.get(pid)
        unchanged = (old is not None and 'order_detail' in old
                     and old.get('updated_at') == po.get('updated_at')
                     and old.get('status') == po.get('status'))
        if unchanged:
            continue
        ok, res, err = api_get(f"{endpoint}/{pid}")
        detail = (res or {}).get('data') if ok else None
        time.sleep(0.2)
        if not isinstance(detail, dict):
            # Detail gagal: simpan field daftar dulu (tanpa order_detail) supaya
            # PO-nya tetap tercatat dan dicoba lagi di run berikutnya.
            failed += 1
            if old is None:
                by_id[pid] = po
                added += 1
            continue
        if old is None:
            added += 1
        else:
            updated += 1
        by_id[pid] = detail

    if added or updated:
        ordered = [by_id[k] for k in sorted(by_id.keys(), key=lambda x: x if isinstance(x, int) else 0)]
        atomic_write_json(path, ordered)
        print(f"  + {added} baru, {updated} diperbarui -> {filename} (total {len(ordered)})")
    else:
        print(f"  Tidak ada perubahan untuk {filename}")
    if failed:
        msg = f"{failed} detail PO gagal diambil (akan dicoba lagi di sync berikutnya)"
        record(filename, False, added, updated, error=msg, skipped=True)
        print(f"  SEBAGIAN: {msg}")
    else:
        record(filename, True, added, updated)


REPORT_URL = "https://api-report-registry-c2.cube.neosoft.co.id/api/v1"


def report_post(path, payload):
    """POST ke server laporan Neosoft (terpisah dari API utama). Hanya membaca:
    endpoint laporan menerima filter lewat body dan tidak mengubah data."""
    try:
        h = headers()
        h["Content-Type"] = "application/json"
        r = requests.post(f"{REPORT_URL}{path}", json=payload, headers=h, timeout=90)
    except requests.RequestException as e:
        return False, None, f"jaringan: {e.__class__.__name__}: {e}"
    if r.status_code == 401:
        return False, None, "HTTP 401 — token ditolak Neosoft (session dicabut?)"
    if r.status_code >= 400:
        return False, None, f"HTTP {r.status_code}: {r.text[:200]}"
    try:
        return True, r.json(), None
    except ValueError:
        return False, None, f"balasan bukan JSON: {r.text[:200]}"


def sync_commission_report(filename='commission_report.json', first_month='2026-05'):
    """Komisi per tindakan dari laporan Neosoft (REPORTS > Commission).

    - treatment : /commission/treatment  (komisi dokter & perawat per pemakaian)
    - sales     : /commission/sales      (komisi penjualan item, mis. produk dokter)
    Disimpan per bulan. Bulan yang sudah ada hanya diambil ulang untuk 2 bulan
    terakhir (data bulan berjalan masih berubah); sisanya dipertahankan.
    Field dipangkas ke yang dipakai kalkulator komisi (tanpa nama pasien).
    """
    path = os.path.join(DB_DIR, filename)
    store = load_local(path)
    if not isinstance(store, dict):
        store = {}
    store.setdefault('treatment', {})
    store.setdefault('sales', {})
    now = datetime.now(WIB)
    months, y, m = [], int(first_month[:4]), int(first_month[5:7])
    while (y, m) <= (now.year, now.month):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    refresh = set(months[-2:])
    keep_t = ['id', 'code', 'date', 'outlet_id', 'outlet_name', 'item_name', 'item_code', 'price',
              'used_qty', 'used_value', 'therapist_id', 'therapist_name', 'therapist_type',
              'is_doctor', 'total_commission', 'commission_category']
    keep_s = ['id', 'code', 'date', 'outlet_id', 'outlet_name', 'item_name', 'item_code', 'price',
              'qty', 'item_value', 'therapist_id', 'frontdesk_cs_name', 'therapist_type', 'total_commission']
    added = 0
    failed = []
    for mon in months:
        last_day = (datetime.strptime(mon + "-01", "%Y-%m-%d").replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        body = {"start_date": f"{mon}-01", "end_date": last_day.strftime("%Y-%m-%d")}
        for key, ep, keep in (('treatment', '/commission/treatment', keep_t), ('sales', '/commission/sales', keep_s)):
            if mon in store[key] and mon not in refresh:
                continue
            ok, res, err = report_post(ep, body)
            if not ok:
                failed.append(f"{ep} {mon}: {err}")
                continue
            rows = [{k: r.get(k) for k in keep} for r in ((res or {}).get('data') or []) if isinstance(r, dict)]
            store[key][mon] = rows
            added += len(rows)
            time.sleep(0.3)
    atomic_write_json(path, store)
    print(f"Komisi laporan Neosoft -> {filename} ({sum(len(v) for v in store['treatment'].values())} baris treatment, "
          f"{sum(len(v) for v in store['sales'].values())} baris penjualan)")
    if failed:
        record(filename, False, added, 0, error='; '.join(failed)[:300], skipped=not any('401' in f for f in failed))
    else:
        record(filename, True, added, 0)


def sync_payment_report(filename='payment_report.json', first_month='2026-05'):
    """Pembayaran per invoice per metode (REPORTS > Collection > By Payment Type).

    Dipakai Rekap Transaksi Harian: tunai, EDC/debit, QRIS, transfer, serta
    pembayaran non-kas (deposit, poin, credit voucher). Disimpan per bulan;
    hanya 2 bulan terakhir yang diambil ulang tiap run. Field dipangkas ke
    yang dipakai rekap (tanpa nama pasien).
    """
    path = os.path.join(DB_DIR, filename)
    store = load_local(path)
    if not isinstance(store, dict):
        store = {}
    now = datetime.now(WIB)
    months, y, m = [], int(first_month[:4]), int(first_month[5:7])
    while (y, m) <= (now.year, now.month):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    refresh = set(months[-2:])
    added, failed = 0, []
    for mon in months:
        if mon in store and mon not in refresh:
            continue
        last_day = (datetime.strptime(mon + "-01", "%Y-%m-%d").replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        ok, res, err = report_post('/collection/by-payment', {"start_date": f"{mon}-01", "end_date": last_day.strftime("%Y-%m-%d")})
        if not ok:
            failed.append(f"{mon}: {err}")
            continue
        rows = []
        for r in ((res or {}).get('data') or []):
            if not isinstance(r, dict):
                continue
            rows.append({
                'id_invoice': r.get('id_invoice'), 'inv_code': r.get('inv_code'), 'inv_date': r.get('inv_date'),
                'outlet_name': r.get('outlet_name'), 'total': r.get('total'),
                'payment': [{
                    'bank_name': (p.get('bank') or {}).get('bank_name'),
                    'bank_type': (p.get('bank') or {}).get('bank_type'),
                    'amount': p.get('amount'), 'paid_date': p.get('paid_date'), 'info': p.get('info')
                } for p in (r.get('payment') or []) if isinstance(p, dict)]
            })
        store[mon] = rows
        added += len(rows)
        time.sleep(0.3)
    atomic_write_json(path, store)
    print(f"Pembayaran per invoice -> {filename} ({sum(len(v) for v in store.values())} invoice)")
    if failed:
        record(filename, False, added, 0, error='; '.join(failed)[:300], skipped=not any('401' in f for f in failed))
    else:
        record(filename, True, added, 0)


def sync_deposit_mutations(filename='deposit_mutations.json', first_date='2026-04-01'):
    """Mutasi deposit pasien (REPORTS > Sales > By Deposit, "Mutasi Deposit").

    Satu-satunya sumber top-up deposit MANUAL (menu Sales > Deposit): top-up
    itu tidak menjadi invoice dan tidak muncul di Collection by Payment.
    Berisi juga pemakaian deposit (USE DEPOSIT), void, dan transfer antar
    pasien. Datanya kecil (ratusan baris), jadi ditarik penuh tiap run.
    Nama pasien tidak disimpan (cukup patient_id/patient_code).
    """
    path = os.path.join(DB_DIR, filename)
    today = datetime.now(WIB).strftime("%Y-%m-%d")
    ok, res, err = report_post('/sales/deposit', {"start_date": first_date, "end_date": today, "type": ["in", "out"]})
    if not ok or not isinstance((res or {}).get('data'), list):
        msg = err or 'balasan tanpa data'
        record(filename, False, 0, 0, msg)
        print(f"  GAGAL mutasi deposit: {msg}")
        return
    keep = ('patient_id', 'patient_code', 'date', 'created_at', 'reff_id', 'reff', 'outlet_id', 'outlet',
            'deposit_by', 'deposit_in', 'deposit_out', 'description', 'type', 'bank_name')
    rows = [{k: r.get(k) for k in keep} for r in res['data'] if isinstance(r, dict)]
    atomic_write_json(path, {'synced_at': datetime.now(WIB).isoformat(), 'start_date': first_date,
                             'end_date': today, 'data': rows})
    record(filename, True, len(rows), 0)
    print(f"Mutasi deposit -> {filename} ({len(rows)} baris)")


def sync_full(filename, endpoint, required=True):
    """Dataset referensi yang ditimpa utuh.

    PENTING: server membatasi 100 baris per halaman walau diminta `limit=500`,
    jadi endpoint ini WAJIB dipaginasi. Versi pertama skrip ini mengambil satu
    halaman lalu menimpa seluruh file — products.json sempat terpangkas dari
    449 jadi 100 item karenanya.
    """
    print(f"Syncing penuh {endpoint}...")
    rows, page = [], 1
    while True:
        ok, res, err = api_get(endpoint, {"limit": 100, "page": page})
        if not ok:
            # Token ditolak itu masalah serius — jangan pernah diturunkan jadi
            # "skipped" hanya karena endpoint-nya opsional.
            fatal = required or '401' in (err or '')
            record(filename, False, error=err, skipped=not fatal)
            print(f"  {'GAGAL' if fatal else 'DILEWATI'}: {err}")
            return
        page_data = (res or {}).get('data') or []
        if not isinstance(page_data, list) or not page_data:
            break
        rows.extend(page_data)
        if len(page_data) < 100:
            break
        page += 1
        time.sleep(0.2)

    path = os.path.join(DB_DIR, filename)
    before = len(load_local(path))
    if not rows:
        record(filename, True, 0, 0)
        print(f"  Kosong — {filename} dibiarkan apa adanya")
        return

    # Rem pengaman: penyusutan drastis hampir selalu berarti paginasi terpotong
    # atau API bermasalah, bukan data yang memang berkurang. Lebih baik
    # pertahankan file lama dan laporkan daripada menghapus data diam-diam.
    if before >= SHRINK_GUARD_MIN_ROWS and len(rows) < before * 0.5:
        msg = (f"penyusutan mencurigakan: {before} -> {len(rows)} baris "
               f"(<50%). File lama dipertahankan.")
        record(filename, False, error=msg, skipped=not required)
        print(f"  DITOLAK: {msg}")
        return

    atomic_write_json(path, rows)
    print(f"  {len(rows)} item -> {filename} (sebelumnya {before})")
    record(filename, True, max(0, len(rows) - before), min(before, len(rows)))


def sync_product_outlet_prices(filename='product_outlet_prices.json'):
    """Harga per outlet tiap item (menu Item > tab Custom di Neosoft).

    Harga yang ditagihkan kasir per cabang bisa beda dari harga master `price` di
    products.json. Disimpan di file terpisah: kalau /products ditarik dengan relasi
    ProductTreatmentOutlets, Neosoft ikut mengubah bentuk field komisi
    (`usage_commission.commission_dr_gp.type` hilang), jadi products.json tidak disentuh.
    Isi: [{product_id, code, outlets: [{outlet_id, price, is_active}]}].
    """
    print("Syncing harga per outlet /products + ProductTreatmentOutlets...")
    graph = json.dumps({"fields": "*", "filters": [], "relations": [
        {"fields": "*", "relation": "ProductTreatmentOutlets"}]})
    rows, page = [], 1
    while True:
        ok, res, err = api_get('/products', {"limit": 100, "page": page, "graph": graph})
        if not ok:
            record(filename, False, error=err, skipped='401' not in (err or ''))
            print(f"  GAGAL: {err}")
            return
        data = (res or {}).get('data') or []
        if not isinstance(data, list) or not data:
            break
        rows.extend(data)
        if len(data) < 100:
            break
        page += 1
        time.sleep(0.2)
    out = [{
        'product_id': r.get('id'),
        'code': r.get('product_treatment_code'),
        'outlets': [{'outlet_id': o.get('outlet_id'), 'price': o.get('price'), 'is_active': o.get('is_active')}
                    for o in (r.get('product_treatment_outlets') or [])],
    } for r in rows]
    path = os.path.join(DB_DIR, filename)
    before = len(load_local(path))
    if before >= SHRINK_GUARD_MIN_ROWS and len(out) < before * 0.5:
        msg = f"penyusutan mencurigakan: {before} -> {len(out)} baris (<50%). File lama dipertahankan."
        record(filename, False, error=msg, skipped=True)
        print(f"  DITOLAK: {msg}")
        return
    atomic_write_json(path, out)
    print(f"  {len(out)} item -> {filename}")
    record(filename, True, max(0, len(out) - before), min(before, len(out)))


def sync_stock_card(filename='stock_card.json', warehouse_ids=(1, 2), required=False):
    """Kartu stok logistik — sumber stok/FEFO/dead-stock yang SUNGGUHAN.

    Ditemukan lewat probing manual (bukan didokumentasikan di mana pun):
    /logistics/stock-card menolak GET (405 Method Not Allowed) dan
    mengharuskan POST dengan body {warehouse_id, start_date, end_date,
    page, limit}. Tanpa start_date/end_date, server balas 200 sukses tapi
    `data: null` dan `total` semuanya nol — kelihatan seperti "berhasil,
    tidak ada data" padahal sebenarnya query-nya salah bentuk.

    limit tinggi (20000) ternyata TIDAK memotong hasil — 3.110 baris utuh
    untuk warehouse 1 dan 4.877 untuk warehouse 2 kembali dalam satu page,
    beda dari /products dkk yang keras dibatasi 100/halaman. Tetap dicek
    di bawah untuk jaga-jaga kalau server berubah perilaku nanti.

    Diambil SEJAK AWAL (2026-01-01), bukan 30 hari rolling seperti
    logistics_stock_card.json — getPharmacyStockHub() di data_provider.js
    perlu histori penuh (baris BEGIN dkk) supaya saldo berjalan per SKU
    benar untuk item yang sudah lama tidak ada transaksi (dead stock).
    """
    print("Syncing kartu stok /logistics/stock-card (histori penuh)...")
    all_rows = []
    for wh in warehouse_ids:
        ok, res, err = api_post('/logistics/stock-card', {
            "warehouse_id": wh,
            "start_date": "2026-01-01",
            "end_date": datetime.now(WIB).strftime('%Y-%m-%d'),
            "page": 1,
            "limit": 20000
        })
        if not ok:
            record(filename, False, error=f"warehouse {wh}: {err}", skipped=not required)
            print(f"  GAGAL warehouse {wh}: {err}")
            continue
        rows = (res or {}).get('data') or []
        print(f"  warehouse {wh}: {len(rows)} baris")
        if len(rows) >= 20000:
            print(f"  PERINGATAN: warehouse {wh} tepat di batas limit — kemungkinan terpotong, cek paginasi.")
        all_rows.extend(rows)
        time.sleep(0.2)

    if not all_rows:
        record(filename, True, 0, 0)
        print("  Kosong — stock_card.json dibiarkan apa adanya")
        return

    path = os.path.join(DB_DIR, filename)
    before = len(load_local(path))
    if before >= SHRINK_GUARD_MIN_ROWS and len(all_rows) < before * 0.5:
        msg = f"penyusutan mencurigakan: {before} -> {len(all_rows)} baris (<50%). File lama dipertahankan."
        record(filename, False, error=msg, skipped=True)
        print(f"  DITOLAK: {msg}")
        return

    atomic_write_json(path, all_rows)
    print(f"  {len(all_rows)} baris -> {filename} (sebelumnya {before})")
    record(filename, True, max(0, len(all_rows) - before), min(before, len(all_rows)))


def sync_post(filename, endpoint, payload=None, params=None, required=False):
    """Sinkronisasi endpoint POST yang mengembalikan list data."""
    path = os.path.join(DB_DIR, filename)
    before = len(load_local(path))
    ok, res, err = api_post(endpoint, payload=payload, params=params)
    if not ok:
        fatal = required or '401' in (err or '')
        record(filename, False, error=err, skipped=not fatal)
        print(f"  {'GAGAL' if fatal else 'DILEWATI'}: {err}")
        return
    data = (res or {}).get('data') or []
    if not isinstance(data, list):
        data = [data] if data else []
    atomic_write_json(path, data)
    record(filename, True, max(0, len(data) - before), min(before, len(data)))
    print(f"  {len(data)} item -> {filename} (sebelumnya {before})")


def sync_stock_opname():
    """Tarik stok opname fisik riil & ED per gudang (Depok & Pondok Kopi)."""
    filename = 'logistics_stock_opname.json'
    print("Syncing stock opname per gudang...")
    all_opname = []
    for wh_id, wh_name in [(1, 'Depok'), (2, 'Pondok Kopi')]:
        ok, res, err = api_post('/logistics/stock-opname', payload={'warehouse_id': wh_id})
        if ok and res:
            items = res.get('data') or []
            for it in items:
                if isinstance(it, dict):
                    it['warehouse_id'] = wh_id
                    it['warehouse_name'] = wh_name
            all_opname.extend(items)
        time.sleep(0.2)
    path = os.path.join(DB_DIR, filename)
    before = len(load_local(path))
    atomic_write_json(path, all_opname)
    record(filename, True, max(0, len(all_opname) - before), min(before, len(all_opname)))
    print(f"  {len(all_opname)} item opname -> {filename}")


def sync_check_stock_buffer():
    """Deteksi barang kritis di bawah batas buffer stock (Ikon 7 Automasi) —
    endpoint native Neosoft untuk alert buffer stock, pelengkap perhitungan
    manual di getPharmacyStockHub() (data_provider.js)."""
    filename = 'stock_buffer_alerts.json'
    print("Syncing buffer stock warning alerts...")
    items_path = os.path.join(DB_DIR, 'logistics_items.json')
    logistics_items = load_local(items_path)
    item_ids = [it.get('id') for it in logistics_items if isinstance(it, dict) and it.get('id')]
    alerts = []
    for wh_id, wh_name in [(1, 'Depok'), (2, 'Pondok Kopi')]:
        for i in range(0, min(len(item_ids), 300), 50):
            chunk = item_ids[i:i+50]
            if not chunk:
                break
            ok, res, err = api_post('/logistics/check-stock', payload={'warehouse_id': wh_id, 'item_ids': chunk}, params={'show_stock': 'yes'})
            if ok and res and res.get('status') == 'success':
                rows = res.get('data') or []
                for r in rows:
                    if isinstance(r, dict):
                        st = r.get('stock', 0) or 0
                        bf = r.get('buffer_stock', 0) or 0
                        if bf > 0 and st <= bf:
                            r['warehouse_id'] = wh_id
                            r['warehouse_name'] = wh_name
                            r['alert_type'] = 'OUT_OF_STOCK' if st <= 0 else 'CRITICAL_BUFFER'
                            alerts.append(r)
            time.sleep(0.1)
    path = os.path.join(DB_DIR, filename)
    before = len(load_local(path))
    atomic_write_json(path, alerts)
    record(filename, True, max(0, len(alerts) - before), min(before, len(alerts)))
    print(f"  {len(alerts)} item buffer stock alert -> {filename}")


def sync_package_balances(filename='package_balances.json', page_size=100, max_pages=60):
    """Sisa paket/sesi per invoice — sumber yang sama dengan tab 'Tx / Product Balance'
    di Neosoft. invoice_package.qty = SISA sesi, .used = sudah dipakai (kosong bila
    belum pernah dipakai). Data pemakaian (usages_details) tidak memuat paket yang
    belum pernah dipakai sama sekali, jadi sisa paket harus dibaca dari sini.
    Hanya baris yang masih ada sisa (qty > 0) yang disimpan."""
    path = os.path.join(DB_DIR, filename)
    graph = json.dumps({
        "fields": "invoices.*",
        "filters": [{"field": "invoices.void_invoice", "operator": "eq", "value": False},
                    {"field": "invoices.id_invoice", "operator": "sort", "value": "desc"}],
        "relations": [{"fields": "*", "relation": "InvoiceDetail"}, {"fields": "*", "relation": "InvoiceDetail.InvoicePackage"}]
    })
    packages, invoices_out, seen_invoices, failed = [], {}, 0, None
    for page in range(1, max_pages + 1):
        ok, payload, err = api_get('/invoices', {'graph': graph, 'limit': page_size, 'page': page})
        if not ok:
            failed = err
            break
        rows = (payload or {}).get('data') or []
        for inv in rows:
            seen_invoices += 1
            if inv.get('transtype') not in (None, 'sales', 'convert'):
                continue
            lines, has_remaining = [], False
            for det in inv.get('invoice_detail') or []:
                for p in det.get('invoice_package') or []:
                    remaining = p.get('qty') or 0
                    disc = det.get('discount') or {}
                    lines.append({
                        'item_code': det.get('item_code'), 'product_id': p.get('product_id'), 'qty': det.get('qty'),
                        'price': det.get('current_price'), 'discount': (disc.get('value') if isinstance(disc, dict) else None),
                        'subtotal': det.get('subtotal'), 'remaining': remaining, 'used': p.get('used') or 0,
                        'frozen': bool(p.get('is_frozen')), 'package_id': p.get('id'),
                    })
                    if remaining > 0 and not p.get('is_frozen'):
                        has_remaining = True
                        packages.append({
                            'customer_id': inv.get('customer_id'), 'inv_code': inv.get('inv_code'),
                            'inv_date': inv.get('inv_date'), 'expired_date': inv.get('expired_date'),
                            'outlet_id': inv.get('outlet_id'), 'package_id': p.get('id'),
                            'product_id': p.get('product_id'), 'remaining': remaining, 'used': p.get('used') or 0,
                        })
            # Seluruh baris invoice yang masih punya sisa (termasuk yang sudah habis) untuk tampilan detail per invoice
            if has_remaining:
                invoices_out[inv.get('inv_code')] = {
                    'inv_code': inv.get('inv_code'), 'inv_date': inv.get('inv_date'), 'customer_id': inv.get('customer_id'),
                    'outlet_id': inv.get('outlet_id'), 'expired_date': inv.get('expired_date'), 'remarks': (inv.get('remarks') or '').strip(),
                    'total': inv.get('total_after_tax') or inv.get('total'), 'unpaid': inv.get('remaining') or 0, 'lines': lines,
                }
        if len(rows) < page_size:
            break
    if failed:
        # jangan menimpa data lama dengan hasil setengah jadi
        record(filename, False, error=failed, skipped=True)
        print(f"  Sisa paket gagal ({failed}) — data lama dipertahankan")
        return
    atomic_write_json(path, {'synced_at': datetime.now(WIB).isoformat(), 'invoices_scanned': seen_invoices, 'packages': packages, 'invoices': invoices_out})
    record(filename, True, len(packages), 0)
    print(f"  Sisa paket: {len(packages)} paket aktif ({len(invoices_out)} invoice) dari {seen_invoices} invoice -> {filename}")


def sync_medical_records(filename='medicalrecords.json', recent_days=14, pause=0.12, max_per_run=80, deadline=None):
    """Medical record (anamnesa + SOAP) per pasien.

    Neosoft tidak punya endpoint daftar; hanya /customers/<id>/medicalrecord.
    Run pertama menarik semua pasien yang punya invoice. Run berikutnya hanya
    pasien dengan invoice baru atau invoice dalam `recent_days` hari terakhir
    (SOAP sering dilengkapi dokter/admin beberapa hari setelah kunjungan).
    Saat dijalankan dari server (background, batas 3 menit) jumlah pasien per
    putaran dibatasi `max_per_run`: pasien baru dulu, lalu yang paling lama
    tidak dicek — sisanya terambil di putaran berikutnya.
    """
    path = os.path.join(DB_DIR, filename)
    store = load_local(path)
    if not isinstance(store, dict):
        store = {}
    records = {str(r['id']): r for r in store.get('records', []) if isinstance(r, dict) and r.get('id') is not None}
    fetched = store.get('fetched_customers', {})
    invoices = load_local(os.path.join(DB_DIR, 'invoices_all.json'))
    cutoff = (datetime.now(WIB) - timedelta(days=recent_days)).strftime('%Y-%m-%d')
    new, recent = set(), set()
    for inv in invoices:
        cid = inv.get('customer_id')
        if not cid:
            continue
        if str(cid) not in fetched:
            new.add(cid)
        elif str(inv.get('inv_date', ''))[:10] >= cutoff:
            recent.add(cid)
    # Run pertama (belum ada data sama sekali) boleh menarik semua
    limit = None if not fetched else max_per_run
    ordered = sorted(new) + sorted(recent - new, key=lambda c: fetched.get(str(c), ''))
    targets = ordered if limit is None else ordered[:limit]
    graph = json.dumps({"fields": "anamnesas.*", "filters": [], "relations": [
        {"relation": r, "fields": "*", "filters": []} for r in
        ("AnamnesaDetail", "AnamnesaDetail.ProductTreatment", "AnamnesaDiagnosa", "Appointment.Appointment", "Invoice")]})
    before = len(records)
    failed = []
    checked = 0
    for cid in targets:
        # Server menjalankan sync dengan batas 3 menit — berhenti sebelum itu,
        # sisanya diambil di putaran berikutnya.
        if deadline and time.time() > deadline:
            break
        checked += 1
        ok, payload, err = api_get(f'/customers/{cid}/medicalrecord', {'graph': graph})
        if not ok:
            failed.append(f'{cid}: {err}')
            if '401' in (err or '') or len(failed) >= 10:
                break
            continue
        for a in (payload or {}).get('data') or []:
            inv = a.get('invoice') or {}
            records[str(a['id'])] = {
                'id': a['id'], 'code': a.get('anamnesa_code'), 'customer_id': a.get('customer_id'),
                'date': a.get('date'), 'outlet_id': a.get('outlet_id'), 'created_by': a.get('created_by'),
                'status': a.get('status_anamnesa'), 'soap': a.get('soap') or {}, 'resume': a.get('resume'),
                'inv_code': inv.get('inv_code'), 'invoice_void': inv.get('void_invoice'),
                'doctor_id': inv.get('doctor_id'), 'therapist_id': inv.get('therapist_id'),
                'items': [{'product_id': d.get('product_id'), 'kind': d.get('kind'), 'qty': d.get('qty'), 'notes': d.get('notes'),
                           'name': (d.get('product_treatment') or {}).get('product_treatment_name')} for d in (a.get('anamnesa_detail') or [])],
                'diagnosa': a.get('anamnesa_diagnosa') or [],
                'next_appointment': a.get('appointment') or None,
                'created_at': a.get('created_at'), 'updated_at': a.get('updated_at'),
            }
        fetched[str(cid)] = datetime.now(WIB).isoformat()
        time.sleep(pause)
    data = {'synced_at': datetime.now(WIB).isoformat(), 'fetched_customers': fetched,
            'records': sorted(records.values(), key=lambda r: r['id'])}
    atomic_write_json(path, data)
    added = len(records) - before
    if failed:
        record(filename, False, added, 0, error='; '.join(failed)[:300], skipped=not any('401' in f for f in failed))
    else:
        record(filename, True, added, 0)
    print(f"  Medical record: {checked} dari {len(new | recent)} pasien dicek, {len(records)} record (+{added}) -> {filename}")


def report_missing_pe_photos():
    """Laporkan pemeriksaan fisik yang belum punya foto detail."""
    pe = load_local(os.path.join(DB_DIR, 'physicalexamination.json'))
    try:
        with open(os.path.join(DB_DIR, 'pe_detail_photos.json')) as f:
            photos = json.load(f)
        photos = photos.get('data', photos) if isinstance(photos, dict) else photos
    except (FileNotFoundError, json.JSONDecodeError):
        photos = {}

    have = set()
    if isinstance(photos, dict):
        for rows in photos.values():
            for r in rows:
                if isinstance(r, dict) and r.get('pe_id') is not None:
                    have.add(r['pe_id'])

    all_ids = {p.get('id') for p in pe if isinstance(p, dict) and p.get('id') is not None}
    missing = sorted(all_ids - have)
    REPORT['pe_photos'] = {
        'physical_exams': len(all_ids),
        'with_photos': len(all_ids & have),
        'missing': len(missing),
        'missing_pe_ids': missing[:100],
        'note': 'Foto tidak bisa ditarik otomatis: API hanya mengizinkan PUT/DELETE '
                'pada /physicalexamination/<id>, tidak ada GET.'
    }
    print(f"Foto pemeriksaan fisik: {len(all_ids & have)}/{len(all_ids)} sudah ada, "
          f"{len(missing)} belum (tidak bisa ditarik otomatis)")


# ───────────────────────────── main ─────────────────────────────

_SYNC_T0 = time.time()


def main():
    global _SYNC_T0
    _SYNC_T0 = time.time()
    started = datetime.now(WIB)
    print(f"--- MULAI SYNC LENGKAP NEOSOFT {started.isoformat()} ---")

    if not TOKEN:
        print("FATAL: token.txt kosong / tidak ada.")
        REPORT["errors"].append("token.txt kosong atau tidak ditemukan")
        return "failed"

    # 1. Data Transaksional & Riwayat
    sync_incremental_id('customers_all.json', '/customers')
    sync_incremental_id('invoices_all.json', '/invoices')
    sync_incremental_id('usages_details.json', '/usages/details')
    # Dokumen pemakaian (usage_code, tanggal, pasien, void/validasi).
    # usage_code = kolom `ref` di kartu stok, jadi ini penghubung antara
    # treatment di usages_details (usage_id) dan BHP yang keluar di stock_card.
    sync_incremental_id('usages.json', '/usages')
    sync_incremental_id('physicalexamination.json', '/physicalexamination')
    sync_appointments()
    # Sisa paket (butuh invoices_all terbaru; cepat: ~16 request)
    sync_package_balances()
    sync_incremental_id('customers_log_histories.json', '/customers/log-histories')
    sync_incremental_id('logistics_mutation_order.json', '/logistics/mutation-order')
    sync_incremental_id('logistics_mutation_receive.json', '/logistics/mutation-receive')
    sync_incremental_id('logistics_inventory_adjustment.json', '/logistics/inventory-adjustment')
    sync_purchase_orders()
    sync_commission_report()
    sync_payment_report()
    sync_deposit_mutations()

    # 2. Notifikasi & Automasi Real-Time
    sync_full('notification_unpaid.json', '/notification/unpaid')
    sync_full('notification_birthday.json', '/notification/birthday')
    sync_full('notification_appointment.json', '/notification/appointment')
    sync_full('notification_unvalidated_usage.json', '/notification/unvalidated-usage')

    # 3. Master Katalog Treatment, Produk, Gudang & Manajemen
    # Endpoint logistik/farmasi (logistics_items, suppliers, warehouses,
    # uoms, banks, dst) ditemukan lewat probing manual — tidak ada di
    # dokumentasi resmi, tapi nyata dan dipakai modul Logistik/Farmasi
    # Neosoft yang sebelumnya tidak pernah disambungkan sama sekali.
    master_endpoints = [
        ('products.json', '/products'),
        ('therapists.json', '/therapists'),
        ('packages.json', '/packages'),
        ('creditvoucher.json', '/creditvoucher'),
        ('category.json', '/category'),
        ('logistics_items.json', '/logistics/items'),
        ('warehouses.json', '/warehouses'),
        ('racks.json', '/racks'),
        ('suppliers.json', '/suppliers'),
        ('banks.json', '/banks'),
        ('outlets.json', '/outlets'),
        ('vouchers.json', '/vouchers'),
        ('roles.json', '/roles'),
        ('user_access.json', '/user-access'),
        ('marketingsource.json', '/marketingsource'),
        ('patient_status.json', '/patient-status'),
        ('occupations.json', '/occupations'),
        ('religions.json', '/religions'),
        ('groups.json', '/groups'),
        ('consultants.json', '/consultants'),
        ('doctortypes.json', '/doctortypes'),
        ('uoms.json', '/uoms'),
        ('equipment_brand.json', '/equipment/brand'),
        ('equipment_model.json', '/equipment/model'),
        ('equipment_series.json', '/equipment/series'),
        ('equipment_supplier.json', '/equipment/supplier'),
        ('locations_provinces.json', '/locations/provinces'),
        ('locations_cities.json', '/locations/cities'),
        ('locations_districts.json', '/locations/districts'),
        ('locations_countries.json', '/locations/countries'),
        ('activities.json', '/activities'),
        ('report_appointment.json', '/report/appointment'),
        ('manufacture_finished_product.json', '/manufacture/finished-product'),
        ('manufacture_material_release.json', '/manufacture/material-release'),
        ('manufacture_work_order.json', '/manufacture/work-order'),
        ('logistics_purchaseorder_type.json', '/logistics/purchaseorder-type'),
    ]

    for fname, ep in master_endpoints:
        sync_full(fname, ep, required=False)
    sync_product_outlet_prices()

    # 4. Operasi Logistik Khusus (Kartu Stok & Buffer Alert)
    # sync_stock_card() (histori penuh sejak 2026-01-01, stock_card.json)
    # dipakai getPharmacyStockHub() di data_provider.js — dipertahankan
    # dari branch audit alih-alih sync_stock_cards() bawaan main yang cuma
    # 30 hari rolling ke logistics_stock_card.json (endpoint sama, jendela
    # lebih pendek — dijalankan dua-duanya berarti nge-hit endpoint yang
    # sama dua kali tiap sync tanpa manfaat tambahan).
    sync_stock_opname()
    sync_check_stock_buffer()
    sync_stock_card()
    # Medical record SOAP (rencana dokter) — terakhir, memakai sisa waktu dari
    # batas 3 menit server (cadangan 25 detik untuk menulis laporan)
    sync_medical_records(deadline=_SYNC_T0 + 150)

    report_missing_pe_photos()

    eps = REPORT["endpoints"]
    ok_count = sum(1 for v in eps.values() if v["ok"])
    failed = [k for k, v in eps.items() if not v["ok"] and not v["skipped"]]
    skipped = [k for k, v in eps.items() if v["skipped"]]
    if ok_count == 0:
        return "failed"
    if failed or skipped:
        return "partial"
    return "success"


if __name__ == "__main__":
    if not acquire_lock():
        sys.exit(0)
    status = "failed"
    try:
        status = main()
    except Exception:
        REPORT["errors"].append("exception: " + traceback.format_exc(limit=3))
        print(traceback.format_exc())
    finally:
        release_lock()

    now_wib = datetime.now(WIB)
    eps = REPORT["endpoints"]
    meta = {
        "last_sync_timestamp": now_wib.isoformat(),
        "last_sync_formatted": now_wib.strftime("%d %b %Y, %H:%M:%S WIB"),
        "status": status,                       # success | partial | failed
        "endpoints_ok": sum(1 for v in eps.values() if v["ok"]),
        "endpoints_total": len(eps),
        "records_added": sum(v["added"] for v in eps.values()),
        "records_updated": sum(v["updated"] for v in eps.values()),
        "errors": REPORT["errors"],
        "pe_photos": REPORT.get("pe_photos"),
        "detail": eps,
        "total_invoices": len(load_local(os.path.join(DB_DIR, 'invoices_all.json'))),
        "total_customers": len(load_local(os.path.join(DB_DIR, 'customers_all.json'))),
    }
    atomic_write_json(os.path.join(DB_DIR, 'sync_meta.json'), meta)
    print(f"--- SYNC {status.upper()} @ {meta['last_sync_formatted']} "
          f"(+{meta['records_added']} baru, ~{meta['records_updated']} diperbarui) ---")
    for e in REPORT["errors"]:
        print(f"    ! {e}")
    sys.exit(0 if status in ("success", "partial") else 1)
