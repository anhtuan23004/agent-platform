# Hackathon Deployment Guide

Each team gets a **forked repo + subdomain + AWS credentials** from the organizer.  
CI/CD runs in your fork via GitHub Actions — no local tooling required to deploy.

---

## What the organizer provides to each team

| Item | Example |
|------|---------|
| Subdomain | `team-alpha.demo-ai-hackathon.seta-international.com` |
| EC2 public IP | `x.x.x.x` (pre-bootstrapped, Docker ready) |
| EC2 SSH private key | `.pem` file |
| ECR registry | `YOUR_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com` (from organizer) |
| ECR repository | `team-alpha` |
| AWS access key (ECR push) | `AKIA…` |
| AWS secret key (ECR push) | `…` |
| OpenAI API key | `sk-…` |

---

## One-time setup (after receiving credentials)

### 1. Fork the repo

Go to `https://github.com/Seta-International/agent-platform` → **Fork**.

### 2. Set GitHub Variables

**Settings → Secrets and variables → Actions → Variables tab → New repository variable**

| Variable | Value |
|----------|-------|
| `ECR_REGISTRY` | ECR registry hostname from organizer |
| `ECR_REPOSITORY` | ECR repository name from organizer |
| `AWS_REGION` | `ap-southeast-1` |
| `APP_DOMAIN` | Your subdomain from organizer |
| `ACME_EMAIL` | Email for Let's Encrypt TLS cert notifications |
| `EC2_HOST` | EC2 public IP from organizer |
| `EC2_USER` | `ubuntu` |

### 3. Set GitHub Secrets

**Settings → Secrets and variables → Actions → Secrets tab → New repository secret**

| Secret | Value |
|--------|-------|
| `AWS_ECR_ACCESS_KEY_ID` | AWS access key from organizer |
| `AWS_ECR_SECRET_ACCESS_KEY` | AWS secret key from organizer |
| `EC2_SSH_PRIVATE_KEY` | Full content of the `.pem` file (including `-----BEGIN...-----`) |
| `POSTGRES_PASSWORD` | Strong random password: `openssl rand -hex 16` |
| `BETTER_AUTH_SECRET` | Strong random secret: `openssl rand -hex 32` |
| `CRYPTO_LOCAL_MASTER_KEY` | Strong random key: `openssl rand -hex 32` |
| `OPENAI_API_KEY` | OpenAI API key from organizer |

### 4. Verify EC2 is ready

If the organizer provisioned the EC2 with the Terraform stack, everything is pre-configured — skip to [Deploy](#deploy).

If you are using a **plain Ubuntu 24.04 instance**, SSH in and run the one-time bootstrap:

```bash
ssh -i your-key.pem ubuntu@<EC2_HOST>

# 1. Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker

# 2. Install AWS CLI v2
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip

# 3. Create deploy directories
sudo mkdir -p /opt/platform /opt/seta
sudo chown ubuntu:ubuntu /opt/platform /opt/seta

# 4. Stop host nginx — Traefik owns ports 80 and 443
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo apt-get purge -y nginx nginx-common 2>/dev/null || true

# 5. Verify
docker --version && aws --version
```

---

## Deploy

1. Go to your fork on GitHub → **Actions** → **Hackathon — Build & Deploy**
2. Click **Run workflow**
3. Optionally enter a custom image tag (default: short SHA of HEAD)
4. Click **Run workflow** — takes ~5–8 min for first build (cached on subsequent runs)

The workflow:
- Builds `seta-server` and `seta-web` for `linux/amd64`
- Pushes images to your ECR repository
- SSHs into your EC2 and restarts the app containers
- Runs database migrations

### Access your app

```
https://<APP_DOMAIN>
```

---

## Redeploy after code changes

Just run the workflow again — either manually or push to `main`.

---

## Useful SSH commands

```bash
ssh -i your-key.pem ubuntu@<EC2_HOST>

# Live logs
cd /opt/platform && docker compose --env-file /opt/seta/.env logs -f --tail=50

# Restart stack manually
docker compose --env-file /opt/seta/.env up -d --no-deps server web worker

# Check .env
cat /opt/seta/.env

# Run migrations manually
docker compose --env-file /opt/seta/.env run --rm migrator
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Workflow fails at ECR login | Check `AWS_ECR_ACCESS_KEY_ID` and `AWS_ECR_SECRET_ACCESS_KEY` secrets |
| Workflow fails at SSH | Check `EC2_SSH_PRIVATE_KEY`, `EC2_HOST`, `EC2_USER`; ensure port 22 is open in the EC2 security group |
| App not reachable after deploy | Check DNS — your subdomain must point to the EC2 IP |
| `PLATFORM_IMAGE_SERVER` not updating | Confirm `/opt/seta/.env` exists on EC2 |
| Port 80/443 already in use | Run `sudo systemctl stop nginx && sudo systemctl disable nginx` on EC2 |
| Database errors | Run migrations: `docker compose --env-file /opt/seta/.env run --rm migrator` on EC2 |
| `proxy` container not starting | Check `docker logs seta-proxy-1` — often a bad Traefik config mount or port conflict |
