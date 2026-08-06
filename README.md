# MuscleOS - Enterprise Gym Management System

> The Operating System for Modern Gyms

## Architecture Overview

```
MuscleOS/
├── .github/workflows/       # CI/CD Pipeline
├── infra/                   # Infrastructure
│   ├── nginx/              # Reverse proxy config
│   ├── postgres/           # DB initialization
│   └── redis/              # Cache config
├── backend/                 # NestJS API
│   ├── prisma/             # Database schema
│   ├── src/
│   │   ├── common/         # Guards, interceptors, filters, decorators, pipes, middleware
│   │   ├── config/         # App configuration
│   │   ├── database/       # Prisma & Redis services
│   │   ├── modules/        # 15 Feature modules
│   │   ├── shared/         # Logger, Encryption, Audit services
│   │   ├── app.module.ts   # Root module
│   │   └── main.ts         # Bootstrap
│   └── test/               # E2E tests
└── frontend/                # React SPA
    ├── src/
    │   ├── components/     # UI & Layout components
    │   ├── hooks/          # Custom React hooks
    │   ├── pages/          # Route pages
    │   ├── services/       # API client
    │   ├── store/          # Zustand state management
    │   └── styles/         # Global CSS
    └── ...config files
```

## Technology Stack

### Backend
- **Framework**: NestJS 10 + TypeScript
- **ORM**: Prisma 5 + PostgreSQL 16
- **Cache**: Redis 7 (sessions, rate limiting, query cache)
- **Auth**: JWT + Refresh Tokens + RBAC + Argon2/bcrypt
- **Docs**: Swagger/OpenAPI 3.0
- **Security**: Helmet, CORS, Rate Limiting, Encryption (AES-256-GCM)
- **Logging**: Winston with daily rotation
- **Testing**: Jest + Supertest

### Frontend
- **Framework**: React 18 + TypeScript + Vite
- **Styling**: TailwindCSS + Shadcn UI
- **State**: Zustand (auth) + TanStack Query (server state)
- **Forms**: React Hook Form + Zod validation
- **Charts**: Recharts
- **Animation**: Framer Motion
- **Icons**: Lucide React

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **Reverse Proxy**: Nginx
- **Code Quality**: ESLint + Prettier + Husky

## Multi-Tenant Architecture

Every database table contains `gymId`. All API endpoints automatically filter by the `X-Gym-ID` header. Super Admin can access all gyms; Gym Owners are restricted to their own gym data.

## Database Schema

| Entity | Description |
|--------|-------------|
| `Gym` | Multi-tenant root entity |
| `User` | Staff accounts (Super Admin, Owner, Trainer, Reception) |
| `Member` | Gym members with QR codes |
| `Batch` | Training batches with schedules |
| `Membership` | Subscription plans & renewals |
| `Payment` | Transactions with Razorpay/Stripe |
| `Attendance` | Check-in/out records |
| `Notification` | SMS/Email/Push notifications |
| `Report` | Generated analytics reports |
| `AuditLog` | Activity tracking |
| `SupportTicket` | Help desk system |
| `GymPlan` | SaaS billing plans |

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+
- npm 10+

### 1. Clone & Setup
```bash
cd muscleos
cp .env.example .env
```

### 2. Start Infrastructure
```bash
docker-compose up -d postgres redis
```

### 3. Backend Setup
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

### 4. Frontend Setup (new terminal)
```bash
cd frontend
npm install
npm run dev
```

### Access Points
| Service | URL |
|---------|-----|
| API | http://localhost:3000 |
| Swagger Docs | http://localhost:3000/api/docs |
| Frontend App | http://localhost:5173 |

## API Documentation

Swagger UI is available at `/api/docs` with:
- Bearer token authentication
- Gym ID header injection
- Interactive request/response examples
- Role-based endpoint visibility

## Authentication Flow

1. **Login**: `POST /api/v1/auth/login` → Returns access + refresh tokens
2. **Refresh**: `POST /api/v1/auth/refresh` → Rotates access token
3. **Logout**: `POST /api/v1/auth/logout` → Revokes refresh token
4. **Password Reset**: OTP-based flow with Redis TTL

## Security Features

- AES-256-GCM encryption for QR codes
- Bcrypt password hashing (12 rounds)
- JWT access tokens (15min) + refresh tokens (7 days)
- Rate limiting (10/30/100 req per window)
- Helmet security headers
- CORS with credentials
- Audit logging for all CRUD operations
- Row-level tenant isolation

## Module Status

| # | Module | Status |
|---|--------|--------|
| 01 | Foundation | ✅ Complete |
| 02 | Authentication | ✅ Complete |
| 03 | Super Admin Dashboard | ✅ Structure ready |
| 04 | Gym Owner Dashboard | ✅ Structure ready |
| 05 | Batch Management | ✅ Structure ready |
| 06 | Member Management | ✅ Structure ready |
| 07 | QR Attendance | ✅ Structure ready |
| 08 | Membership Module | ✅ Structure ready |
| 09 | Payment Module | ✅ Structure ready |
| 10 | Reception Module | ✅ Structure ready |
| 11 | Reports Module | ✅ Structure ready |
| 12 | Notification Module | ✅ Structure ready |
| 13 | Public Gym Profile | ✅ Structure ready |
| 14 | Settings Module | ✅ Structure ready |
| 15 | Production Readiness | ✅ Docker + CI/CD |

## License

MIT License - MuscleOS Team
