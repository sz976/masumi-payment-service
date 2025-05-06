# Dual Environment Setup for Masumi Payment Service

This document describes the dual environment setup for the Masumi Payment Service, which consists of separate Production and Development environments.

## Architecture Overview

The Masumi Payment Service now supports two parallel environments:

1. **Production Environment**
   - Deployed from the `feature/docker-compose` branch
   - Preserves wallet data and provides stable service
   - Accessible through standard HTTP/HTTPS ports (80/443)

2. **Development Environment**
   - Deployed from the `develop` branch
   - Independent of production data and services
   - Accessible through standard ports (80/443) on a separate VM
   - Uses distinct container names and Docker volume names

Both environments run in the same VPC for security and resource efficiency.

## Environment Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Azure VPC                            │
│                                                             │
│   ┌─────────────────────────┐    ┌─────────────────────────┐│
│   │  Production Environment  │    │  Development Environment ││
│   │                         │    │                         ││
│   │  ┌─────────────────┐    │    │  ┌─────────────────┐    ││
│   │  │ Docker Network  │    │    │  │ Docker Network  │    ││
│   │  │                 │    │    │  │                 │    ││
│   │  │ ┌─────────────┐ │    │    │  │ ┌─────────────┐ │    ││
│   │  │ │   Nginx     │ │    │    │  │ │   Nginx     │ │    ││
│   │  │ │  (80/443)   │ │    │    │  │ │  (80/443)   │ │    ││
│   │  │ └──────┬──────┘ │    │    │  │ └──────┬──────┘ │    ││
│   │  │        │        │    │    │  │        │        │    ││
│   │  │ ┌──────┴──────┐ │    │    │  │ ┌──────┴──────┐ │    ││
│   │  │ │  Payment    │ │    │    │  │ │  Payment    │ │    ││
│   │  │ │  Service    │ │    │    │  │ │  Service    │ │    ││
│   │  │ └──────┬──────┘ │    │    │  │ └──────┬──────┘ │    ││
│   │  │        │        │    │    │  │        │        │    ││
│   │  │ ┌──────┴──────┐ │    │    │  │ ┌──────┴──────┐ │    ││
│   │  │ │  Postgres   │ │    │    │  │ │  Postgres   │ │    ││
│   │  │ │  Database   │ │    │    │  │ │  Database   │ │    ││
│   │  │ └─────────────┘ │    │    │  │ └─────────────┘ │    ││
│   │  │                 │    │    │  │                 │    ││
│   │  └─────────────────┘    │    │  └─────────────────┘    ││
│   │                         │    │                         ││
│   │  ┌─────────────────┐    │    │  ┌─────────────────┐    ││
│   │  │ Docker Volumes  │    │    │  │ Docker Volumes  │    ││
│   │  │ - postgres_data │    │    │  │ - postgres_data_dev  ││
│   │  │ - masumi_logs   │    │    │  │ - masumi_logs_dev    ││
│   │  │ - masumi_wallets│    │    │  │ - masumi_wallets_dev ││
│   │  └─────────────────┘    │    │  └─────────────────┘    ││
│   └─────────────────────────┘    └─────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Automation

The dual environment setup is managed through GitHub Actions workflows:

1. **Production Deployment**
   - Workflow file: `.github/workflows/deploy-to-azurevm.yml`
   - Triggered by pushes to `feature/docker-compose` branch
   - Uses production-specific environment variables and secrets

2. **Development Deployment**
   - Workflow file: `.github/workflows/deploy-to-dev-azurevm.yml`
   - Triggered by pushes to `develop` branch
   - Uses development-specific environment variables and secrets (prefixed with `DEV_`)

Both workflows utilize the same self-hosted GitHub runner, which has access to both production and development VMs.

## Data Persistence Strategy

### Production Environment

- Critical wallet data is stored in the `masumi_wallets` Docker volume
- Database data is stored in the `postgres_data` Docker volume
- Logs are stored in the `masumi_logs` and `nginx_logs` volumes
- These volumes are preserved during deployments to ensure data continuity

