# 🔒 Cista — Zero-Knowledge End-to-End Encrypted File Sharing

> **Lock it in a Cista. Only you hold the key.**
>
> **匣中剑气，唯你可启。**

Cista is an open-source, self-hosted web application for secure end-to-end encrypted file sharing. Files are encrypted in your browser **before** upload — the server never sees your plaintext data.

- [English](README.en.md)
- [中文](README.zh.md)

---

## ✨ Features

### 🔑 One-Click Key Generation

Generate RSA-4096 or ECC X25519 key pairs directly in your browser using the Web Crypto API. **No command line, no technical knowledge required.** Your private key never leaves your device.

### 🔒 End-to-End Encryption

- **AES-256-GCM** encrypts each file with a unique random key (DEK)
- **RSA-4096 or ECC X25519** encrypts the DEK with the recipient's public key
- Files are encrypted in the browser **before upload** — server stores only ciphertext
- Decryption happens in the browser **after download**

### 📤 Secure File Sharing via Share Codes

- Generate 6-8 character alphanumeric share codes (uppercase + digits, excluding confusing chars)
- **Two sharing modes:**
  1. **Registered users** — uses recipient's public key for maximum security
  2. **Unregistered users (one-time)** — generates a temporary key pair; **no login required** to download
- Download page accessible to anyone via the homepage or header "Redeem Code" link
- Configurable expiry dates and download limits
- Revoke share codes at any time

### 👥 Complete User Management

Email-based registration and login, password reset flow, account deletion with all data cleanup, admin panel.

### 🌐 Multi-Language Support

English and Chinese (中文) supported. Easy to add more languages.

### 📦 Technology Stack

| Layer        | Technology                                               |
| ------------ | -------------------------------------------------------- |
| Frontend     | TypeScript, HTMX, Alpine.js, Tailwind CSS                |
| Backend      | TypeScript (Node.js), Express.js                         |
| Database     | SQLite (dev) / PostgreSQL (prod) — via abstraction layer |
| Encryption   | Web Crypto API (browser), bcrypt (server)                |
| File Storage | Local filesystem (dev) / S3-compatible (prod)            |
| Auth         | JWT (HTTP-only cookies)                                  |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm

### One-Click Setup

```bash
git clone https://github.com/your-org/cista.git
cd cista
bash scripts/setup.sh
```

### Manual Setup

```bash
# Install dependencies
cd server && npm install && cd ..
cd client && npm install && cd ..

# Create data directories
mkdir -p server/data

# Run database migrations
cd server && npx tsx src/db/migrate.ts && cd ..

# Seed admin user (default: admin@cista.local / Admin123!)
cd server && npx tsx src/db/seed.ts && cd ..

# Start the server
cd server && npx tsx src/index.ts
```

The server runs at **http://localhost:3000**.

### Environment Variables

| Variable         | Default             | Description          |
| ---------------- | ------------------- | -------------------- |
| `PORT`           | `3000`              | Server port          |
| `HOST`           | `0.0.0.0`           | Server host          |
| `NODE_ENV`       | `development`       | Environment          |
| `DATABASE_URL`   | `./data/cista.db`   | SQLite database path |
| `JWT_SECRET`     | auto-generated      | JWT signing secret   |
| `STORAGE_TYPE`   | `local`             | File storage backend |
| `MAX_FILE_SIZE`  | `1073741824` (1GB)  | Max upload size      |
| `ADMIN_EMAIL`    | `admin@cista.local` | Seed admin email     |
| `ADMIN_PASSWORD` | `Admin123!`         | Seed admin password  |

---

## 🏗️ Architecture

```
cista/
├── server/                    # Backend (Express.js)
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── config.ts         # Configuration
│   │   ├── db/               # Database layer
│   │   │   ├── index.ts      # sql.js helper functions
│   │   │   ├── migrate.ts    # Table creation
│   │   │   └── seed.ts       # Admin user seeding
│   │   ├── routes/           # API & page routes
│   │   │   ├── auth.ts       # Authentication endpoints
│   │   │   ├── keys.ts       # Public key management
│   │   │   ├── files.ts      # File CRUD & upload
│   │   │   ├── shares.ts     # Share code management
│   │   │   ├── admin.ts      # Admin endpoints
│   │   │   └── pages.ts      # HTML page rendering
│   │   ├── middleware/       # Express middleware
│   │   ├── storage/          # File storage abstraction
│   │   ├── i18n/             # Internationalization
│   │   └── views/            # EJS templates
│   └── data/                 # SQLite DB & uploaded files
├── client/                   # Frontend build
│   ├── src/
│   │   ├── main.ts           # Entry point
│   │   └── crypto/           # Web Crypto API helpers
│   └── vite.config.ts
├── scripts/
│   └── setup.sh              # One-click setup
└── package.json              # Root workspace
```

### Database Schema

- **users** — User accounts with password hashes and roles
- **user_keys** — RSA/ECC public keys with fingerprints
- **files** — Encrypted file metadata and storage paths
- **share_codes** — Share codes with encrypted DEKs and access controls
- **password_reset_tokens** — Time-limited password reset tokens
- **system_config** — Key-value system configuration

---

