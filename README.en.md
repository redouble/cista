# 🔒 Cista — Zero-Knowledge End-to-End Encrypted File Sharing

> **Lock it in a Cista. Only you hold the key.**

Cista is an open-source, self-hosted web application for secure end-to-end encrypted file sharing. Files are encrypted in your browser **before** upload — the server never sees your plaintext data.

> **No terminal, no OpenSSL, no technical skills required. If you can use a website, you can use Cista.**

> **License:** Business Source License 1.1 — see [📄 License](#-license) below for details.

---

## ✨ Features

### 🔑 One-Click Key Generation

Generate RSA-4096 or RSA-2048 key pairs directly in your browser using the Web Crypto API. **No command line, no technical knowledge required.** Your private key never leaves your device.

### 🔒 End-to-End Encryption

- **AES-256-GCM** encrypts each file with a unique random key (DEK)
- **RSA-4096 or RSA-2048** encrypts the DEK with the recipient's public key
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
- **user_keys** — RSA public keys with fingerprints
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
| Key encryption   | RSA-OAEP (SHA-256)                |
| Key generation   | RSA-4096 / RSA-2048                |
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
| **E2E encryption**                | ✅ AES-256-GCM + RSA        | ✅ AES-256 + RSA-4096 | ✅ Browser-based | ✅ OpenPGP      |
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
- All tests pass: `cd server && npm test`

---

## 📄 License

**Business Source License 1.1**

Copyright © 2026 Cista Contributors

**Licensed Work:** Cista

**Licensor:** Cista Contributors

**Additional Use Grant:** You may use the Licensed Work in development, testing, and personal non-production environments. For production deployments exceeding reasonable limits, please contact the author for commercial licensing.

**Change Date:** 4 years from the release date of each version (e.g., versions released July 2026 change to Apache 2.0 in July 2030).

**Change License:** Apache License 2.0

**Limitations:** Prior to the Change Date, the Licensed Work may not be used for commercial hosting or provided as part of a SaaS product to third parties without express permission.

See the [LICENSE](LICENSE) file for the full license text.

---

## ☕ Sponsor

If you find this project helpful, please consider sponsoring its development.

### WeChat Pay

<img src="docs/wechat-qr.png" width="200" alt="WeChat Pay QR Code" />

### Alipay

<img src="docs/alipay-qr.png" width="200" alt="Alipay QR Code" />

### PayPal

<p>
  <a href="https://paypal.me/redouble117" target="_blank">
    <img src="https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal" />
  </a>
</p>

**Thank you to all supporters!** 🙏

---

## ⭐ Star History

<a href="https://www.star-history.com/#redouble/cista&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=redouble/cista&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=redouble/cista&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=redouble/cista&type=Date" />
 </picture>
</a>

---

## ⚠️ Security Disclaimer

**Important: Please read carefully before use**

1. **No Warranty:** This software is provided "AS IS", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.

2. **Limitation of Liability:** In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from the use of this software.

3. **Security Audits:** While this software employs end-to-end encryption and other security measures, **no software is absolutely secure**. You **must** conduct an independent security audit and penetration testing by qualified security professionals before deploying to production.

4. **Key Management:** Users are solely responsible for the security of their private keys. Loss of a private key will result in permanent, irretrievable loss of access to encrypted data. The authors cannot recover lost keys or encrypted data.

5. **Legal Compliance:** Users are responsible for ensuring their use of this software complies with all applicable local, national, and international laws and regulations.

6. **Third-Party Dependencies:** This software depends on third-party libraries and services. The authors assume no responsibility for the security or behavior of these third-party components.

7. **Data Backup:** It is recommended that users maintain regular backups of their data. The authors assume no liability for any damages arising from data loss.

8. **Version Updates:** It is recommended that users always use the latest version. Older versions may contain known security vulnerabilities.