### Development Environment

- Uses separate Docker volumes with `_dev` suffix
- Development volumes can be safely cleared between deployments
- Independent wallet data allows testing without affecting production funds

## Environment-Specific Configuration

1. **Production**
   - Uses standard Docker Compose configuration (`docker-compose.yml`)
   - Accessible on standard ports (80/443)
   - Container names follow normal naming convention
   - Configured for production stability and security

2. **Development**
   - Uses modified Docker Compose configuration (`docker-compose.dev.yml`)
   - Accessible on alternate ports (8080/8443)
   - Container names include `-dev` suffix to avoid conflicts
   - Configured for development convenience (shorter job intervals, etc.)
   - Includes development-specific environment variables and headers

## How to Use Each Environment

### Accessing Production Environment

- **Web Interface**: `https://<PRODUCTION_VM_IP>/`
- **Admin Dashboard**: `https://<PRODUCTION_VM_IP>/admin`
- **API Documentation**: `https://<PRODUCTION_VM_IP>/docs`

### Accessing Development Environment

- **Web Interface**: `https://<DEV_VM_IP>/`
- **Admin Dashboard**: `https://<DEV_VM_IP>/admin`
- **API Documentation**: `https://<DEV_VM_IP>/docs`

## Development Workflow

1. **Feature Development**
   - Create feature branches from `develop`
   - Make changes and test locally
   - Push to feature branch
   - Create PR to merge into `develop`

2. **Development Deployment**
   - Merges to `develop` trigger automatic deployment to development environment
   - Test changes in development environment
   - Validate fixes without affecting production

3. **Production Deployment**
   - Create PR to merge tested changes from `develop` to `feature/docker-compose`
   - Review and approve PR
   - Merges to `feature/docker-compose` trigger automatic deployment to production

## Maintenance Procedures

### Backing Up Wallet Data

**Production**
```bash
# Connect to production VM
ssh <PRODUCTION_VM_USER>@<PRODUCTION_VM_IP>

# Copy wallet data to backup location
sudo docker cp masumi-payment-service:/usr/src/app/wallets /backup/production/wallets-$(date +%Y%m%d)
```

**Development**
```bash
# Connect to development VM
ssh <DEV_VM_USER>@<DEV_VM_IP>

# Copy wallet data to backup location 
sudo docker cp masumi-payment-service-dev:/usr/src/app/wallets /backup/development/wallets-$(date +%Y%m%d)
```

### Database Backups

**Production**
```bash
# Connect to production VM
ssh <PRODUCTION_VM_USER>@<PRODUCTION_VM_IP>

# Backup PostgreSQL database
docker exec masumi-postgres pg_dump -U masumi masumi_payment > /backup/production/db-$(date +%Y%m%d).sql
```

**Development**
```bash
# Connect to development VM
ssh <DEV_VM_USER>@<DEV_VM_IP>

# Backup PostgreSQL database
docker exec masumi-postgres-dev pg_dump -U masumi masumi_payment_dev > /backup/development/db-$(date +%Y%m%d).sql
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**
   - Ensure no other services on the VMs are using ports 80/443 (production) or 8080/8443 (development)

2. **Wallet Access Issues**
   - Verify wallet mnemonics are correctly backed up and stored in the appropriate environment variables
   - Check wallet data persistence by inspecting the Docker volumes

3. **Deployment Failures**
   - Verify GitHub secrets are correctly configured for both environments
   - Ensure the GitHub runner has SSH access to both VMs
   - Check GitHub Actions logs for specific error messages

### Logs and Monitoring

**Production**
```bash
# View service logs
docker logs masumi-payment-service

# View nginx logs
docker logs masumi-nginx
```

**Development**
```bash
# View service logs
docker logs masumi-payment-service-dev

# View nginx logs
docker logs masumi-nginx-dev
```

## Security Considerations

- Both environments are within the same VPC for security
- Development environment uses different ports to prevent accidental access
- Sensitive wallet data is kept separate between environments
- Each environment has its own set of secrets and credentials
