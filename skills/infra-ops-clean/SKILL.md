---
name: infra-ops
description: Comprehensive infrastructure operations: VPS management, SSH, Docker, Coolify PaaS, Nginx deployments, SSL certificates, security hardening, email infrastructure, and cloud service setup. Use for server administration, deployments, DevOps, and production operations.
---

# Infrastructure Operations (infra-ops)

**TEMPLATE VERSION** - This skill contains placeholders and template configurations designed for customization. See "Getting Started" section below.

Master skill for all infrastructure, deployment, and operations work. Use progressive disclosure - load only the files needed for your current task.

---

## Getting Started

This is a **template-based skill**. Before using in production, you must customize it for your infrastructure:

### Required Customization Steps

1. **Update Server Credentials** (`vps-core.md`)
   - Replace placeholder server IPs with your actual Lightsail/VPS instances
   - Update SSH connection strings and user accounts
   - Replace Coolify dashboard URLs with your instances
   - Store SSH keys in `keys/` folder and update references

2. **Set AWS/Cloudflare Credentials**
   - Update AWS S3 bucket names and regions (`aws-s3.md`)
   - Replace Cloudflare API tokens and domain names
   - Configure zone IDs for your DNS provider

3. **Environment Variables**
   - Use the "Environment Variables Quick Reference" section as a template
   - Replace all `your-*` placeholders with actual values
   - Never commit `.env` files to version control

4. **Verify SSH Access**
   - Test SSH connections to all servers listed in `vps-core.md`
   - Ensure SSH keys have proper permissions (600)
   - Validate server access before critical operations

**Note**: Keep this repository private. Credential files contain sensitive data that should never be shared publicly.

---

---

## Quick Reference: Which File to Load

### By Task Type

| Task | Load These Files |
|------|------------------|
| **SSH to server / server reference** | `vps-core.md` |
| **New server setup** | `vps-security.md` → `vps-security-setup.md` |
| **Security hardening** | `vps-security.md` → `vps-security-protection.md` |
| **Server maintenance / emergency** | `vps-security-operations.md` |
| **Install/manage Docker** | `vps-docker.md` |
| **Deploy with Nginx + SSL** | `vps-deployment.md` |
| **Deploy with Coolify** | `coolify.md` |
| **Next.js Docker deployment** | `docker-deployment-guide.md` |
| **Generic Docker patterns** | `docker-deployment-patterns.md` |
| **Cloudflare DNS/CDN** | `cloudflare-setup.md` |
| **Google OAuth setup** | `google-oauth.md` |
| **AWS S3 setup** | `aws-s3.md` |
| **Database migrations** | `database-migrations.md` |

---

## File Index

### VPS Core & Security

| File | Purpose | Contains Credentials? |
|------|---------|----------------------|
| `vps-core.md` | Server inventory, SSH access, Coolify dashboard | **Template - customize** |
| `vps-security.md` | Security philosophy, checklist, module overview | No |
| `vps-security-setup.md` | Initial setup, SSH hardening, auto-updates | No |
| `vps-security-protection.md` | UFW firewall, Fail2ban, Cloudflare protection | No |
| `vps-security-operations.md` | Maintenance, hardening script, emergency procedures | No |

### Docker & Deployment

| File | Purpose |
|------|---------|
| `vps-docker.md` | Docker installation, compose, container management |
| `vps-deployment.md` | Nginx reverse proxy, SSL/Let's Encrypt, production configs |
| `coolify.md` | Coolify PaaS: apps, databases, domains, troubleshooting |
| `docker-deployment-guide.md` | Next.js 16 + Tailwind v4 + Prisma → Docker/Coolify |
| `docker-deployment-patterns.md` | Generic Docker patterns for monorepos |

### External Services

| File | Purpose |
|------|---------|
| `cloudflare-setup.md` | DNS, CDN, SSL, security & performance |
| `google-oauth.md` | OAuth setup for user authentication |
| `aws-s3.md` | S3 bucket setup for file storage |
| `database-migrations.md` | Prisma migrations, production DB workflows |

### Keys (Subfolder)

| File | Purpose |
|------|---------|
| `keys/<YOUR_SSH_KEY>.pem` | SSH private key (e.g., AWS Lightsail) |

---

## Progressive Disclosure Guide

### Scenario: "Deploy a Next.js app to VPS"

**Load order:**
1. `vps-core.md` - Get server access info
2. `coolify.md` - If using Coolify
3. `docker-deployment-guide.md` - Next.js specific Docker setup
4. `cloudflare-setup.md` - DNS and CDN configuration

### Scenario: "Secure a new VPS"

**Load order:**
1. `vps-security.md` - Overview and checklist
2. `vps-security-setup.md` - SSH hardening, user creation
3. `vps-security-protection.md` - Firewall, Fail2ban

### Scenario: "Troubleshoot Coolify deployment"

**Load order:**
1. `coolify.md` - Full troubleshooting section
2. `vps-core.md` - SSH access to investigate

---

## Environment Variables Quick Reference

### CDN & DNS (Cloudflare)
```env
# No env vars - configuration in Cloudflare dashboard
```

### Authentication (Google OAuth)
```env
AUTH_GOOGLE_ID=your-client-id.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=GOCSPX-your-secret
```

### File Storage (AWS S3)
```env
S3_BUCKET=your-bucket-name
S3_REGION=eu-central-1
S3_ACCESS_KEY=AKIA...
S3_SECRET_ACCESS_KEY=your-secret-key
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
S3_PUBLIC_URL=https://your-bucket-name.s3.eu-central-1.amazonaws.com
```

### Database
```env
DATABASE_URL=postgresql://user:pass@host:5432/database
```

---

## Command Patterns

All VPS commands use SSH pattern:

```bash
# Single command
ssh user@server "command"

# Multiple commands
ssh user@server "cmd1 && cmd2 && cmd3"

# Interactive (requires TTY)
ssh -t user@server "interactive-command"
```

For server credentials and connection details, load `vps-core.md`.

---

## Session Workflow

For significant infrastructure work:

1. Create `.claude/tasks/session-current.md`
2. Document planned tasks
3. Execute via SSH, capturing outputs
4. Update TodoWrite synchronously
5. Commit on completion
6. Archive to `session-XXX-description.md`

---

## Security Notes

- **Template Files**: This is a template skill. Files marked "Template - customize" contain placeholders that must be replaced with your actual infrastructure values before use.
- **Credentials**: Several files contain sensitive data (AWS keys, passwords, server IPs). Keep repo private.
- **SSH Keys**: Stored in `keys/` subfolder, must be gitignored
- **Never commit**: Raw passwords, API keys, or PEM files outside designated locations
- **Production Readiness**: Do not use any credential file in production until all placeholders have been replaced with your actual values and tested.