## 🔐 Security Design

### Zero-Knowledge Architecture

```
┌─────────────────────┐          ┌──────────────────────┐
│     Sender's        │          │      Server          │
│     Browser         │          │                      │
│                     │          │  Stores only:        │
│  1. Generates DEK   │ ──────►  │  • Encrypted file    │
│  2. Encrypts file   │  Upload  │  • Encrypted DEK     │
│     with AES-256-GCM│          │  • Public keys       │
│  3. Encrypts DEK    │          │  • Hashed passwords  │
│     with recipient's│          │                      │
│     public key      │          │  Cannot decrypt:     │
│  4. Deletes plain-  │          │  • Files ✗           │
│     text & DEK      │          │  • DEKs ✗            │
│                     │          │  • Private keys ✗    │
└─────────────────────┘          └──────────────────────┘
         │                                 │
         │          Share Code             │
         ▼                                 ▼
┌─────────────────────┐          ┌──────────────────────┐
│    Recipient's      │◄─────────│    (or share code    │
│    Browser          │  Download│     via URL)         │
│                     │          │                      │
│  1. Downloads       │          │                      │
│     encrypted file  │          │                      │
│  2. Decrypts DEK    │          │                      │
│     with private key│          │                      │
│  3. Decrypts file   │          │                      │
│     with DEK        │          │                      │
└─────────────────────┘          └──────────────────────┘
```

### Encryption Algorithms

| Purpose          | Algorithm                        |
| ---------------- | -------------------------------- |
| File encryption  | AES-256-GCM (random IV per file) |
| Key encryption   | RSA-OAEP (SHA-256) / ECDH        |
| Key generation   | RSA-4096 / ECC X25519            |
| Key derivation   | PBKDF2 (600,000 iterations)      |
| Password hashing | bcrypt (cost 10)                 |

### Security Measures

- All private keys generated and stored **exclusively in the browser** (IndexedDB)
- Private keys encrypted at rest with a key derived from the user's password
- Server stores zero knowledge: no plaintext files, no private keys, no passwords
- HTTP-only cookies for JWT tokens (not accessible via JavaScript)
- Rate limiting on auth endpoints
- Password strength enforcement
- System is fully auditable — all source code open

---

## 📋 Comparison with Similar Projects

| Feature                           | **Cista**                   | Vellaris              | Privipod         | Yopass          |
| --------------------------------- |:---------------------------:|:---------------------:|:----------------:|:---------------:|
| **One-click key generation**      | ✅ Browser-based            | ❌ Manual CLI         | ❌ Manual CLI    | ❌ Manual CLI   |
| **Share with unregistered users** | ✅ "One-time share"         | ❌                    | ✅               | ✅              |
| **File management dashboard**     | ✅ Full CRUD                | ✅                    | ❌               | ❌              |
| **Share code management**         | ✅ Revoke, expiry, limits   | ❌                    | Limited          | Limited         |
| **Self-hosted**                   | ✅ Open source              | ✅                    | ✅               | ✅              |
| **E2E encryption**                | ✅ AES-256-GCM + RSA/ECC    | ✅ AES-256 + RSA-4096 | ✅ Browser-based | ✅ OpenPGP      |
| **Zero-knowledge**                | ✅                          | ✅                    | ✅               | ✅              |
| **Admin panel**                   | ✅ User & system management | ❌                    | ❌               | ❌              |
| **i18n**                          | ✅ Chinese & English        | ❌ English only       | ❌ English only  | ❌ English only |
| **License**                       | BSL 1.1 (4yr → Apache 2.0) | —                     | AGPL v3          | GPL v3          |

---

## 🧪 Development

```bash
# Run tests
cd server && npm test

# Start in development mode
npm run dev
```

### Test Coverage

- 12 unit tests for database operations
- 62 API integration tests covering all endpoints
- All tests: `cd server && npm test`

---

## 📄 License

**Business Source License 1.1**

**Additional Use Grant:** You may use the Licensed Work in development, testing, and personal non-production environments. For production deployments, please contact the author for commercial licensing.

**Change Date:** 4 years from the release date of each version.

**Change License:** Apache License 2.0

See the [LICENSE](LICENSE) file for the full license text.

---

## ☕ 赞助 / Sponsor

如果你觉得这个项目有帮助，欢迎赞助支持持续开发。

If you find this project helpful, please consider sponsoring its development.

### 微信赞赏 (WeChat Pay)

<img src="docs/wechat-qr.png" width="200" alt="微信赞赏码" />
<!--- 请将你的微信收款二维码放在 docs/wechat-qr.png --->

### 支付宝 (Alipay)

<img src="docs/alipay-qr.png" width="200" alt="支付宝收款码" />
<!--- 请将你的支付宝收款二维码放在 docs/alipay-qr.png --->

### PayPal

<p>
  <a href="https://paypal.me/redouble117" target="_blank">
    <img src="https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal" />
  </a>
</p>


**感谢所有支持者！** 🙏

**Thank you to all supporters!** 🙏

---

## ⚠️ Disclaimer

This software is provided for educational and lawful purposes only. The authors assume no liability for any misuse or damages. Always conduct your own security audit before deploying to production.
