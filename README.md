# VitalFlow Backend

Pure JavaScript Node.js backend for the VitalFlow health/fitness app. Deploys to Render with zero build step.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# 3. Run migrations
npm run db:migrate

# 4. (Optional) Seed test data
npm run db:seed

# 5. Start server
npm start          # Production
npm run dev        # Development with nodemon
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3001) |
| `DATABASE_URL` | PostgreSQL connection string | **Yes** |
| `JWT_SECRET` | Secret for JWT signing | **Yes** |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `15m`) | No |
| `REFRESH_SECRET` | Secret for refresh tokens | No |
| `FRONTEND_URL` | CORS origin for frontend | No |
| `STRAVA_CLIENT_ID` | Strava OAuth app ID | No |
| `STRAVA_CLIENT_SECRET` | Strava OAuth secret | No |

## Test Account

After seeding, log in with:
- **Email:** `ed@cloudlayertech.com`
- **Password:** `TestPass123!`

## API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | - | Create account |
| POST | `/api/auth/login` | - | Log in, get JWT |
| GET | `/api/auth/me` | JWT | Get current user |

### Health Data
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health-data/daily` | - | Daily summaries by date range |
| GET | `/api/health-data/readiness` | - | 7-day readiness view |

### Activities
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/activities` | - | List activities (filterable) |
| GET | `/api/activities/:id` | - | Single activity detail |

### Training
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/training/fitness` | - | CTL/ATL/TSB fitness data |
| GET | `/api/training/load-vs-readiness` | - | Load vs readiness correlation |

### Dashboard
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard/overview` | - | Today's KPIs |
| GET | `/api/dashboard/trends` | - | Trend data |
| GET | `/api/dashboard/alerts` | - | Active alerts |

### OAuth (Strava)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/oauth/strava/connect` | JWT | Start Strava OAuth flow |
| GET | `/api/oauth/strava/callback` | - | Strava OAuth callback |
| POST | `/api/oauth/strava/disconnect` | JWT | Disconnect Strava |
| GET | `/api/oauth/connections` | JWT | List connected accounts |

### Webhooks
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/webhooks/strava` | - | Strava webhook verification |
| POST | `/webhooks/strava` | - | Strava event receiver |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Insert test data |

## Deploy to Render

1. Push this repo to GitHub
2. In Render dashboard, click **New +** > **Blueprint**
3. Connect your repo and deploy
4. The `render.yaml` will create both the web service and PostgreSQL database

## Architecture

```
src/
  config/
    database.js    # PostgreSQL pool + query helper
    redis.js       # In-memory Redis mock (free tier friendly)
  lib/
    logger.js      # Simple console logger
    errors.js      # Custom error classes (ApiError, etc.)
  middleware/
    auth.js        # JWT verification
    error.js       # Global error handler
    rateLimit.js   # In-memory rate limiter
  routes/
    auth.js        # Register/login/me
    health.js      # Daily summaries, readiness
    activities.js  # Activity list/detail
    training.js    # CTL/ATL/TSB, load analysis
    dashboard.js   # Overview, trends, alerts
    oauth.js       # Strava OAuth flow
    webhooks.js    # Strava webhook receiver
  db/
    migrate.js     # Migration runner
    seed.js        # Test data seeder
  app.js           # Express app setup
  server.js        # Entry point

migrations/
  001_schema.sql  # All tables + indexes
  002_seed.sql    # Test data (alternative to JS seed)
```

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express 4
- **Database:** PostgreSQL (via `pg`)
- **Cache:** In-memory Map (Redis optional via `REDIS_URL`)
- **Auth:** JWT + bcrypt + passport
- **No build step:** Pure JavaScript, `require()`/`module.exports`
