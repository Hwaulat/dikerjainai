# KEFIR Clinic Dashboard — Production CI/CD & Deployment Blueprint

This directory contains the deployment schemas, configuration templates, and operational documentation for **KEFIR Derma Clinic - Executive Analytics & Multi-Branch Management Portal** (`kefir-clinic-dashboard`).

---

## 1. Architectural Flow

```
[ Git Push / Merge to 'main' ]
             │
             ▼
     [ GitLab CI / CD Pipeline ]
       ├─ Stage 1: Build & Push Docker image to GitLab Registry
       │    └─ Multi-stage Alpine container (Node.js 20 + Python 3 sync worker)
       ├─ Stage 2: Security Scan with Aqua Trivy
       │    └─ Emits tabular report + JSON artifact; blocks unfixed CRITICAL CVEs
       └─ Stage 3: SSH Zero-Downtime Deployment
             │  (SSH with private key into Target Production VM)
             ▼
    [ Target Production VM ]
       ├─ Host Nginx (Reverse proxy + SSL Let's Encrypt + Rate limiting)
       │    │  (Proxies :80/:443 ──> 127.0.0.1:3344)
       │    ▼
       ├─ Docker Compose Directory: /opt/dockerapp/kefir-clinic-dashboard/
       │    ├─ docker-compose.yml  (Configured ONCE on the VM, never overwritten by CI)
       │    ├─ .env                (Runtime secrets; DOCKER_IMAGE_TAG bumped by CI)
       │    ├─ data/               (Persistent databases & sync cache)
       │    ├─ wa_assistant_auth/  (Persistent WhatsApp Baileys session keys)
       │    └─ logs/               (Runtime and Neosoft sync logs)
       │
       └─ Docker Container:
            - Runs as non-root (`node:node`, UID 1000)
            - Drops all Linux capabilities (`cap_drop: ALL`, `no-new-privileges:true`)
            - Binds strictly to `127.0.0.1:3344` on host (invisible to public internet)
```

---

## 2. Core Philosophy: "Reference-Only" Docker Compose

* **Single Source of Truth on the VM**: The production server retains local volume mappings, environment secrets, and port allocations.
* **Lean & Fast Deployment**: CI/CD does not upload large tarballs or overwrite server configurations. It connects via SSH, authenticates to the GitLab registry, updates `DOCKER_IMAGE_TAG` in `.env`, and executes:
  ```bash
  docker compose pull
  docker compose up -d --remove-orphans
  docker image prune -f
  ```
* **Zero Secret Leakage**: Production credentials (`NEOSOFT_TOKEN`, `KEFIR_SESSION_SECRET`, Meta keys) reside exclusively inside `/opt/dockerapp/kefir-clinic-dashboard/.env` on the VM, never committed to git.
* **Preserved WhatsApp Sessions**: WhatsApp Baileys session credentials reside in the mounted `./wa_assistant_auth` volume, so redeployments never force the clinic owner to re-scan the QR code.

---

## 3. One-Time Production VM Setup

### Step 1: Install Docker & Docker Compose
On your Ubuntu / Debian production server:
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### Step 2: Initialize Application Directory & Permissions
Run the initialization script or execute manually:
```bash
sudo mkdir -p /opt/dockerapp/kefir-clinic-dashboard/data
sudo mkdir -p /opt/dockerapp/kefir-clinic-dashboard/wa_assistant_auth
sudo mkdir -p /opt/dockerapp/kefir-clinic-dashboard/logs

# Critical: UID 1000 is the 'node' user inside the container
sudo chown -R 1000:1000 /opt/dockerapp/kefir-clinic-dashboard/data \
                        /opt/dockerapp/kefir-clinic-dashboard/wa_assistant_auth \
                        /opt/dockerapp/kefir-clinic-dashboard/logs
sudo chmod 750 /opt/dockerapp/kefir-clinic-dashboard/data \
               /opt/dockerapp/kefir-clinic-dashboard/wa_assistant_auth \
               /opt/dockerapp/kefir-clinic-dashboard/logs
```

### Step 3: Copy `docker-compose.yml` and Configure `.env`
Place `docker-compose.yml` into `/opt/dockerapp/kefir-clinic-dashboard/`:
```bash
sudo cp deploy/docker-compose.yml /opt/dockerapp/kefir-clinic-dashboard/docker-compose.yml
sudo cp deploy/.env.example /opt/dockerapp/kefir-clinic-dashboard/.env
sudo chmod 600 /opt/dockerapp/kefir-clinic-dashboard/.env
```
Edit `/opt/dockerapp/kefir-clinic-dashboard/.env` to configure your clinic keys:
- `KEFIR_SESSION_SECRET` (generate with `openssl rand -hex 32`)
- `NEOSOFT_TOKEN` (Bearer token for Neosoft Cloud API sync)
- `NINEROUTER_API_KEY` (if using Executive AI assistant)
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`

### Step 4: Configure Host Nginx & Let's Encrypt SSL
1. Copy the Nginx template:
   ```bash
   sudo cp deploy/nginx/kefir-clinic.conf /etc/nginx/sites-available/kefir-clinic.conf
   sudo ln -s /etc/nginx/sites-available/kefir-clinic.conf /etc/nginx/sites-enabled/
   ```
2. Obtain SSL certificate with Certbot:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d clinic.kefir.id
   ```
3. Test and reload Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 4. GitLab CI/CD Variables

In your GitLab project settings (**Settings > CI/CD > Variables**), register the following variables:

| Variable | Type | Flags | Description |
|---|---|---|---|
| `SSH_HOST` | Variable | Masked | VM IP address or hostname |
| `SSH_USER` | Variable | Expanded | SSH user with access to run docker (e.g. `ubuntu` or `deploy`) |
| `SSH_PORT` | Variable | Expanded | SSH port (default: `22`) |
| `SSH_PRIVATE_KEY` | Variable | Masked, Protected | Private SSH key (ensure public key is in `~/.ssh/authorized_keys` on VM) |
| `DEPLOY_PATH` | Variable | Expanded | `/opt/dockerapp/kefir-clinic-dashboard` |

*(Note: `CI_REGISTRY`, `CI_REGISTRY_USER`, `CI_REGISTRY_PASSWORD`, and `CI_REGISTRY_IMAGE` are automatically supplied by GitLab CI).*

---

## 5. Operational Verification

Check container status and health:
```bash
cd /opt/dockerapp/kefir-clinic-dashboard
docker compose ps
```

Inspect healthcheck response:
```bash
curl -s http://127.0.0.1:3344/api/health
# Output: {"status":"ok","service":"kefir-clinic-dashboard","uptime":120,"timestamp":"..."}
```

Stream live application logs:
```bash
docker compose logs -f app
```

Manually trigger sync inside the container:
```bash
docker compose exec app python3 scripts/sync_neosoft.py
```

Database migrations & status:
*(When `DATABASE_URL` is configured, `docker-entrypoint.sh` automatically runs `prisma migrate deploy` on every container start).*
```bash
# Check Prisma migration status
docker compose exec app npm run db:status

# Manually trigger data import from data/*.json into PostgreSQL
docker compose exec app npm run db:migrate
```

